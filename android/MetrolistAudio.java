package com.longbridge.nsh;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import java.io.File;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

/** One native audio engine per process. Its buffers survive UI screens and Activity recreation. */
public final class MetrolistAudio {
    public static final String ENGINE = "Media3 ExoPlayer 1.10.1";
    private static final long CACHE_BYTES = 1024L * 1024 * 1024;
    private static MetrolistAudio instance;
    private static WeakReference<NshView> view = new WeakReference<>(null);
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SimpleCache cache;
    private final OkHttpClient http;
    private final ExoPlayer player;
    private Map<String, Object> track, source;
    private long requestId;
    private double fallbackDuration;
    private double stoppedPosition;
    private boolean remoteControlled;
    private String error = "", errorCode = "";

    public static MetrolistAudio get(Context context) {
        if (instance == null) instance = new MetrolistAudio(context.getApplicationContext());
        return instance;
    }
    public static MetrolistAudio current() { return instance; }
    public static void attach(NshView value) {
        view = new WeakReference<>(value);
        if (instance != null) instance.scheduleTick();
    }
    public static void detach(NshView value) {
        if (view.get() == value) {
            view.clear();
            if (instance != null) instance.main.removeCallbacks(instance.tick);
        }
    }

    private MetrolistAudio(Context context) {
        this.context = context;
        cache = new SimpleCache(new File(context.getCacheDir(), "audio-streams"),
                new LeastRecentlyUsedCacheEvictor(CACHE_BYTES), new StandaloneDatabaseProvider(context));
        http = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build();
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(50_000, 50_000, 750, 2_000)
                .setPrioritizeTimeOverSizeThresholds(true).build();
        player = new ExoPlayer.Builder(context).setLoadControl(loadControl)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_NETWORK).build();
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player value, Player.Events events) { publish(true); }
            @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
                if (reason == Player.DISCONTINUITY_REASON_SEEK) publish(true, true);
            }
            @Override public void onPlayerError(PlaybackException failure) {
                error = text(failure.getMessage()); errorCode = failure.getErrorCodeName();
                player.setPlayWhenReady(false);
                publish(true);
            }
        });
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            // A position snapshot goes to the visible NSH UI. MediaSession interpolates its own clock.
            if (track != null && view.get() != null && (player.getPlayWhenReady() || player.isLoading())) publish(false);
            scheduleTick();
        }
    };
    private void scheduleTick() {
        main.removeCallbacks(tick);
        if (track != null && view.get() != null && player.getPlaybackState() != Player.STATE_ENDED
                && (player.getPlayWhenReady() || player.isLoading())) main.postDelayed(tick, 250);
    }

    @SuppressWarnings("unchecked")
    public void open(Map<String, Object> args) {
        requestId = ((Number) args.get("requestId")).longValue();
        track = new HashMap<>((Map<String, Object>) args.get("track"));
        fallbackDuration = number(track, "duration", 0);
        error = ""; errorCode = "";
        source = new HashMap<>();
        for (String key : new String[] {"url", "headers", "mimeType", "formatId", "expiresAt", "cacheKey"}) {
            if (args.containsKey(key)) source.put(key, args.get(key));
        }
        Map<String, String> headers = new HashMap<>();
        if (args.get("headers") instanceof Map) {
            ((Map<?, ?>) args.get("headers")).forEach((key, value) -> headers.put(key.toString(), value.toString()));
        }
        OkHttpDataSource.Factory network = new OkHttpDataSource.Factory(http).setDefaultRequestProperties(headers);
        CacheDataSource.Factory cached = new CacheDataSource.Factory().setCache(cache)
                .setUpstreamDataSourceFactory(new DefaultDataSource.Factory(context, network));
        MediaItem.Builder item = new MediaItem.Builder().setMediaId(text(track.get("id")))
                .setUri(text(args.get("url"))).setCustomCacheKey(text(args.get("cacheKey")));
        String mimeType = text(args.get("mimeType"));
        if (!mimeType.isEmpty()) item.setMimeType(mimeType.split(";", 2)[0]);
        applySettings(args);
        player.setMediaSource(new ProgressiveMediaSource.Factory(cached).createMediaSource(item.build()),
                Math.round(number(args, "position", 0) * 1000));
        player.setPlayWhenReady(!Boolean.FALSE.equals(args.get("playWhenReady")));
        player.prepare();
        publish(true);
    }

    public void play() { player.play(); publish(true); }
    public void pause() { player.pause(); publish(true); }
    public void seek(double seconds) { player.seekTo(Math.round(seconds * 1000)); publish(true); }
    public void settings(Map<String, Object> args) {
        applySettings(args);
        publish(true);
    }
    private void applySettings(Map<String, Object> args) {
        if (args.containsKey("volume")) player.setVolume((float) number(args, "volume", 1));
        if (args.containsKey("rate")) player.setPlaybackParameters(new PlaybackParameters((float) number(args, "rate", 1)));
        if (args.containsKey("remoteControlled")) remoteControlled = Boolean.TRUE.equals(args.get("remoteControlled"));
    }
    public boolean remoteControlled() { return remoteControlled; }
    public boolean hasSource() { return track != null; }
    public Map<String, Object> track() { return track; }

    public void stop() {
        MetrolistMediaService.stop(context);
    }
    public void stopPlayback() {
        if (track != null) stoppedPosition = player.getCurrentPosition() / 1000.0;
        player.setPlayWhenReady(false);
        player.stop(); player.clearMediaItems();
        track = null; source = null; fallbackDuration = 0;
        error = ""; errorCode = "";
        publish(true);
    }

    public Map<String, Object> snapshot() {
        if (track == null) return null;
        Map<String, Object> state = state();
        state.put("track", new HashMap<>(track));
        state.put("source", new HashMap<>(source));
        state.put("engine", ENGINE);
        state.put("cacheBytes", cache.getCacheSpace());
        return state;
    }

    public Map<String, Object> state() {
        int playbackState = player.getPlaybackState();
        long actualDuration = player.getDuration();
        boolean buffering = playbackState == Player.STATE_BUFFERING;
        String state = track == null ? "idle" : playbackState == Player.STATE_ENDED ? "ended"
                : buffering ? "loading" : player.getPlayWhenReady() ? "playing" : "paused";
        Map<String, Object> result = new HashMap<>();
        result.put("requestId", requestId);
        result.put("position", track == null ? stoppedPosition : player.getCurrentPosition() / 1000.0);
        result.put("duration", actualDuration == C.TIME_UNSET ? fallbackDuration : actualDuration / 1000.0);
        result.put("bufferedPosition", player.getBufferedPosition() / 1000.0);
        result.put("playing", player.isPlaying());
        result.put("playWhenReady", player.getPlayWhenReady());
        result.put("buffering", buffering);
        result.put("state", state);
        result.put("rate", (double) player.getPlaybackParameters().speed);
        result.put("volume", (double) player.getVolume());
        if (!error.isEmpty()) { result.put("error", error); result.put("errorCode", errorCode); }
        return result;
    }

    private void publish(boolean systemChanged) {
        publish(systemChanged, false);
    }
    private void publish(boolean systemChanged, boolean discontinuity) {
        Map<String, Object> state = state();
        if (discontinuity) state.put("discontinuity", true);
        NshView target = view.get();
        if (target != null) target.send("audio.state", state);
        if (systemChanged) {
            MetrolistMediaService.changed();
            scheduleTick();
        }
    }

    public static void command(String action) {
        NshView target = view.get();
        if (target == null) return;
        Map<String, Object> event = new HashMap<>(); event.put("action", action);
        target.send("media.command", event);
    }

    public void release() {
        main.removeCallbacks(tick);
        player.release(); cache.release();
        http.dispatcher().executorService().shutdown();
        http.connectionPool().evictAll();
        instance = null;
    }

    static String text(Object value) { return value == null ? "" : value.toString(); }
    static double number(Map<String, Object> values, String key, double fallback) {
        Object value = values.get(key);
        return value instanceof Number ? ((Number) value).doubleValue() : fallback;
    }
}
