package com.longbridge.nsh;

import com.google.gson.Gson;
import com.spotify.protocol.types.Album;
import com.spotify.protocol.types.Artist;
import com.spotify.protocol.types.ImageUri;
import com.spotify.protocol.types.PlayerOptions;
import com.spotify.protocol.types.PlayerRestrictions;
import com.spotify.protocol.types.PlayerState;
import com.spotify.protocol.types.Repeat;
import com.spotify.protocol.types.Track;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Runs against the real Spotify SDK model classes, without an Android device. */
public final class SpotifyProtocolTest {
    private static void equal(Object actual, Object expected) {
        if (!Objects.equals(actual, expected)) throw new AssertionError("Expected " + expected + ", received " + actual);
    }

    public static void main(String[] args) {
        // RFC 7636 Appendix B: S256 uses base64url with no padding.
        equal(SpotifyProtocol.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
                "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        String verifier = SpotifyProtocol.random();
        equal(verifier.length(), 43);
        String url = SpotifyProtocol.authorizationUrl("client & id", SpotifyProtocol.REDIRECT_URI, verifier, "request-state");
        equal(url.contains("client_id=client+%26+id"), true);
        equal(url.contains("response_type=code"), true);
        equal(url.contains("code_challenge_method=S256"), true);
        equal(url.contains("response_type=token"), false);
        Map<String, String> callback = SpotifyProtocol.callback(
                "metrolist-spotify://callback?code=a%2Bb%2Fc&state=request-state", SpotifyProtocol.REDIRECT_URI);
        equal(callback.get("code"), "a+b/c");
        equal(callback.get("state"), "request-state");
        equal(SpotifyProtocol.callback("metrolist-spotify://other?code=ignored", SpotifyProtocol.REDIRECT_URI), null);
        equal(SpotifyProtocol.callback("metrolist-spotify://callback/other?code=ignored", SpotifyProtocol.REDIRECT_URI), null);
        equal(SpotifyProtocol.callback("metrolist-spotify://callback?error=access_denied&state=x", SpotifyProtocol.REDIRECT_URI).get("error"), "access_denied");

        Artist first = new Artist("First artist", "spotify:artist:first");
        Artist second = new Artist("Second artist", "spotify:artist:second");
        Track track = new Track(first, Arrays.asList(first, second), new Album("Real album", "spotify:album:album"),
                206000, "SDK track", "spotify:track:track", new ImageUri("spotify:image:cover"), false, false);
        PlayerState source = new PlayerState(track, false, 1, 1875,
                new PlayerOptions(true, Repeat.ONE), new PlayerRestrictions(false, true, false, true, true, true));
        // The pinned Gson version must preserve Spotify's actual serialization annotations.
        Gson gson = new Gson();
        PlayerState decoded = gson.fromJson(gson.toJson(source), PlayerState.class);
        equal(decoded.track.name, "SDK track");
        equal(decoded.playbackPosition, 1875L);
        Map<String, Object> player = SpotifyProtocol.player(decoded, "spotify:playlist:queue", "data:image/jpeg;base64,actual", 123456);
        equal(player.get("artist"), "First artist, Second artist");
        equal(player.get("positionMs"), 1875L);
        equal(player.get("durationMs"), 206000L);
        equal(player.get("playing"), true);
        equal(player.get("contextUri"), "spotify:playlist:queue");
        equal(player.get("repeat"), "track");
        equal(player.get("canNext"), false);
        equal(player.get("canPrevious"), true);
        equal(player.get("at"), 123456L);
        equal(player.containsKey("premium"), false);
        PlayerState paused = new PlayerState(track, true, 0, 1900, PlayerOptions.DEFAULT, PlayerRestrictions.DEFAULT);
        equal(SpotifyProtocol.player(paused, "", "", 123457).get("playing"), false);
        PlayerState empty = new PlayerState(null, false, 1, 0, PlayerOptions.DEFAULT, PlayerRestrictions.DEFAULT);
        equal(SpotifyProtocol.player(empty, "", "", 123458).get("playing"), false);
        equal(SpotifyProtocol.player(empty, "", "", 123458).get("title"), "");

        int[] pixels = new int[24 * 24];
        Arrays.fill(pixels, 0, 288, 0xffff0000);
        Arrays.fill(pixels, 288, pixels.length, 0xff000000);
        equal(SpotifyProtocol.palette(pixels), Arrays.asList("#ff0000", "#000000"));
        equal(SpotifyProtocol.palette(new int[] { 0x00ff0000, 0x7fffffff }), Collections.emptyList());
        equal(SpotifyProtocol.palette(new int[] { 0xffff0000, 0xfffe0000 }), List.of("#ff0000"));
        System.out.println("PASS: PKCE request/callback, real SDK state + Gson, pause/empty state, and cover palette");
    }
}
