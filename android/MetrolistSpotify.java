package com.longbridge.nsh;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import com.spotify.android.appremote.api.ConnectionParams;
import com.spotify.android.appremote.api.Connector;
import com.spotify.android.appremote.api.SpotifyAppRemote;
import com.spotify.android.appremote.api.error.UserNotAuthorizedException;
import com.spotify.protocol.client.CallResult;
import com.spotify.protocol.client.Subscription;
import com.spotify.protocol.types.Empty;
import com.spotify.protocol.types.PlayerState;
import com.spotify.protocol.types.Repeat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONObject;
import static com.longbridge.nsh.SpotifyProtocol.object;

/** Controls the installed Spotify app; all audio remains in Spotify's Android service. */
public final class MetrolistSpotify implements AutoCloseable {
    private final Activity activity;
    private final NshView view;
    private final SharedPreferences preferences;
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final List<Subscription<?>> subscriptions = new ArrayList<>();
    private final List<SpotifyAppRemote> pauseConnections = new ArrayList<>();
    private final List<NshHostReply> connections = new ArrayList<>();
    private final List<NshHostReply> tokens = new ArrayList<>();
    private SpotifyAppRemote remote;
    private NshHostReply loginReply;
    private boolean active, started, connecting, closed, remoteAuthorizationRequired, refreshing, browserLeft, exchanging;
    private long connectionVersion, authVersion, playbackVersion;
    private String status = "ready", errorCode = "", errorMessage = "";
    private String contextUri = "", artworkKey = "", artwork = "";
    private Map<String, Object> player = SpotifyProtocol.emptyPlayer();
    private float volume = 1, audibleVolume = 1;
    private boolean volumeControllable;
    private Boolean onDemand;

    public MetrolistSpotify(Activity activity, NshView view) {
        this.activity = activity;
        this.view = view;
        preferences = activity.getSharedPreferences("metrolist.spotify", Activity.MODE_PRIVATE);
        remoteAuthorizationRequired = preferences.getBoolean("remoteAuthorizationRequired", false);
        if (!configured()) health("failed", "E_CONFIG", "Set a Spotify Client ID to connect this Android app.");
        handle("snapshot", (args, reply) -> reply.resolve(snapshot()));
        handle("configure", this::configure);
        handle("activate", (args, reply) -> activate(reply));
        handle("setActive", (args, reply) -> {
            if (Boolean.TRUE.equals(args.get("active"))) activate(reply);
            else {
                active = false;
                playbackVersion++;
                pause(reply, true);
            }
        });
        handle("signIn", (args, reply) -> signIn(reply));
        handle("cancelSignIn", (args, reply) -> { cancelLogin(); reply.resolve(snapshot()); });
        handle("signOut", (args, reply) -> signOut(reply));
        handle("retry", (args, reply) -> {
            if (!signedIn()) signIn(reply);
            else { active = true; connect(true, reply); }
        });
        handle("token", (args, reply) -> token(reply));
        handle("coverColors", (args, reply) -> coverColors(text(args, "imageUrl"), reply));
        handle("play", (args, reply) -> startPlayback(null, null, reply));
        handle("playTrack", (args, reply) -> startPlayback(text(args, "uri"), null, reply));
        handle("playContext", (args, reply) -> {
            if (!text(args, "trackUri").isEmpty() && !(args.get("index") instanceof Number)) {
                reply.reject("E_CONTEXT_INDEX: Resolve the track's position in its collection before starting it.");
                return;
            }
            startPlayback(text(args, "uri"), (Number) args.get("index"), reply);
        });
        handle("toggle", (args, reply) -> {
            if (Boolean.TRUE.equals(player.get("playing"))) pause(reply, false);
            else startPlayback(null, null, reply);
        });
        handle("pause", (args, reply) -> pause(reply, false));
        handle("next", (args, reply) -> command(reply, value -> value.getPlayerApi().skipNext()));
        handle("previous", (args, reply) -> command(reply, value -> value.getPlayerApi().skipPrevious()));
        handle("seek", (args, reply) -> command(reply, value -> value.getPlayerApi().seekTo(((Number) args.get("ms")).longValue())));
        handle("setShuffle", (args, reply) -> command(reply, value -> value.getPlayerApi().setShuffle(Boolean.TRUE.equals(args.get("on")))));
        handle("setRepeat", (args, reply) -> command(reply, value -> value.getPlayerApi().setRepeat(
                "track".equals(args.get("mode")) ? Repeat.ONE : "context".equals(args.get("mode")) ? Repeat.ALL : Repeat.OFF)));
        handle("setVolume", (args, reply) -> command(reply, value -> value.getConnectApi().connectSetVolume(((Number) args.get("volume")).floatValue())));
        handle("setMuted", (args, reply) -> command(reply, value -> value.getConnectApi().connectSetVolume(Boolean.TRUE.equals(args.get("on")) ? 0 : audibleVolume)));
    }

    private interface HostCall { void invoke(Map<String, Object> args, NshHostReply reply); }
    private interface RemoteCall { CallResult<Empty> invoke(SpotifyAppRemote value); }

    @SuppressWarnings("unchecked")
    private void handle(String name, HostCall call) {
        view.handle("app.spotify." + name, (data, reply) -> activity.runOnUiThread(() ->
                call.invoke(data == null ? object() : (Map<String, Object>) data, reply)));
    }

    private static String text(Map<String, Object> args, String name) {
        Object value = args.get(name);
        return value == null ? "" : String.valueOf(value);
    }

    private String clientId() { return preferences.getString("clientId", ""); }
    private String redirectUri() { return preferences.getString("redirectUri", SpotifyProtocol.REDIRECT_URI); }
    private boolean configured() { return !clientId().isEmpty(); }
    private boolean signedIn() { return !preferences.getString("accessToken", "").isEmpty(); }

    private Map<String, Object> snapshot() {
        Map<String, Object> state = new LinkedHashMap<>(player);
        state.put("volume", volume);
        state.put("muted", volume == 0);
        return object("player", state,
                "health", object("status", status, "error", errorCode.isEmpty() ? null : object("code", errorCode, "message", errorMessage)),
                "signedIn", signedIn(), "authRevision", preferences.getLong("authRevision", 0),
                "configuration", object("clientId", clientId(), "redirectUri", redirectUri(), "configured", configured()),
                "capabilities", object("volume", volumeControllable, "lyrics", true, "onDemand", onDemand),
                "deviceId", "");
    }

    private void publish() { if (!closed) view.send("app.spotify.state", snapshot()); }
    private void health(String next, String code, String message) { status = next; errorCode = code; errorMessage = message; }
    private void fail(String code, String message) { health("failed", code, message); publish(); }
    private void ui(Runnable action) { activity.runOnUiThread(() -> { if (!closed) action.run(); }); }

    private void configure(Map<String, Object> args, NshHostReply reply) {
        String id = text(args, "clientId").trim();
        String redirect = text(args, "redirectUri").trim();
        if (redirect.isEmpty()) redirect = SpotifyProtocol.REDIRECT_URI;
        if (!SpotifyProtocol.REDIRECT_URI.equals(redirect)) {
            reply.reject("E_CONFIG: This Android app's registered callback is " + SpotifyProtocol.REDIRECT_URI);
            return;
        }
        if (id.equals(clientId()) && redirect.equals(redirectUri())) { reply.resolve(snapshot()); return; }
        final String callback = redirect;
        Runnable apply = () -> {
            cancelLogin();
            disconnect();
            rejectConnections("E_CONFIG: Spotify configuration changed.");
            clearTokens();
            preferences.edit().putString("clientId", id).putString("redirectUri", callback).apply();
            player = SpotifyProtocol.emptyPlayer();
            contextUri = artworkKey = artwork = "";
            health(id.isEmpty() ? "failed" : "ready", id.isEmpty() ? "E_CONFIG" : "", id.isEmpty() ? "Set a Spotify Client ID to connect this Android app." : "");
            publish();
            reply.resolve(snapshot());
        };
        pause(false, apply, reply::reject);
    }

    private void activate(NshHostReply reply) {
        active = true;
        if (!configured()) { fail("E_CONFIG", "Set a Spotify Client ID to connect this Android app."); reply.resolve(snapshot()); return; }
        if (!signedIn()) { health("ready", "", ""); publish(); reply.resolve(snapshot()); return; }
        connect(false, reply);
    }

    private void connect(boolean showAuth, NshHostReply reply) {
        if (reply != null) connections.add(reply);
        if (remote != null && remote.isConnected()) { completeConnections(); finishLogin(null); return; }
        if (connecting || !started) return;
        if (!SpotifyAppRemote.isSpotifyInstalled(activity)) {
            connectionFailed(new IllegalStateException("Install Spotify and sign in on this phone."), "E_SPOTIFY_NOT_INSTALLED");
            return;
        }
        connecting = true;
        long version = ++connectionVersion;
        boolean authorize = showAuth || remoteAuthorizationRequired;
        health(authorize ? "signingIn" : "starting", "", "");
        publish();
        SpotifyAppRemote.connect(activity, new ConnectionParams.Builder(clientId())
                .setRedirectUri(redirectUri()).showAuthView(authorize).build(), new Connector.ConnectionListener() {
            @Override public void onConnected(SpotifyAppRemote value) { activity.runOnUiThread(() -> {
                if (closed || version != connectionVersion || !active) { SpotifyAppRemote.disconnect(value); return; }
                connecting = false;
                if (!started) { SpotifyAppRemote.disconnect(value); return; }
                remote = value;
                observe(value, version);
                value.getPlayerApi().getPlayerState().setResultCallback(state -> ui(() -> {
                    if (version != connectionVersion) return;
                    receive(state);
                    remoteAuthorizationRequired = false;
                    preferences.edit().putBoolean("remoteAuthorizationRequired", false).apply();
                    health("ready", "", "");
                    publish();
                    completeConnections();
                    finishLogin(null);
                })).setErrorCallback(error -> ui(() -> connectionFailed(error, "E_CONNECT")));
            }); }
            @Override public void onFailure(Throwable error) { ui(() -> {
                if (version == connectionVersion) connectionFailed(error, error instanceof UserNotAuthorizedException ? "E_AUTH" : "E_CONNECT");
            }); }
        });
    }

    private void observe(SpotifyAppRemote value, long version) {
        Subscription<PlayerState> states = value.getPlayerApi().subscribeToPlayerState();
        states.setEventCallback(state -> ui(() -> { if (version == connectionVersion) receive(state); }));
        states.setErrorCallback(error -> ui(() -> { if (version == connectionVersion) connectionFailed(error, "E_CONNECT"); }));
        subscriptions.add(states);
        var contexts = value.getPlayerApi().subscribeToPlayerContext();
        contexts.setEventCallback(context -> ui(() -> {
            if (version != connectionVersion) return;
            contextUri = context.uri;
            player.put("contextUri", contextUri);
            publish();
        }));
        subscriptions.add(contexts);
        var volumes = value.getConnectApi().subscribeToVolumeState();
        volumes.setEventCallback(state -> ui(() -> {
            if (version != connectionVersion) return;
            volume = state.mVolume;
            if (volume > 0) audibleVolume = volume;
            volumeControllable = state.mControllable;
            publish();
        }));
        volumes.setErrorCallback(error -> ui(() -> { if (version == connectionVersion) { volumeControllable = false; publish(); } }));
        subscriptions.add(volumes);
        var capabilities = value.getUserApi().subscribeToCapabilities();
        capabilities.setEventCallback(state -> ui(() -> {
            if (version != connectionVersion) return;
            onDemand = state.canPlayOnDemand;
            publish();
        }));
        subscriptions.add(capabilities);
        value.getUserApi().getCapabilities().setResultCallback(state -> ui(() -> {
            if (version != connectionVersion) return;
            onDemand = state.canPlayOnDemand;
            publish();
        }));
    }

    private void receive(PlayerState state) {
        String image = state.track == null || state.track.imageUri == null ? "" : state.track.imageUri.raw;
        if (!image.equals(artworkKey)) {
            artworkKey = image;
            artwork = "";
            if (!image.isEmpty() && remote != null) {
                remote.getImagesApi().getImage(state.track.imageUri).setResultCallback(bitmap -> ui(() -> {
                    if (!image.equals(artworkKey)) return;
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, bytes);
                    artwork = "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
                    player.put("artwork", artwork);
                    publish();
                }));
            }
        }
        player = SpotifyProtocol.player(state, contextUri, artwork, System.currentTimeMillis());
        publish();
    }

    private void completeConnections() {
        List<NshHostReply> replies = new ArrayList<>(connections);
        connections.clear();
        for (NshHostReply reply : replies) reply.resolve(snapshot());
    }

    private void connectionFailed(Throwable error, String code) {
        disconnect();
        fail(code, String.valueOf(error.getMessage()));
        for (NshHostReply reply : connections) reply.reject(code + ": " + error.getMessage());
        connections.clear();
        finishLogin(code + ": " + error.getMessage());
    }

    private void disconnect() {
        connectionVersion++;
        connecting = false;
        for (Subscription<?> subscription : subscriptions) subscription.cancel();
        subscriptions.clear();
        SpotifyAppRemote.disconnect(remote);
        remote = null;
        volumeControllable = false;
        onDemand = null;
    }

    private SpotifyAppRemote usable(NshHostReply reply) {
        if (!active) { reply.reject("E_INACTIVE: The Spotify workspace is not active."); return null; }
        if (remote == null || !remote.isConnected()) { reply.reject("E_CONNECT: Spotify is not connected. Reconnect to the installed Spotify app."); return null; }
        return remote;
    }

    private void command(NshHostReply reply, RemoteCall action) {
        SpotifyAppRemote value = usable(reply);
        if (value != null) done(value, action.invoke(value), () -> reply.resolve(null), reply::reject);
    }

    private void startPlayback(String uri, Number index, NshHostReply reply) {
        SpotifyAppRemote value = usable(reply);
        if (value == null) return;
        long version = ++playbackVersion;
        value.getConnectApi().connectSwitchToLocalDevice().setResultCallback(result -> ui(() -> {
            if (!active || version != playbackVersion || value != remote) { reply.reject("E_CANCELLED: Playback was cancelled."); return; }
            done(value, uri == null ? value.getPlayerApi().resume() : index == null ? value.getPlayerApi().play(uri)
                    : value.getPlayerApi().skipToIndex(uri, index.intValue()), () -> reply.resolve(null), reply::reject);
        })).setErrorCallback(error -> ui(() -> reply.reject("E_PLAYBACK: " + error.getMessage())));
    }

    private void pause(NshHostReply reply, boolean disconnectAfter) {
        pause(disconnectAfter, () -> reply.resolve(null), reply::reject);
    }

    private void pause(boolean disconnectAfter, Runnable complete, Consumer<String> failure) {
        playbackVersion++;
        SpotifyAppRemote value = remote;
        if (value == null || !value.isConnected()) {
            if (disconnectAfter) { disconnect(); rejectConnections("E_INACTIVE: The Spotify workspace was closed."); }
            // onStop releases the control connection while Spotify keeps playing.
            // A subsequent workspace switch must still stop that real playback.
            if (Boolean.TRUE.equals(player.get("playing")) && configured() && signedIn()) {
                SpotifyAppRemote.connect(activity, new ConnectionParams.Builder(clientId()).setRedirectUri(redirectUri()).showAuthView(false).build(), new Connector.ConnectionListener() {
                    @Override public void onConnected(SpotifyAppRemote connected) { activity.runOnUiThread(() -> {
                        if (closed) { SpotifyAppRemote.disconnect(connected); return; }
                        pauseConnections.add(connected);
                        connected.getPlayerApi().pause().setResultCallback(ignored -> ui(() -> connected.getPlayerApi().getPlayerState()
                                .setResultCallback(state -> ui(() -> { receive(state); releasePauseConnection(connected); complete.run(); }))
                                .setErrorCallback(error -> ui(() -> { releasePauseConnection(connected); failure.accept("E_PLAYBACK: " + error.getMessage()); }))))
                                .setErrorCallback(error -> ui(() -> { releasePauseConnection(connected); failure.accept("E_PLAYBACK: " + error.getMessage()); }));
                    }); }
                    @Override public void onFailure(Throwable error) { ui(() -> failure.accept("E_CONNECT: " + error.getMessage())); }
                });
                return;
            }
            complete.run();
            return;
        }
        done(value, value.getPlayerApi().pause(), () -> {
            if (disconnectAfter && value == remote) { disconnect(); publish(); }
            complete.run();
        }, failure);
    }

    private void releasePauseConnection(SpotifyAppRemote value) {
        pauseConnections.remove(value);
        SpotifyAppRemote.disconnect(value);
    }

    private void done(SpotifyAppRemote value, CallResult<Empty> result, Runnable complete, Consumer<String> failure) {
        result.setResultCallback(ignored -> ui(() -> value.getPlayerApi().getPlayerState()
                .setResultCallback(state -> ui(() -> {
                    if (value == remote) receive(state);
                    complete.run();
                })).setErrorCallback(error -> ui(() -> failure.accept("E_PLAYBACK: " + error.getMessage())))))
                .setErrorCallback(error -> ui(() -> failure.accept("E_PLAYBACK: " + error.getMessage())));
    }

    private void signIn(NshHostReply reply) {
        if (!configured()) { reply.reject("E_CONFIG: Set a Spotify Client ID before signing in."); return; }
        cancelLogin();
        active = true;
        loginReply = reply;
        if (signedIn()) { connect(true, null); return; }
        String verifier = SpotifyProtocol.random(), state = SpotifyProtocol.random();
        browserLeft = false;
        preferences.edit().putString("verifier", verifier).putString("oauthState", state).commit();
        health("signingIn", "", "");
        publish();
        activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(
                SpotifyProtocol.authorizationUrl(clientId(), redirectUri(), verifier, state))));
    }

    /** The singleTask activity receives this both on a cold launch and after browser authorization. */
    public boolean onNewIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Map<String, String> values = SpotifyProtocol.callback(intent.getData().toString(), redirectUri());
        if (values == null) return false;
        String expected = preferences.getString("oauthState", "");
        if (expected.isEmpty()) return true; // The activity may be recreated with an already-consumed callback intent.
        if (!expected.equals(values.get("state"))) {
            fail("E_AUTH_STATE", "The Spotify authorization response did not match the current sign-in request.");
            finishLogin("E_AUTH_STATE: The Spotify authorization response did not match the current sign-in request.");
            return true;
        }
        if (values.containsKey("error")) {
            preferences.edit().remove("oauthState").remove("verifier").apply();
            health("ready", "", "");
            publish();
            finishLogin("E_CANCELLED: " + values.get("error"));
            return true;
        }
        exchanging = true;
        long version = ++authVersion;
        Map<String, Object> body = object("client_id", clientId(), "grant_type", "authorization_code", "code", values.get("code"),
                "redirect_uri", redirectUri(), "code_verifier", preferences.getString("verifier", ""));
        exchange(body, version, () -> {
            exchanging = false;
            remoteAuthorizationRequired = true;
            preferences.edit().remove("oauthState").remove("verifier").apply();
            if (active) connect(true, null);
            else { health("ready", "", ""); publish(); finishLogin(null); }
        }, message -> { if (version == authVersion) { exchanging = false; fail("E_AUTH", message); finishLogin("E_AUTH: " + message); } });
        return true;
    }

    private void token(NshHostReply reply) {
        if (!configured()) { reply.reject("E_CONFIG: Set a Spotify Client ID before signing in."); return; }
        String accessToken = preferences.getString("accessToken", "");
        long expiresAt = preferences.getLong("expiresAt", 0);
        if (!accessToken.isEmpty() && expiresAt > System.currentTimeMillis() + 30000) {
            reply.resolve(object("accessToken", accessToken, "expiresAt", expiresAt));
            return;
        }
        String refreshToken = preferences.getString("refreshToken", "");
        if (refreshToken.isEmpty()) { reply.reject("E_AUTH: Sign in to Spotify to load your music."); return; }
        tokens.add(reply);
        if (refreshing) return;
        refreshing = true;
        long version = authVersion;
        exchange(object("client_id", clientId(), "grant_type", "refresh_token", "refresh_token", refreshToken), version,
                () -> {
                    refreshing = false;
                    Map<String, Object> result = object("accessToken", preferences.getString("accessToken", ""), "expiresAt", preferences.getLong("expiresAt", 0));
                    for (NshHostReply waiting : tokens) waiting.resolve(result);
                    tokens.clear();
                }, message -> {
                    refreshing = false;
                    if (version == authVersion) fail("E_AUTH", message);
                    for (NshHostReply waiting : tokens) waiting.reject("E_AUTH: " + message);
                    tokens.clear();
                });
    }

    private void exchange(Map<String, Object> body, long version, Runnable complete, Consumer<String> failure) {
        String oauthState = preferences.getString("oauthState", "");
        io.execute(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL("https://accounts.spotify.com/api/token").openConnection();
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                connection.setDoOutput(true);
                byte[] encoded = SpotifyProtocol.form(body).getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) { output.write(encoded); }
                int statusCode = connection.getResponseCode();
                String response;
                try (InputStream input = statusCode < 400 ? connection.getInputStream() : connection.getErrorStream();
                     ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    for (int count; (count = input.read(buffer)) != -1;) bytes.write(buffer, 0, count);
                    response = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
                } finally { connection.disconnect(); }
                JSONObject token = new JSONObject(response);
                if (statusCode >= 400) {
                    String message = token.optString("error_description", token.optString("error", "Spotify token request failed: " + statusCode));
                    activity.runOnUiThread(() -> {
                        if (version == authVersion && text(body, "client_id").equals(clientId())
                                && "refresh_token".equals(body.get("grant_type"))
                                && text(body, "refresh_token").equals(preferences.getString("refreshToken", ""))
                                && "invalid_grant".equals(token.optString("error"))) {
                            clearTokens();
                            if (!closed) fail("E_AUTH", message);
                        }
                        if (!closed) failure.accept(message);
                    });
                    return;
                }
                String accessToken = token.getString("access_token");
                long expiresIn = token.getLong("expires_in");
                // Token persistence survives activity recreation; only UI callbacks belong to the old view.
                activity.runOnUiThread(() -> {
                    boolean codeGrant = "authorization_code".equals(body.get("grant_type"));
                    boolean current = text(body, "client_id").equals(clientId()) && (codeGrant
                            ? !oauthState.isEmpty() && oauthState.equals(preferences.getString("oauthState", ""))
                            : text(body, "refresh_token").equals(preferences.getString("refreshToken", "")));
                    if (version != authVersion || !current) { if (!closed) failure.accept("The sign-in session changed."); return; }
                    SharedPreferences.Editor editor = preferences.edit().putString("accessToken", accessToken)
                            .putString("refreshToken", token.optString("refresh_token", preferences.getString("refreshToken", "")))
                            .putLong("expiresAt", System.currentTimeMillis() + expiresIn * 1000)
                            .putLong("authRevision", preferences.getLong("authRevision", 0) + 1);
                    if (codeGrant) editor.remove("oauthState").remove("verifier").putBoolean("remoteAuthorizationRequired", true);
                    editor.apply();
                    if (!closed) { publish(); complete.run(); }
                });
            } catch (Exception error) { ui(() -> failure.accept(String.valueOf(error.getMessage()))); }
        });
    }

    private void cancelLogin() {
        authVersion++;
        browserLeft = exchanging = false;
        remoteAuthorizationRequired = false;
        if (connecting && "signingIn".equals(status)) { disconnect(); rejectConnections("E_CANCELLED: Spotify sign-in was cancelled."); }
        preferences.edit().remove("oauthState").remove("verifier").remove("remoteAuthorizationRequired").apply();
        finishLogin("E_CANCELLED: Spotify sign-in was cancelled.");
        if ("signingIn".equals(status)) { health("ready", "", ""); publish(); }
    }

    private void finishLogin(String error) {
        NshHostReply reply = loginReply;
        loginReply = null;
        if (reply != null) {
            if (error == null) reply.resolve(snapshot());
            else reply.reject(error);
        }
    }

    private void clearTokens() {
        authVersion++;
        remoteAuthorizationRequired = false;
        preferences.edit().remove("accessToken").remove("refreshToken").remove("expiresAt")
                .remove("remoteAuthorizationRequired")
                .putLong("authRevision", preferences.getLong("authRevision", 0) + 1).apply();
    }

    private void signOut(NshHostReply reply) {
        playbackVersion++;
        Runnable clear = () -> {
            cancelLogin();
            disconnect();
            rejectConnections("E_AUTH: Signed out of Spotify.");
            clearTokens();
            player = SpotifyProtocol.emptyPlayer();
            contextUri = artworkKey = artwork = "";
            health("ready", "", "");
            publish();
            reply.resolve(snapshot());
        };
        pause(false, clear, reply::reject);
    }

    private void rejectConnections(String error) {
        for (NshHostReply reply : connections) reply.reject(error);
        connections.clear();
    }

    private void coverColors(String url, NshHostReply reply) {
        if (url.isEmpty()) { reply.resolve(new ArrayList<String>()); return; }
        io.execute(() -> {
            try {
                Bitmap source;
                if (url.startsWith("data:")) {
                    byte[] bytes = Base64.decode(url.substring(url.indexOf(',') + 1), Base64.DEFAULT);
                    source = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                } else {
                    try (InputStream input = new URL(url).openStream()) { source = BitmapFactory.decodeStream(input); }
                }
                Bitmap sample = Bitmap.createScaledBitmap(source, 24, 24, true);
                int[] pixels = new int[24 * 24];
                sample.getPixels(pixels, 0, 24, 0, 0, 24, 24);
                List<String> colors = SpotifyProtocol.palette(pixels);
                if (sample != source) sample.recycle();
                source.recycle();
                ui(() -> reply.resolve(colors));
            } catch (Exception error) { ui(() -> reply.reject("E_IMAGE: " + error.getMessage())); }
        });
    }

    /** Reconnect without opening authorization when the NSH activity becomes visible. */
    public void onStart() {
        started = true;
        if (active && signedIn()) connect(loginReply != null, null);
    }

    /** Android delivers a new redirect intent before onResume, not necessarily before onStart. */
    public void onResume() {
        if (browserLeft && !exchanging && !preferences.getString("oauthState", "").isEmpty()) cancelLogin();
        browserLeft = false;
    }

    /** Spotify keeps playing in its own app when our activity goes into the background. */
    public void onStop() {
        started = false;
        browserLeft = !preferences.getString("oauthState", "").isEmpty();
        if (remote != null) disconnect();
    }

    @Override public void close() {
        finishLogin("E_CLOSED: The Android activity was closed.");
        disconnect();
        for (SpotifyAppRemote value : pauseConnections) SpotifyAppRemote.disconnect(value);
        pauseConnections.clear();
        rejectConnections("E_CLOSED: The Android activity was closed.");
        for (NshHostReply reply : tokens) reply.reject("E_CLOSED: The Android activity was closed.");
        tokens.clear();
        closed = true;
        io.shutdown();
    }
}
