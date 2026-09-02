package com.borinsobaka.tasktracker;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
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

        // Мост для веб-приложения: оно сообщает, кто выбран в «Кто вы?», а виджет
        // на рабочем столе показывает задачи только этого участника.
        web.addJavascriptInterface(new AppBridge(), "TaskTrackerAndroid");

        // Без WebChromeClient системные диалоги confirm()/alert() в WebView не
        // показываются, из-за чего удаление задач (через confirm) молча не работало.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.confirm())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
                result.cancel();
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (isAppHost(u.getHost())) {
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

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                readIdentityFromStorage(view, url);
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

    // ---------- Кто выбран в приложении (для фильтра задач в виджете) ----------

    /** Веб-приложение зовёт этот мост при выборе участника (и при запуске). */
    private class AppBridge {
        @JavascriptInterface
        public void setIdentity(final String id, final String name) {
            // Вызов приходит из потока WebView; работаем с ним на главном.
            runOnUiThread(() -> {
                if (web == null || !isAppHost(hostOf(web.getUrl()))) return; // не наша страница — игнорируем
                applyIdentity(id, name);
            });
        }
    }

    /**
     * Подстраховка на случай старой версии веб-приложения (мост ещё не вызывается):
     * берём выбранного участника прямо из localStorage — там лежит только его id.
     */
    private void readIdentityFromStorage(WebView view, String url) {
        if (view == null || !isAppHost(hostOf(url))) return;
        try {
            view.evaluateJavascript(
                    "(function(){try{return localStorage.getItem('tt.identity')}catch(e){return null}})()",
                    value -> {
                        String id = unquote(value);
                        if (id != null) applyIdentity(id, null);
                    });
        } catch (Exception ignored) {
            // WebView без JS-движка/уничтожен — фильтр просто останется прежним
        }
    }

    /** Сохраняет выбранного участника и просит виджет перечитать список. */
    private void applyIdentity(String id, String name) {
        String newId = trimToNull(id);
        String newName = trimToNull(name);
        if (newId == null) {
            newName = null; // участник не выбран — имя тоже ни к чему
        } else if (newName == null) {
            // Имя не передали (fallback из localStorage) — оставляем известное, если участник тот же
            newName = newId.equals(WidgetPrefs.identityId(this)) ? WidgetPrefs.identityName(this) : null;
        }
        if (!WidgetPrefs.setIdentity(this, newId, newName)) return; // ничего не изменилось
        sendBroadcast(new Intent(this, TimelineWidgetProvider.class)
                .setAction(TimelineWidgetProvider.ACTION_REFRESH)
                .setPackage(getPackageName()));
    }

    /** Это страница нашего приложения (а не внешний сайт в том же WebView)? */
    static boolean isAppHost(String host) {
        String appHost = Uri.parse(APP_URL).getHost();
        return host != null && appHost != null && (host.equals(appHost) || host.endsWith("." + appHost));
    }

    private static String hostOf(String url) {
        if (url == null) return null;
        try {
            return Uri.parse(url).getHost();
        } catch (Exception e) {
            return null;
        }
    }

    /** evaluateJavascript отдаёт значение в JSON: null или строку в кавычках. */
    private static String unquote(String jsonValue) {
        if (jsonValue == null) return null;
        String s = jsonValue.trim();
        if (s.isEmpty() || "null".equals(s) || "undefined".equals(s)) return null;
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length() - 1).replace("\\\"", "\"").replace("\\\\", "\\");
        }
        return trimToNull(s);
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Уходим из приложения — сбрасываем кэш и просим виджет перечитать список
        // (подхватит свежие статусы), но без крутилки (тихое ACTION_REFRESH).
        TimelineRemoteViewsFactory.invalidate();
        sendBroadcast(new Intent(this, TimelineWidgetProvider.class)
                .setAction(TimelineWidgetProvider.ACTION_REFRESH)
                .setPackage(getPackageName()));
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
