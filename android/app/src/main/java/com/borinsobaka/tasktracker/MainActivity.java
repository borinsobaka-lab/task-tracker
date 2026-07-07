package com.borinsobaka.tasktracker;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Оболочка-WebView вокруг веб-сервиса. Открывает приложение и (по тапу в виджете) конкретную задачу. */
public class MainActivity extends Activity {

    static final String APP_URL = "https://borinsobaka-lab.github.io/task-tracker/";
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setSupportMultipleWindows(false);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String host = u.getHost();
                if (host != null && host.contains("borinsobaka-lab.github.io")) {
                    return false; // остаёмся внутри WebView
                }
                // Внешние ссылки (например, ссылка на встречу) — в системный браузер
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        });

        web.loadUrl(targetUrl(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (web != null) web.loadUrl(targetUrl(intent));
    }

    private String targetUrl(Intent intent) {
        if (intent != null && intent.getData() != null) {
            return intent.getData().toString();
        }
        return APP_URL;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
