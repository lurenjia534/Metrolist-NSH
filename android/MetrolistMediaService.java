package com.longbridge.nsh;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import java.util.Map;
import java.util.HashMap;

/** Foreground owner of the native engine; system controls never wait for the NSH rendering thread. */
public final class MetrolistMediaService extends Service {
    private static final String CHANNEL = "metrolist.playback";
    private static final int NOTIFICATION = 4201;
    private static MetrolistMediaService service;
    private static boolean starting, stopping;
    private static Map<String, Object> pendingOpen;
    private static NshHostReply pendingReply;
    private MetrolistAudio audio;
    private MediaSession session;
    private String metadataKey = "", notificationKey = "";

    private static void start(Context context) {
        if (service == null && !starting) {
            starting = true;
            context.startForegroundService(new Intent(context, MetrolistMediaService.class));
        }
    }
    public static void open(Context context, Map<String, Object> args, NshHostReply reply) {
        if (service != null && !stopping) {
            service.audio.open(args);
            reply.resolve(null);
            return;
        }
        // A new source waits for its service owner. It never enters a player scheduled for release.
        if (pendingReply != null) pendingReply.resolve(null);
        pendingOpen = new HashMap<>(args);
        pendingReply = reply;
        if (!stopping) start(context);
    }
    public static void play() {
        if (pendingOpen != null) pendingOpen.put("playWhenReady", true);
        if (MetrolistAudio.current() != null && !stopping) MetrolistAudio.current().play();
    }
    public static void pause() {
        if (pendingOpen != null) pendingOpen.put("playWhenReady", false);
        if (MetrolistAudio.current() != null) MetrolistAudio.current().pause();
    }
    public static void seek(double seconds) {
        if (pendingOpen != null) pendingOpen.put("position", seconds);
        if (MetrolistAudio.current() != null && !stopping) MetrolistAudio.current().seek(seconds);
    }
    public static void settings(Map<String, Object> args) {
        if (pendingOpen != null) pendingOpen.putAll(args);
        if (MetrolistAudio.current() != null && !stopping) MetrolistAudio.current().settings(args);
    }
    public static void changed() { if (service != null) service.update(); }
    public static void stop(Context context) {
        pendingOpen = null;
        if (pendingReply != null) { pendingReply.resolve(null); pendingReply = null; }
        stopping = true;
        if (MetrolistAudio.current() != null) MetrolistAudio.current().stopPlayback();
        if (service != null) context.stopService(new Intent(context, MetrolistMediaService.class));
        else if (!starting) {
            if (MetrolistAudio.current() != null) MetrolistAudio.current().release();
            stopping = false;
        }
    }

    @Override public void onCreate() {
        super.onCreate(); starting = false;
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, "音乐播放", NotificationManager.IMPORTANCE_LOW));
        audio = MetrolistAudio.get(this);
        session = new MediaSession(this, "Metrolist");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { if (!audio.remoteControlled()) audio.play(); }
            @Override public void onPause() { if (!audio.remoteControlled()) audio.pause(); }
            @Override public void onStop() { if (!audio.remoteControlled()) audio.stop(); }
            @Override public void onSkipToNext() { control("next"); }
            @Override public void onSkipToPrevious() { control("previous"); }
            @Override public void onSeekTo(long milliseconds) { if (!audio.remoteControlled()) audio.seek(milliseconds / 1000.0); }
        });
        session.setActive(true);
        service = this;
        update();
        if (stopping) { stopSelf(); return; }
        if (pendingOpen != null) {
            Map<String, Object> next = pendingOpen;
            NshHostReply reply = pendingReply;
            pendingOpen = null; pendingReply = null;
            audio.open(next);
            reply.resolve(null);
        }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (stopping) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && intent.getAction() != null) control(intent.getAction());
        update();
        return START_NOT_STICKY;
    }
    private void control(String action) {
        if (audio.remoteControlled()) return;
        if ("play".equals(action)) audio.play();
        else if ("pause".equals(action)) audio.pause();
        else MetrolistAudio.command(action);
    }
    private PendingIntent action(String value, int request) {
        return PendingIntent.getService(this, request, new Intent(this, MetrolistMediaService.class).setAction(value),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private void update() {
        Map<String, Object> state = audio.state(), track = audio.track();
        String title = track == null ? "Metrolist" : MetrolistAudio.text(track.get("title"));
        String artist = track == null ? "" : MetrolistAudio.text(track.get("artist"));
        String album = track == null ? "" : MetrolistAudio.text(track.get("album"));
        long duration = Math.round(MetrolistAudio.number(state, "duration", 0) * 1000);
        String metadata = title + "\n" + artist + "\n" + album + "\n" + duration;
        if (!metadata.equals(metadataKey)) {
            metadataKey = metadata;
            session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist).putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, duration).build());
        }
        boolean playing = Boolean.TRUE.equals(state.get("playing"));
        boolean requested = Boolean.TRUE.equals(state.get("playWhenReady"));
        boolean buffering = Boolean.TRUE.equals(state.get("buffering"));
        int status = state.containsKey("error") ? PlaybackState.STATE_ERROR : !audio.hasSource() ? PlaybackState.STATE_STOPPED
                : buffering ? PlaybackState.STATE_BUFFERING : playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        long actions = audio.remoteControlled() ? 0 : PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
        PlaybackState.Builder playback = new PlaybackState.Builder().setActions(actions)
                .setBufferedPosition(Math.round(MetrolistAudio.number(state, "bufferedPosition", 0) * 1000))
                .setState(status, Math.round(MetrolistAudio.number(state, "position", 0) * 1000),
                        playing ? (float) MetrolistAudio.number(state, "rate", 1) : 0, SystemClock.elapsedRealtime());
        if (state.containsKey("error")) playback.setErrorMessage(MetrolistAudio.text(state.get("error")));
        session.setPlaybackState(playback.build());
        String key = title + "\n" + artist + "\n" + requested + "\n" + audio.remoteControlled();
        if (key.equals(notificationKey)) return;
        notificationKey = key;
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        session.setSessionActivity(content);
        Notification.Builder builder = new Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title).setContentText(artist).setContentIntent(content).setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true).setOngoing(requested).setCategory(Notification.CATEGORY_TRANSPORT);
        Notification.MediaStyle style = new Notification.MediaStyle().setMediaSession(session.getSessionToken());
        if (!audio.remoteControlled()) {
            builder.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "上一首", action("previous", 1)).build())
                    .addAction(new Notification.Action.Builder(requested ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                            requested ? "暂停" : "播放", action(requested ? "pause" : "play", 2)).build())
                    .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "下一首", action("next", 3)).build());
            style.setShowActionsInCompactView(0, 1, 2);
        }
        Notification notification = builder.setStyle(style).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION, notification);
    }
    @Override public void onDestroy() {
        service = null; starting = false;
        session.setActive(false); session.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        audio.stopPlayback();
        audio.release();
        stopping = false;
        if (pendingOpen != null) start(this);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
