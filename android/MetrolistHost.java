package com.longbridge.nsh;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Android services used by the NSH UI, including its native Media3 audio engine. */
public final class MetrolistHost implements AutoCloseable {
    private static final int OPEN_AUDIO = 9121, OPEN_LIBRARY = 9122, SAVE_FILE = 9123;
    private static final String LOGIN_URL = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com";
    private final Activity activity;
    private final NshView view;
    private final File music;
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Map<String, Download> downloads = new ConcurrentHashMap<>();
    private NshHostReply pickerReply;
    private File exportFile;
    private String exportContent;
    private Dialog loginDialog;
    private NshHostReply loginReply;

    public MetrolistHost(Activity activity, NshView view) {
        this.activity = activity;
        this.view = view;
        music = new File(activity.getFilesDir(), "nsh/" + activity.getPackageName() + "/music");
        music.mkdirs();
        view.handle("app.capabilities", (data, reply) -> reply.resolve(object("platform", "android", "login", true, "downloads", true, "audioImport", true, "libraryImport", true, "exports", true, "audioEngine", MetrolistAudio.ENGINE)));
        MetrolistAudio.attach(view);
        view.handle("app.audio.open", (data, reply) -> MetrolistMediaService.open(activity, arguments(data), reply));
        view.handle("app.audio.play", (data, reply) -> { MetrolistMediaService.play(); reply.resolve(null); });
        view.handle("app.audio.pause", (data, reply) -> { MetrolistMediaService.pause(); reply.resolve(null); });
        view.handle("app.audio.seek", (data, reply) -> { MetrolistMediaService.seek(MetrolistAudio.number(arguments(data), "position", 0)); reply.resolve(null); });
        view.handle("app.audio.settings", (data, reply) -> { MetrolistMediaService.settings(arguments(data)); reply.resolve(null); });
        view.handle("app.audio.stop", (data, reply) -> { MetrolistMediaService.stop(activity); reply.resolve(null); });
        view.handle("app.audio.snapshot", (data, reply) -> reply.resolve(MetrolistAudio.current() == null ? null : MetrolistAudio.current().snapshot()));
        view.handle("app.audio.preload", (data, reply) -> {
            if (MetrolistAudio.current() != null) MetrolistAudio.current().preload(arguments(data));
            reply.resolve(null);
        });
        view.handle("app.audio.cancelPreload", (data, reply) -> {
            if (MetrolistAudio.current() != null) MetrolistAudio.current().cancelPreload();
            reply.resolve(null);
        });
        view.handle("auth.available", (data, reply) -> reply.resolve(object("available", true, "method", "webview")));
        view.handle("auth.login", (data, reply) -> login(arguments(data), reply));
        view.handle("auth.logout", (data, reply) -> CookieManager.getInstance().removeAllCookies(removed -> {
            CookieManager.getInstance().flush();
            WebStorage.getInstance().deleteAllData();
            reply.resolve(object("cleared", true));
        }));
        view.handle("files.download", (data, reply) -> {
            Map<String, Object> args = arguments(data);
            Download download = new Download(string(args, "id"), string(args, "url"), reply);
            downloads.put(download.id, download);
            io.execute(download);
        });
        view.handle("files.cancelDownload", (data, reply) -> {
            Download download = downloads.get(string(arguments(data), "id"));
            if (download != null) download.cancel();
            reply.resolve(null);
        });
        view.handle("files.removeDownload", (data, reply) -> {
            String id = string(arguments(data), "id");
            Download download = downloads.get(id);
            if (download != null) download.cancel();
            File file = audioFile(id);
            if (file.exists() && !file.delete()) reply.reject("无法移除下载文件");
            else reply.resolve(null);
        });
        view.handle("files.exportAudio", (data, reply) -> {
            Map<String, Object> args = arguments(data);
            exportFile = audioFile(string(args, "id"));
            exportContent = null;
            saveDocument(string(args, "name"), "audio/*", reply);
        });
        view.handle("files.import", (data, reply) -> {
            boolean library = "library".equals(string(arguments(data), "kind"));
            pickerReply = reply;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(library ? "application/json" : "audio/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, !library);
            activity.startActivityForResult(intent, library ? OPEN_LIBRARY : OPEN_AUDIO);
        });
        view.handle("files.export", (data, reply) -> {
            Map<String, Object> args = arguments(data);
            exportFile = null;
            exportContent = string(args, "content");
            saveDocument(string(args, "name"), string(args, "type"), reply);
        });
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> arguments(Object value) {
        return value == null ? object() : (Map<String, Object>) value;
    }
    private static String string(Map<String, Object> value, String key) {
        Object item = value.get(key);
        return item == null ? "" : String.valueOf(item);
    }
    private static Map<String, Object> object(Object... pairs) {
        Map<String, Object> result = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]);
        return result;
    }
    private File audioFile(String id) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
            StringBuilder name = new StringBuilder(64);
            for (byte value : hash) {
                name.append(Character.forDigit((value >> 4) & 15, 16));
                name.append(Character.forDigit(value & 15, 16));
            }
            return new File(music, name + ".audio");
        } catch (NoSuchAlgorithmException exception) {
            throw new AssertionError(exception);
        }
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }

    @SuppressLint("SetJavaScriptEnabled")
    private void login(Map<String, Object> args, NshHostReply reply) {
        loginReply = reply;
        Dialog dialog = new Dialog(activity, android.R.style.Theme_Material_NoActionBar);
        loginDialog = dialog;
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setOnApplyWindowInsetsListener((root, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = bars.left; top = bars.top; right = bars.right; bottom = bars.bottom;
            } else {
                left = insets.getStableInsetLeft(); top = insets.getStableInsetTop();
                right = insets.getStableInsetRight(); bottom = insets.getStableInsetBottom();
                if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                    left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
                    top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                    right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
                    bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                }
            }
            root.setPadding(left, top, right, bottom);
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(activity);
        TextView title = new TextView(activity);
        title.setText("登录 YouTube Music");
        title.setTextSize(16);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setPadding(dp(12), 0, dp(12), 0);
        Button cancel = new Button(activity);
        cancel.setText("取消");
        Button done = new Button(activity);
        done.setText("完成");
        toolbar.addView(cancel);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1));
        toolbar.addView(done);
        column.addView(toolbar);
        WebView web = new WebView(activity);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setSupportZoom(true);
        web.getSettings().setBuiltInZoomControls(true);
        web.getSettings().setDisplayZoomControls(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView value, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("https".equals(scheme) || "http".equals(scheme)) return false;
                if ("intent".equals(scheme)) {
                    try {
                        Intent intent = Intent.parseUri(request.getUrl().toString(), Intent.URI_INTENT_SCHEME);
                        intent.addCategory(Intent.CATEGORY_BROWSABLE);
                        intent.setComponent(null); intent.setSelector(null);
                        activity.startActivity(intent);
                    } catch (Exception error) { title.setText("无法打开此登录步骤，请在页面选择其他方式"); }
                }
                return true;
            }
        });
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        column.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        dialog.setContentView(column);
        cancel.setOnClickListener(v -> dialog.cancel());
        dialog.setOnCancelListener(value -> {
            if (loginReply != null) { loginReply.reject("已取消登录"); loginReply = null; }
        });
        dialog.setOnDismissListener(value -> {
            web.destroy();
            loginDialog = null;
        });
        done.setOnClickListener(v -> {
            String cookie = cookies.getCookie("https://music.youtube.com");
            if (cookie == null || !cookie.contains("SAPISID=")) {
                title.setText("请先完成 Google 登录");
                return;
            }
            web.evaluateJavascript("(function(){var c=(window.yt&&window.yt.config_)||(window.ytcfg&&window.ytcfg.data_)||{};return JSON.stringify({visitorData:c.VISITOR_DATA||'',dataSyncId:c.DATASYNC_ID||'',authUser:String(c.SESSION_INDEX||0)});})()", encoded -> {
                try {
                    JSONObject context = new JSONObject((String) new JSONTokener(encoded).nextValue());
                    Map<String, Object> result = new HashMap<>();
                    result.put("cookie", cookie);
                    result.put("visitorData", context.optString("visitorData"));
                    result.put("dataSyncId", context.optString("dataSyncId"));
                    result.put("authUser", context.optString("authUser", "0"));
                    cookies.flush();
                    loginReply.resolve(result);
                    loginReply = null;
                    dialog.dismiss();
                } catch (Exception error) { title.setText("请进入 YouTube Music 后再点完成"); }
            });
        });
        dialog.show();
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        dialog.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        column.requestApplyInsets();
        String url = string(args, "url");
        web.loadUrl(url.isEmpty() ? LOGIN_URL : url);
    }

    private final class Download implements Runnable {
        final String id, url;
        final NshHostReply reply;
        volatile boolean cancelled;
        volatile URLConnection connection;
        volatile InputStream input;
        Download(String id, String url, NshHostReply reply) { this.id = id; this.url = url; this.reply = reply; }
        void cancel() {
            cancelled = true;
            if (connection instanceof HttpURLConnection) ((HttpURLConnection) connection).disconnect();
            try { if (input != null) input.close(); } catch (IOException ignored) {}
        }
        @Override public void run() {
            File file = audioFile(id);
            File part = new File(file.getPath() + ".part");
            try {
                connection = new URL(url).openConnection();
                if (connection instanceof HttpURLConnection) {
                    int status = ((HttpURLConnection) connection).getResponseCode();
                    if (status < 200 || status >= 300) throw new IOException("下载返回 HTTP " + status);
                }
                long total = connection.getContentLengthLong();
                long bytes = 0, last = 0;
                input = connection.getInputStream();
                try (InputStream source = input; OutputStream output = new FileOutputStream(part)) {
                    byte[] buffer = new byte[65536];
                    for (int read; (read = source.read(buffer)) != -1;) {
                        if (cancelled) throw new IOException("已取消下载");
                        output.write(buffer, 0, read);
                        bytes += read;
                        long now = System.currentTimeMillis();
                        if (now - last >= 200) { progress(bytes, total, false); last = now; }
                    }
                }
                if (cancelled) throw new IOException("已取消下载");
                if (!part.renameTo(file)) throw new IOException("无法保存音频文件");
                progress(bytes, total, true);
                reply.resolve(object("destination", file.getAbsolutePath(), "url", Uri.fromFile(file).toString(), "bytes", bytes));
            } catch (Exception error) {
                part.delete();
                reply.reject(cancelled ? "已取消下载" : error.getMessage());
            } finally {
                downloads.remove(id, this);
                if (connection instanceof HttpURLConnection) ((HttpURLConnection) connection).disconnect();
            }
        }
        void progress(long bytes, long total, boolean complete) {
            Map<String, Object> event = new HashMap<>();
            event.put("id", id); event.put("bytes", bytes);
            if (total > 0) event.put("totalBytes", total);
            event.put("progress", complete ? 1.0 : total > 0 ? (double) bytes / total : 0.0);
            view.send("files.download.progress", event);
        }
    }

    private void saveDocument(String name, String type, NshHostReply reply) {
        pickerReply = reply;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(type.isEmpty() ? "application/octet-stream" : type).putExtra(Intent.EXTRA_TITLE, name);
        activity.startActivityForResult(intent, SAVE_FILE);
    }

    public boolean onActivityResult(int request, int result, Intent intent) {
        if (request != OPEN_AUDIO && request != OPEN_LIBRARY && request != SAVE_FILE) return false;
        NshHostReply reply = pickerReply;
        pickerReply = null;
        if (result != Activity.RESULT_OK || intent == null) { reply.reject("已取消选择文件"); return true; }
        if (request == SAVE_FILE) {
            File file = exportFile;
            String content = exportContent;
            io.execute(() -> {
                try (OutputStream output = activity.getContentResolver().openOutputStream(intent.getData())) {
                    if (file != null) try (InputStream input = new FileInputStream(file)) { copy(input, output); }
                    else output.write(content.getBytes(StandardCharsets.UTF_8));
                    reply.resolve(object("saved", true));
                } catch (Exception error) { reply.reject(error.getMessage()); }
            });
            return true;
        }
        ArrayList<Uri> uris = new ArrayList<>();
        if (intent.getClipData() != null) for (int i = 0; i < intent.getClipData().getItemCount(); i++) uris.add(intent.getClipData().getItemAt(i).getUri());
        else uris.add(intent.getData());
        io.execute(() -> {
            try {
                if (request == OPEN_LIBRARY) {
                    try (InputStream input = activity.getContentResolver().openInputStream(uris.get(0)); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                        copy(input, bytes);
                        reply.resolve(new JSONTokener(new String(bytes.toByteArray(), StandardCharsets.UTF_8)).nextValue());
                    }
                } else {
                    ArrayList<Map<String, Object>> tracks = new ArrayList<>();
                    for (Uri uri : uris) tracks.add(importAudio(uri));
                    reply.resolve(tracks);
                }
            } catch (Exception error) { reply.reject(error.getMessage()); }
        });
        return true;
    }

    private Map<String, Object> importAudio(Uri uri) throws Exception {
        String name = "音频";
        try (Cursor cursor = activity.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        }
        String id = "local-" + UUID.randomUUID();
        File file = audioFile(id);
        try (InputStream input = activity.getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(file)) { copy(input, output); }
        Map<String, Object> track = new HashMap<>();
        MediaMetadataRetriever metadata = new MediaMetadataRetriever();
        try {
            metadata.setDataSource(file.getAbsolutePath());
            String title = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String album = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            String duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            track.put("id", id); track.put("title", title == null ? name : title);
            track.put("artist", artist == null ? "本地音频" : artist); track.put("album", album == null ? "" : album);
            track.put("duration", duration == null ? 0 : Double.parseDouble(duration) / 1000);
            track.put("artwork", ""); track.put("source", "audio"); track.put("url", Uri.fromFile(file).toString());
        } finally { metadata.release(); }
        return track;
    }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[65536];
        for (int read; (read = input.read(buffer)) != -1;) output.write(buffer, 0, read);
    }
    @Override public void close() {
        for (Download download : downloads.values()) download.cancel();
        io.shutdown();
        MetrolistAudio.detach(view);
        if (loginDialog != null) loginDialog.cancel();
        if (pickerReply != null) { pickerReply.reject("应用已关闭"); pickerReply = null; }
    }
}
