package com.borinsobaka.tasktracker;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Невидимый «трамплин» для тапа по задаче в виджете «Задачи Claude»: запоминает,
 * что задачу открыли (виджет её прячет), и открывает claude.ai/code/<id> —
 * в приложении Claude, если оно установлено, иначе в браузере.
 */
public class ClaudeOpenActivity extends Activity {

    static final String EXTRA_ID = "session_id";
    static final String EXTRA_UPDATED = "updated_at";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String id = getIntent().getStringExtra(EXTRA_ID);
        if (id != null && id.matches("[A-Za-z0-9_-]+")) {
            ClaudeSessions.markSeen(this, id, getIntent().getStringExtra(EXTRA_UPDATED));
            ClaudeTasksWidgetProvider.redraw(this);
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(ClaudeSessions.OPEN_URL + id))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception e) {
                Toast.makeText(this, "Не удалось открыть Claude", Toast.LENGTH_SHORT).show();
            }
        }
        finish();
    }
}
