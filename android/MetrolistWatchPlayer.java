package com.longbridge.nsh;

import android.app.Activity;
import android.app.Dialog;
import android.net.Uri;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;

/** A visible YouTube Music watch page using the same WebView session as account login. */
final class MetrolistWatchPlayer {
    private final Dialog dialog;

    MetrolistWatchPlayer(Activity activity, String videoId, String accountIndex, Runnable onClose) {
        dialog = new Dialog(activity, android.R.style.Theme_Material_NoActionBar);
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setFitsSystemWindows(true);
        Button back = new Button(activity);
        back.setText("返回 Metrolist");
        back.setOnClickListener(view -> dialog.dismiss());
        column.addView(back);
        WebView web = new WebView(activity);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        column.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        dialog.setContentView(column);
        dialog.setOnDismissListener(ignored -> {
            web.onPause();
            web.stopLoading();
            column.removeView(web);
            web.destroy();
            onClose.run();
        });
        dialog.show();
        Uri.Builder page = Uri.parse("https://music.youtube.com/watch").buildUpon().appendQueryParameter("v", videoId);
        if (!accountIndex.isEmpty()) page.appendQueryParameter("authuser", accountIndex);
        web.loadUrl(page.build().toString());
    }

    void close() { dialog.dismiss(); }
}
