package com.longbridge.nsh;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Google renders the sign-in form; only the resulting Music session reaches the account API. */
final class MetrolistLogin implements AutoCloseable {
    private static final String MUSIC = "https://music.youtube.com";
    private static final String LOGIN = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com";
    private static final String CHOOSE_ACCOUNT = "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fmusic.youtube.com";
    private static final String SESSION_SCRIPT = "(function(){var c=(window.yt&&window.yt.config_)||(window.ytcfg&&window.ytcfg.data_)||{};return JSON.stringify({visitorData:c.VISITOR_DATA||'',dataSyncId:c.DATASYNC_ID||'',authUser:String(c.SESSION_INDEX||0)});})()";

    private final Activity activity;
    private final NshView bridge;
    private final Object requestId;
    private final NshHostReply reply;
    private final Runnable onClosed;
    private final Dialog dialog;
    private final CookieManager cookies = CookieManager.getInstance();
    private final WebView web;
    private final TextView address, message;
    private final ProgressBar progress, spinner;
    private final LinearLayout overlay;
    private final TextView overlayTitle, overlayDetail, primary, secondary;
    private final int surface, text, muted, accent, accentText, line;
    private final boolean dark;
    private final Runnable readSession = this::readSession;
    private boolean closed, reading, verifying, pageFailed, resumingSession;
    private int pageVersion, readCount;
    private String attemptId = "";
    private String failedSession = "";
    private String sessionError = "";

    @SuppressLint("SetJavaScriptEnabled")
    MetrolistLogin(Activity activity, NshView bridge, Map<String, Object> args, NshHostReply reply, Runnable onClosed) {
        this.activity = activity;
        this.bridge = bridge;
        this.requestId = args.get("requestId");
        this.reply = reply;
        this.onClosed = onClosed;
        dark = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        surface = Color.parseColor(dark ? "#141319" : "#faf8ff");
        text = Color.parseColor(dark ? "#e9e6f2" : "#1c1b24");
        muted = Color.parseColor(dark ? "#b8b3c5" : "#625f71");
        accent = Color.parseColor(dark ? "#c7c3f5" : "#5c568c");
        accentText = Color.parseColor(dark ? "#302c54" : "#ffffff");
        line = Color.parseColor(dark ? "#393641" : "#d8d3e2");
        dialog = new Dialog(activity, android.R.style.Theme_Material_NoActionBar) {
            @Override public void onBackPressed() { back(); }
        };
        dialog.setOnCancelListener(ignored -> finish(object("cancelled", true)));

        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(surface);
        column.setOnApplyWindowInsetsListener((root, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                root.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                int left = insets.getSystemWindowInsetLeft(), top = insets.getSystemWindowInsetTop();
                int right = insets.getSystemWindowInsetRight(), bottom = insets.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                    left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
                    top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                    right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
                    bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                }
                root.setPadding(left, top, right, bottom);
            }
            return insets;
        });

        LinearLayout toolbar = new LinearLayout(activity);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(8), 0, dp(8), 0);
        NavButton back = new NavButton(false, "返回上一页");
        back.setOnClickListener(ignored -> back());
        toolbar.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout heading = new LinearLayout(activity);
        heading.setOrientation(LinearLayout.VERTICAL);
        heading.setPadding(dp(8), 0, dp(8), 0);
        TextView title = label("连接 YouTube Music", 16, text);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        address = label("accounts.google.com", 12, muted);
        address.setSingleLine(true);
        address.setEllipsize(TextUtils.TruncateAt.END);
        heading.addView(title);
        heading.addView(address);
        toolbar.addView(heading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        NavButton cancel = new NavButton(true, "取消登录");
        cancel.setOnClickListener(ignored -> close());
        toolbar.addView(cancel, new LinearLayout.LayoutParams(dp(48), dp(48)));
        column.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64)));

        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(ColorStateList.valueOf(accent));
        progress.setProgressBackgroundTintList(ColorStateList.valueOf(line));
        progress.setIndeterminateTintList(ColorStateList.valueOf(accent));
        column.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));
        FrameLayout content = new FrameLayout(activity);
        web = new WebView(activity);
        web.setBackgroundColor(dark ? Color.parseColor("#0e0d12") : Color.WHITE);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setSupportZoom(true);
        web.getSettings().setBuiltInZoomControls(true);
        web.getSettings().setDisplayZoomControls(false);
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView value, int percent) {
                if (!verifying) {
                    progress.setProgress(percent);
                    progress.setVisibility(percent < 100 ? View.VISIBLE : View.INVISIBLE);
                }
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView value, String url, android.graphics.Bitmap icon) {
                ++pageVersion;
                reading = false;
                pageFailed = false;
                readCount = 0;
                web.removeCallbacks(readSession);
                address.setText(Uri.parse(url).getHost());
                if (!verifying) {
                    overlay.setVisibility(View.GONE);
                    stage("waiting", "在 Google 页面完成登录，验证后会自动返回");
                }
            }
            @Override public void onPageFinished(WebView value, String url) {
                if (closed || verifying || pageFailed) return;
                if (googleRejected(Uri.parse(url))) {
                    showError("Google 未允许此登录方式", "此 Google 页面拒绝了应用内登录。可返回账号页，通过「导入本人会话」连接已有的 YouTube Music 账号。", "返回账号页", MetrolistLogin.this::close, "查看 Google 页面", MetrolistLogin.this::showPage);
                } else if (isMusic(url)) {
                    web.removeCallbacks(readSession);
                    readSession();
                }
            }
            @Override public void onReceivedError(WebView value, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame() || closed) return;
                pageFailed = true;
                showError("登录页面未能加载", error.getDescription().toString(), "重新加载", () -> web.reload(), "返回账号页", MetrolistLogin.this::close);
            }
            @Override public void onReceivedHttpError(WebView value, WebResourceRequest request, WebResourceResponse response) {
                if (!request.isForMainFrame() || closed) return;
                pageFailed = true;
                String detail = response.getStatusCode() == 403
                    ? "Google 拒绝了此登录页面（HTTP 403）。如果重新加载仍被拒绝，可返回账号页导入本人已有的会话。"
                    : "登录页面返回 HTTP " + response.getStatusCode() + "。可稍后重新加载。";
                showError("Google 页面暂不可用", detail, "重新加载", () -> web.reload(), "返回账号页", MetrolistLogin.this::close);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView value, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("https".equals(scheme) || "http".equals(scheme)) return false;
                if ("intent".equals(scheme)) {
                    try {
                        Intent intent = Intent.parseUri(request.getUrl().toString(), Intent.URI_INTENT_SCHEME);
                        intent.addCategory(Intent.CATEGORY_BROWSABLE);
                        intent.setComponent(null);
                        intent.setSelector(null);
                        activity.startActivity(intent);
                    } catch (Exception error) {
                        stage("waiting", "无法打开该验证应用，请在 Google 页面选择其他验证方式");
                    }
                }
                return true;
            }
        });
        content.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        overlay = new LinearLayout(activity);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setPadding(dp(28), dp(24), dp(28), dp(24));
        overlay.setBackgroundColor(surface);
        overlay.setClickable(true);
        spinner = new ProgressBar(activity);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(accent));
        LinearLayout.LayoutParams spinnerSize = new LinearLayout.LayoutParams(dp(36), dp(36));
        spinnerSize.bottomMargin = dp(24);
        overlay.addView(spinner, spinnerSize);
        overlayTitle = label("正在连接账号", 22, text);
        overlayTitle.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        overlayTitle.setGravity(Gravity.CENTER);
        overlay.addView(overlayTitle);
        overlayDetail = label("正在向 YouTube Music 验证登录会话…", 14, muted);
        overlayDetail.setGravity(Gravity.CENTER);
        overlayDetail.setLineSpacing(dp(5), 1);
        LinearLayout.LayoutParams detailSize = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        detailSize.topMargin = dp(12);
        detailSize.bottomMargin = dp(24);
        overlay.addView(overlayDetail, detailSize);
        primary = action(true);
        secondary = action(false);
        overlay.addView(primary, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        LinearLayout.LayoutParams secondarySize = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        secondarySize.topMargin = dp(8);
        overlay.addView(secondary, secondarySize);
        overlay.setVisibility(View.GONE);
        content.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        column.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        message = label("在 Google 页面完成登录后自动返回", 12, muted);
        message.setGravity(Gravity.CENTER);
        message.setPadding(dp(16), dp(10), dp(16), dp(10));
        message.setBackgroundColor(surface);
        column.addView(message);
        dialog.setOnDismissListener(ignored -> {
            web.removeCallbacks(readSession);
            web.stopLoading();
            web.destroy();
            onClosed.run();
        });
        dialog.setContentView(column);
        dialog.show();
        Window window = dialog.getWindow();
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
            int appearance = dark ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            window.getInsetsController().setSystemBarsAppearance(appearance, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (!dark) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            window.getDecorView().setSystemUiVisibility(flags);
        }
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        column.requestApplyInsets();
        stage("opening", "正在打开 Google 登录页…");
        boolean chooseAccount = Boolean.TRUE.equals(args.get("selectAccount"));
        resumingSession = !chooseAccount && hasSessionCookie(cookies.getCookie(MUSIC));
        web.loadUrl(chooseAccount ? CHOOSE_ACCOUNT : resumingSession ? MUSIC : LOGIN);
    }

    private void readSession() {
        if (closed || verifying || reading || !isMusic(web.getUrl())) return;
        reading = true;
        int version = pageVersion;
        String cookie = cookies.getCookie(MUSIC);
        web.evaluateJavascript(SESSION_SCRIPT, encoded -> {
            if (closed || version != pageVersion) return;
            reading = false;
            try {
                Object decoded = new JSONTokener(encoded).nextValue();
                JSONObject context = new JSONObject(decoded instanceof String ? (String) decoded : "{}");
                String visitor = context.optString("visitorData");
                if (hasSessionCookie(cookie) && !visitor.isEmpty()) {
                    String dataSyncId = context.optString("dataSyncId").split("\\|\\|", 2)[0];
                    String authUser = context.optString("authUser", "0");
                    if (!authUser.matches("\\d+")) authUser = "0";
                    String fingerprint = cookie + "\n" + visitor + "\n" + dataSyncId + "\n" + authUser;
                    if (fingerprint.equals(failedSession)) {
                        showError("登录会话需要更新", sessionError, "重新登录 Google", () -> web.loadUrl(CHOOSE_ACCOUNT), "重新验证", this::retrySession);
                        return;
                    }
                    failedSession = fingerprint;
                    verifying = true;
                    attemptId = UUID.randomUUID().toString();
                    cookies.flush();
                    showVerification();
                    stage("verifying", "正在验证 YouTube Music 账号…");
                    bridge.send("auth.session", object("requestId", requestId, "attemptId", attemptId,
                        "credentials", object("cookie", cookie, "visitorData", visitor, "dataSyncId", dataSyncId, "authUser", authUser)));
                    return;
                }
                if (++readCount < 20) {
                    stage("reading", "正在读取 YouTube Music 登录会话…");
                    web.postDelayed(readSession, 500);
                } else {
                    showError("登录会话尚未准备好", "请确认已在 Google 页面完成验证。返回 YouTube Music 后，应用会自动连接账号。", "继续 Google 登录", () -> web.loadUrl(LOGIN), "重新读取会话", this::retrySession);
                }
            } catch (Exception error) {
                showError("未能读取登录会话", "YouTube Music 页面还未返回完整的账号信息，请重新加载后继续。", "重新加载", () -> web.reload(), "返回账号页", this::close);
            }
        });
    }

    boolean complete(Map<String, Object> result) {
        if (closed || !verifying || !attemptId.equals(result.get("attemptId"))) return false;
        verifying = false;
        if (Boolean.TRUE.equals(result.get("ok"))) {
            cookies.flush();
            finish(object("completed", true, "attemptId", attemptId));
        } else {
            sessionError = String.valueOf(result.get("message"));
            Object status = result.get("status");
            int code = status instanceof Number ? ((Number) status).intValue() : 0;
            if (resumingSession && (code == 401 || code == 403)) {
                resumingSession = false;
                showPage();
                web.loadUrl(CHOOSE_ACCOUNT);
            } else {
                showError("账号暂未连接", sessionError, "重新验证", this::retrySession, "重新登录 Google", () -> web.loadUrl(CHOOSE_ACCOUNT));
            }
        }
        return true;
    }

    private void retrySession() {
        failedSession = "";
        readCount = 0;
        showPage();
        readSession();
    }
    private void showPage() {
        overlay.setVisibility(View.GONE);
        progress.setIndeterminate(false);
        progress.setVisibility(View.INVISIBLE);
        stage("waiting", "在 Google 页面完成登录，验证后会自动返回");
    }
    private void showVerification() {
        web.clearFocus();
        activity.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(web.getWindowToken(), 0);
        overlayTitle.setText("正在连接账号");
        overlayDetail.setText("正在向 YouTube Music 验证登录会话，完成后自动返回。");
        spinner.setVisibility(View.VISIBLE);
        primary.setVisibility(View.GONE);
        secondary.setVisibility(View.GONE);
        overlay.setVisibility(View.VISIBLE);
        progress.setIndeterminate(true);
        progress.setVisibility(View.VISIBLE);
    }
    private void showError(String title, String detail, String first, Runnable retry, String second, Runnable other) {
        web.removeCallbacks(readSession);
        spinner.setVisibility(View.GONE);
        overlayTitle.setText(title);
        overlayDetail.setText(detail);
        primary.setText(first);
        primary.setOnClickListener(ignored -> retry.run());
        primary.setVisibility(View.VISIBLE);
        secondary.setText(second);
        secondary.setOnClickListener(ignored -> other.run());
        secondary.setVisibility(View.VISIBLE);
        overlay.setVisibility(View.VISIBLE);
        progress.setIndeterminate(false);
        progress.setVisibility(View.INVISIBLE);
        stage("error", title);
    }
    private void stage(String stage, String detail) {
        message.setText(detail);
        bridge.send("auth.progress", object("requestId", requestId, "stage", stage, "message", detail));
    }
    private void back() {
        if (verifying) close();
        else if (overlay.getVisibility() == View.VISIBLE) showPage();
        else if (web.canGoBack()) web.goBack();
        else close();
    }
    private void finish(Map<String, Object> result) {
        if (closed) return;
        closed = true;
        reply.resolve(result);
        dialog.dismiss();
    }
    @Override public void close() { finish(object("cancelled", true)); }
    private static boolean isMusic(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme()) && "music.youtube.com".equals(uri.getHost());
    }
    private static boolean googleRejected(Uri uri) {
        if (!"accounts.google.com".equals(uri.getHost())) return false;
        String path = uri.getPath();
        return (path != null && (path.contains("/denied") || path.contains("/rejected")))
            || "disallowed_useragent".equals(uri.getQueryParameter("error"));
    }
    private static boolean hasSessionCookie(String value) {
        if (value == null) return false;
        for (String item : value.split(";")) {
            String cookie = item.trim();
            if ((cookie.startsWith("SAPISID=") || cookie.startsWith("__Secure-3PAPISID=") || cookie.startsWith("__Secure-1PAPISID=")) && cookie.indexOf('=') < cookie.length() - 1) return true;
        }
        return false;
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private TextView label(String value, int size, int color) {
        TextView label = new TextView(activity);
        label.setText(value);
        label.setTextSize(size);
        label.setTextColor(color);
        label.setFontFeatureSettings("kern");
        return label;
    }
    private TextView action(boolean filled) {
        TextView action = label("", 14, filled ? accentText : accent);
        action.setGravity(Gravity.CENTER);
        action.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        action.setClickable(true);
        action.setFocusable(true);
        action.setBackground(ripple(filled ? accent : Color.TRANSPARENT, dp(24)));
        return action;
    }
    private RippleDrawable ripple(int background, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(background);
        shape.setCornerRadius(radius);
        GradientDrawable mask = new GradientDrawable();
        mask.setColor(Color.WHITE);
        mask.setCornerRadius(radius);
        return new RippleDrawable(ColorStateList.valueOf(dark ? 0x30ffffff : 0x20000000), shape, mask);
    }
    private final class NavButton extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final boolean cancel;
        NavButton(boolean cancel, String description) {
            super(activity);
            this.cancel = cancel;
            setContentDescription(description);
            setFocusable(true);
            setClickable(true);
            setBackground(ripple(Color.TRANSPARENT, dp(24)));
            paint.setColor(text);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(2));
            paint.setStrokeCap(Paint.Cap.ROUND);
        }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float x = getWidth() / 2f, y = getHeight() / 2f, size = dp(7);
            if (cancel) {
                canvas.drawLine(x - size, y - size, x + size, y + size, paint);
                canvas.drawLine(x - size, y + size, x + size, y - size, paint);
            } else {
                canvas.drawLine(x - size, y, x + size, y, paint);
                canvas.drawLine(x - size, y, x, y - size, paint);
                canvas.drawLine(x - size, y, x, y + size, paint);
            }
        }
        @Override public CharSequence getAccessibilityClassName() { return "android.widget.Button"; }
    }
    private static Map<String, Object> object(Object... pairs) {
        Map<String, Object> value = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) value.put((String) pairs[i], pairs[i + 1]);
        return value;
    }
}
