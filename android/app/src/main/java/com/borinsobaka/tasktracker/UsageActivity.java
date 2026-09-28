package com.borinsobaka.tasktracker;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/**
 * Экран «Лимиты Claude»: подключение аккаунта (вход на сайте Claude → вставить
 * код) и текущие цифры. Открывается тапом по виджету лимитов.
 */
public class UsageActivity extends Activity {

    private TextView state, summary, message;
    private View connectedBox, loginBox;
    private EditText code;
    private Button submit, reload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_usage);
        state = findViewById(R.id.usage_state);
        summary = findViewById(R.id.usage_summary);
        message = findViewById(R.id.usage_message);
        connectedBox = findViewById(R.id.usage_connected);
        loginBox = findViewById(R.id.usage_login);
        code = findViewById(R.id.usage_code);
        submit = findViewById(R.id.usage_submit);
        reload = findViewById(R.id.usage_reload);

        findViewById(R.id.usage_open_login).setOnClickListener(v -> {
            showMessage(null);
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(ClaudeUsage.startLogin(this))));
            } catch (Exception e) {
                showMessage("Не удалось открыть браузер");
            }
        });
        submit.setOnClickListener(v -> connect());
        reload.setOnClickListener(v -> fetch());
        findViewById(R.id.usage_logout).setOnClickListener(v -> {
            ClaudeUsage.logout(this);
            UsageWidgetProvider.redraw(this);
            render();
        });
        render();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Вернулись из браузера с кодом в буфере — подставим его сами
        // (буфер обмена Android отдаёт только окну в фокусе, поэтому не в onResume)
        if (hasFocus && !ClaudeUsage.isConnected(this) && code.getText().length() == 0) {
            String clip = clipboardText();
            if (clip != null && clip.matches("[A-Za-z0-9_\\-]{16,}#[A-Za-z0-9_\\-]{16,}")) code.setText(clip);
        }
    }

    private void connect() {
        String pasted = code.getText().toString();
        submit.setEnabled(false);
        showMessage(null);
        state.setText("Подключаю…");
        new Thread(() -> {
            String error = null;
            try {
                ClaudeUsage.finishLogin(this, pasted);
                ClaudeUsage.fetch(this, true);
            } catch (Exception e) {
                error = e.getMessage() != null ? e.getMessage() : "Не удалось подключить";
            }
            final String err = error;
            runOnUiThread(() -> {
                if (isFinishing()) return;
                submit.setEnabled(true);
                if (err == null) code.setText("");
                render();
                showMessage(err);
                UsageWidgetProvider.redraw(this);
            });
        }, "claude-login").start();
    }

    private void fetch() {
        reload.setEnabled(false);
        new Thread(() -> {
            ClaudeUsage.fetch(this, true);
            runOnUiThread(() -> {
                if (isFinishing()) return;
                reload.setEnabled(true);
                render();
                UsageWidgetProvider.redraw(this);
            });
        }, "claude-usage").start();
    }

    private void render() {
        boolean connected = ClaudeUsage.isConnected(this);
        ClaudeUsage.Snapshot s = ClaudeUsage.cached(this);
        connectedBox.setVisibility(connected ? View.VISIBLE : View.GONE);
        loginBox.setVisibility(connected ? View.GONE : View.VISIBLE);
        if (connected) {
            state.setText(s.error != null ? "Подключено · " + s.error : "Аккаунт подключён");
            long now = System.currentTimeMillis();
            summary.setText(line("Сессия · 5 часов", s.session, now) + "\n\n"
                    + line("Неделя · все модели", s.weekAll, now) + "\n\n"
                    + line("Неделя · " + s.fableName, s.weekFable, now));
        } else {
            state.setText(s.error != null ? "Не подключено · " + s.error : "Аккаунт Claude не подключён");
        }
    }

    private static String line(String title, ClaudeUsage.Window w, long now) {
        if (!w.known()) return title + ": нет данных";
        return title + ": потрачено " + ClaudeUsage.percentText(w) + "\n" + ClaudeUsage.resetText(w, now);
    }

    private void showMessage(String text) {
        message.setText(text == null ? "" : text);
        message.setVisibility(text == null ? View.GONE : View.VISIBLE);
    }

    private String clipboardText() {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            ClipData clip = cm == null ? null : cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return null;
            CharSequence t = clip.getItemAt(0).getText();
            return t == null ? null : t.toString().trim();
        } catch (Exception e) {
            return null;
        }
    }
}
