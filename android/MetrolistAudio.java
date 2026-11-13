package com.longbridge.nsh;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.datasource.TransferListener;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheWriter;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy;
import java.io.File;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

/** One native audio engine per process. Its buffers survive UI screens and Activity recreation. */
public final class MetrolistAudio {
    public static final String ENGINE = "Media3 ExoPlayer 1.10.1";
    private static final long CACHE_BYTES = 1024L * 1024 * 1024;
    private static final long PRELOAD_BYTES = 256L * 1024;
    private static SimpleCache sharedCache;
    private static MetrolistAudio instance;
    private static WeakReference<NshView> view = new WeakReference<>(null);
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SimpleCache cache;
    private final OkHttpClient http;
    private final ExoPlayer player;
    private final ExecutorService preloadWorker = Executors.newSingleThreadExecutor();
    private CacheWriter preloadWriter;
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
        // The cache belongs to the process, so restarting the service never opens a second cache lock.
        if (sharedCache == null) sharedCache = new SimpleCache(new File(context.getCacheDir(), "audio-streams"),
                new LeastRecentlyUsedCacheEvictor(CACHE_BYTES), new StandaloneDatabaseProvider(context));
        cache = sharedCache;
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
                for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
                    if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                        int status = ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                        errorCode = status == 429 ? "rate-limited" : "http-" + status;
                        error = status == 429 ? "音频数据请求过于频繁（HTTP 429）。请稍后重试。"
                                : "音频数据请求失败（HTTP " + status + "）。";
                        break;
                    }
                }
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
        cancelPreload();
        requestId = ((Number) args.get("requestId")).longValue();
        track = new HashMap<>((Map<String, Object>) args.get("track"));
        fallbackDuration = number(track, "duration", 0);
        error = ""; errorCode = "";
        source = new HashMap<>();
        for (String key : new String[] {"url", "headers", "mimeType", "formatId", "expiresAt", "cacheKey"}) {
            if (args.containsKey(key)) source.put(key, args.get(key));
        }
        MediaItem.Builder item = new MediaItem.Builder().setMediaId(text(track.get("id")))
                .setUri(text(args.get("url"))).setCustomCacheKey(text(args.get("cacheKey")));
        String mimeType = text(args.get("mimeType"));
        if (!mimeType.isEmpty()) item.setMimeType(mimeType.split(";", 2)[0]);
        applySettings(args);
        player.setMediaSource(new ProgressiveMediaSource.Factory(dataSource(args))
                .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy() {
                    @Override public long getRetryDelayMsFor(LoadErrorHandlingPolicy.LoadErrorInfo failure) {
                        for (Throwable cause = failure.exception; cause != null; cause = cause.getCause()) {
                            if (cause instanceof HttpDataSource.InvalidResponseCodeException
                                    && ((HttpDataSource.InvalidResponseCodeException) cause).responseCode == 429) return C.TIME_UNSET;
                        }
                        return super.getRetryDelayMsFor(failure);
                    }
                }).createMediaSource(item.build()),
                Math.round(number(args, "position", 0) * 1000));
        player.setPlayWhenReady(!Boolean.FALSE.equals(args.get("playWhenReady")));
        player.prepare();
        publish(true);
    }

    private CacheDataSource.Factory dataSource(Map<String, Object> args) {
        Map<String, String> headers = new HashMap<>();
        if (args.get("headers") instanceof Map) {
            ((Map<?, ?>) args.get("headers")).forEach((key, value) -> headers.put(key.toString(), value.toString()));
        }
        OkHttpDataSource.Factory network = new OkHttpDataSource.Factory(http).setDefaultRequestProperties(headers);
        return new CacheDataSource.Factory().setCache(cache)
                .setUpstreamDataSourceFactory(new DefaultDataSource.Factory(context, RangeChunkDataSource.factory(network)));
    }

    /**
     * Reads an HTTP resource as consecutive ranges of at most 10 MiB. googlevideo sends such a request at
     * full speed and holds one without a Range header, or for more, to about twice the audio's real-time
     * rate. Media3 opens position 0 without a Range header. yt-dlp's http_chunk_size reads the same way.
     */
    static final class RangeChunkDataSource implements DataSource {
        static final long CHUNK_BYTES = 10L << 20;
        private final DataSource upstream;
        private DataSpec request;
        private long position, end;
        private boolean ranged;

        static DataSource.Factory factory(DataSource.Factory upstream) {
            return () -> new RangeChunkDataSource(upstream.createDataSource());
        }
        private RangeChunkDataSource(DataSource upstream) { this.upstream = upstream; }

        @Override public void addTransferListener(TransferListener listener) { upstream.addTransferListener(listener); }

        @Override public long open(DataSpec dataSpec) throws IOException {
            request = dataSpec;
            position = dataSpec.position;
            end = dataSpec.length == C.LENGTH_UNSET ? C.LENGTH_UNSET : dataSpec.position + dataSpec.length;
            String scheme = dataSpec.uri.getScheme();
            ranged = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
            if (!ranged) return upstream.open(dataSpec);
            openRange();
            long total = total();
            if (total == C.LENGTH_UNSET) {
                // The source ignored the range; read the request as it was made.
                upstream.close();
                ranged = false;
                return upstream.open(dataSpec);
            }
            if (end == C.LENGTH_UNSET || end > total) end = total;
            return dataSpec.length == C.LENGTH_UNSET ? end - dataSpec.position : dataSpec.length;
        }

        private void openRange() throws IOException {
            long length = end == C.LENGTH_UNSET ? CHUNK_BYTES : Math.min(CHUNK_BYTES, end - position);
            upstream.open(request.subrange(position - request.position, length));
        }

        /** The resource length from the response's Content-Range, if it answered with one. */
        private long total() {
            for (Map.Entry<String, List<String>> header : upstream.getResponseHeaders().entrySet()) {
                if (!"Content-Range".equalsIgnoreCase(header.getKey()) || header.getValue().isEmpty()) continue;
                String value = header.getValue().get(0);
                String total = value.substring(value.lastIndexOf('/') + 1).trim();
                return total.matches("\\d+") ? Long.parseLong(total) : C.LENGTH_UNSET;
            }
            return C.LENGTH_UNSET;
        }

        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            while (true) {
                int read = upstream.read(buffer, offset, length);
                if (read != C.RESULT_END_OF_INPUT) { position += read; return read; }
                if (!ranged || position >= end) return C.RESULT_END_OF_INPUT;
                upstream.close();
                openRange();
            }
        }

        @Override public Uri getUri() { return upstream.getUri(); }
        @Override public Map<String, List<String>> getResponseHeaders() { return upstream.getResponseHeaders(); }
        @Override public void close() throws IOException { upstream.close(); }
    }

    /** Store the next song's opening bytes in the same cache used by real playback. */
    public void preload(Map<String, Object> args) {
        cancelPreload();
        String trackId = text(args.get("trackId")), cacheKey = text(args.get("cacheKey"));
        long contentLength = (long) number(args, "contentLength", 0);
        long length = contentLength > 0 ? Math.min(PRELOAD_BYTES, contentLength) : PRELOAD_BYTES;
        DataSpec spec = new DataSpec.Builder().setUri(text(args.get("url"))).setKey(cacheKey).setLength(length).build();
        CacheWriter writer = new CacheWriter(dataSource(args).createDataSourceForDownloading(), spec, null, null);
        preloadWriter = writer;
        preloadWorker.execute(() -> {
            boolean cached;
            try { writer.cache(); cached = true; }
            catch (IOException failure) { cached = false; }
            final boolean completed = cached;
            main.post(() -> {
                if (preloadWriter != writer) return;
                preloadWriter = null;
                NshView target = view.get();
                if (target != null) {
                    Map<String, Object> result = new HashMap<>();
                    result.put("trackId", trackId); result.put("cacheKey", cacheKey); result.put("cached", completed);
                    target.send("audio.preload", result);
                }
            });
        });
    }
    public void cancelPreload() {
        if (preloadWriter != null) { preloadWriter.cancel(); preloadWriter = null; }
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
        cancelPreload();
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
        cancelPreload();
        player.release();
        preloadWorker.execute(() -> {
            http.dispatcher().executorService().shutdown();
            http.connectionPool().evictAll();
        });
        preloadWorker.shutdown();
        instance = null;
    }

    static String text(Object value) { return value == null ? "" : value.toString(); }
    static double number(Map<String, Object> values, String key, double fallback) {
        Object value = values.get(key);
        return value instanceof Number ? ((Number) value).doubleValue() : fallback;
    }
}
