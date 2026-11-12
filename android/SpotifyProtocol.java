package com.longbridge.nsh;

import com.spotify.protocol.types.PlayerState;
import com.spotify.protocol.types.Repeat;
import com.spotify.protocol.types.Track;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/** The App Remote and OAuth wire formats shared with the native NSH workspace. */
final class SpotifyProtocol {
    static final String REDIRECT_URI = "metrolist-spotify://callback";
    static final String SCOPES = "streaming user-read-email user-read-private user-read-playback-state "
            + "user-modify-playback-state user-library-read user-library-modify playlist-read-private "
            + "playlist-read-collaborative user-read-recently-played user-follow-read app-remote-control";

    private SpotifyProtocol() {}

    static Map<String, Object> object(Object... pairs) {
        Map<String, Object> value = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) value.put((String) pairs[i], pairs[i + 1]);
        return value;
    }

    static String random() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String challenge(String verifier) {
        try {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(
                    MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError(error);
        }
    }

    static String form(Map<String, Object> values) {
        return values.entrySet().stream().map(entry -> encode(entry.getKey()) + "=" + encode(String.valueOf(entry.getValue())))
                .collect(Collectors.joining("&"));
    }

    private static String encode(String value) {
        try { return URLEncoder.encode(value, "UTF-8"); }
        catch (UnsupportedEncodingException error) { throw new AssertionError(error); }
    }

    private static String decode(String value) {
        try { return URLDecoder.decode(value, "UTF-8"); }
        catch (UnsupportedEncodingException error) { throw new AssertionError(error); }
    }

    static String authorizationUrl(String clientId, String redirectUri, String verifier, String state) {
        return "https://accounts.spotify.com/authorize?" + form(object(
                "client_id", clientId, "response_type", "code", "redirect_uri", redirectUri,
                "scope", SCOPES, "code_challenge_method", "S256", "code_challenge", challenge(verifier),
                "state", state, "show_dialog", "true"));
    }

    static Map<String, String> callback(String url, String redirectUri) {
        URI actual = URI.create(url), expected = URI.create(redirectUri);
        if (!expected.getScheme().equals(actual.getScheme())
                || !expected.getRawAuthority().equals(actual.getRawAuthority())
                || !expected.getRawPath().equals(actual.getRawPath())) return null;
        Map<String, String> values = new LinkedHashMap<>();
        if (actual.getRawQuery() != null) for (String pair : actual.getRawQuery().split("&")) {
            String[] entry = pair.split("=", 2);
            values.put(decode(entry[0]), entry.length == 2 ? decode(entry[1]) : "");
        }
        return values;
    }

    static Map<String, Object> emptyPlayer() {
        return object("title", "", "artist", "", "album", "", "artwork", "", "trackUri", "", "contextUri", "",
                "playing", false, "positionMs", 0L, "durationMs", 0L, "at", 0L,
                "shuffle", false, "shuffleAvailable", false, "repeat", "off", "canNext", false,
                "canPrevious", false, "ad", false, "liked", false, "premium", null);
    }

    /** Adapted from Spotish's paletteOf; see third-party/spotish/README.md. Input is Android ARGB. */
    static List<String> palette(int[] pixels) {
        List<double[]> points = new ArrayList<>();
        for (int pixel : pixels) if ((pixel >>> 24) >= 128) points.add(new double[] {
                (pixel >> 16) & 255, (pixel >> 8) & 255, pixel & 255 });
        if (points.isEmpty()) return new ArrayList<>();
        int k = Math.min(8, points.size());
        double[][] centers = new double[k][];
        for (int j = 0; j < k; j++) centers[j] = points.get((int) ((j + 0.5) * points.size() / k)).clone();
        int[] counts = new int[k];
        for (int round = 0; round < 10; round++) {
            double[][] sums = new double[k][3];
            counts = new int[k];
            for (double[] point : points) {
                int best = 0;
                double bestDistance = Double.POSITIVE_INFINITY;
                for (int j = 0; j < k; j++) {
                    double distance = distance(point, centers[j]);
                    if (distance < bestDistance) { bestDistance = distance; best = j; }
                }
                for (int channel = 0; channel < 3; channel++) sums[best][channel] += point[channel];
                counts[best]++;
            }
            for (int j = 0; j < k; j++) if (counts[j] > 0)
                for (int channel = 0; channel < 3; channel++) centers[j][channel] = sums[j][channel] / counts[j];
        }
        List<double[]> scored = new ArrayList<>();
        for (int j = 0; j < k; j++) if (counts[j] > 0) {
            double[] color = centers[j];
            double hi = Math.max(color[0], Math.max(color[1], color[2]));
            double lo = Math.min(color[0], Math.min(color[1], color[2]));
            double saturation = hi == 0 ? 0 : (hi - lo) / hi;
            scored.add(new double[] { color[0], color[1], color[2], (double) counts[j] / points.size() * (0.25 + saturation) });
        }
        scored.sort(Comparator.comparingDouble((double[] color) -> color[3]).reversed());
        List<double[]> picked = new ArrayList<>();
        for (double[] color : scored) {
            if (picked.stream().anyMatch(other -> distance(other, color) < 1600)) continue;
            picked.add(color);
            if (picked.size() == 5) break;
        }
        return picked.stream().map(color -> String.format(Locale.ROOT, "#%02x%02x%02x",
                Math.round(color[0]), Math.round(color[1]), Math.round(color[2]))).collect(Collectors.toList());
    }

    private static double distance(double[] a, double[] b) {
        double r = a[0] - b[0], g = a[1] - b[1], blue = a[2] - b[2];
        return r * r + g * g + blue * blue;
    }

    static Map<String, Object> player(PlayerState state, String contextUri, String artwork, long at) {
        Track track = state.track;
        String artists = track == null ? "" : track.artists.stream().map(artist -> artist.name).collect(Collectors.joining(", "));
        return object(
                "title", track == null ? "" : track.name,
                "artist", artists,
                "album", track == null ? "" : track.album.name,
                "artwork", artwork,
                "trackUri", track == null ? "" : track.uri,
                "contextUri", contextUri,
                "playing", track != null && !state.isPaused,
                "positionMs", state.playbackPosition,
                "durationMs", track == null ? 0L : track.duration,
                "at", at,
                "shuffle", state.playbackOptions.isShuffling,
                "shuffleAvailable", state.playbackRestrictions.canToggleShuffle,
                "repeat", state.playbackOptions.repeatMode == Repeat.ONE ? "track"
                        : state.playbackOptions.repeatMode == Repeat.ALL ? "context" : "off",
                "canNext", state.playbackRestrictions.canSkipNext,
                "canPrevious", state.playbackRestrictions.canSkipPrev,
                "ad", track != null && track.uri.startsWith("spotify:ad:"));
    }
}
