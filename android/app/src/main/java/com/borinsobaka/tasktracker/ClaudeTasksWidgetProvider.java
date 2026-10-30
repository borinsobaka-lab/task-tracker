package com.borinsobaka.tasktracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Calendar;
import java.util.Locale;

/**
 * Виджет «Задачи Claude»: задачи Claude Code, которые ещё не смотрели, — в работе
 * (синяя точка) и готовые (зелёная). Тап по задаче открывает её в Claude Code,
 * «Обновить» — свежий список. Данные — ClaudeSessions, вход — общий с виджетом
 * лимитов (экран UsageActivity).
 */
public class ClaudeTasksWidgetProvider extends AppWidgetProvider {

    static final String ACTION_TICK = "com.borinsobaka.tasktracker.TASKS_TICK";     // по таймеру: без крутилки
    static final String ACTION_RELOAD = "com.borinsobaka.tasktracker.TASKS_RELOAD"; // кнопка «Обновить»
    static final String ACTION_REDRAW = "com.borinsobaka.tasktracker.TASKS_REDRAW"; // перерисовать из кэша

    /** Раз в 5 минут подтягиваем статусы, пока виджет на экране. */
    private static final long TICK_MS = 5 * 60 * 1000L;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        load(ctx, false, false);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (ACTION_TICK.equals(action)) {
            load(ctx, false, false);
        } else if (ACTION_RELOAD.equals(action)) {
            load(ctx, true, true);
        } else if (ACTION_REDRAW.equals(action)) {
            redrawAll(ctx.getApplicationContext(), false);
        } else {
            super.onReceive(ctx, intent);
        }
    }

    @Override
    public void onDisabled(Context ctx) {
        schedule(ctx, false); // последний виджет удалён — гасим таймер
    }

    /** Попросить виджеты задач перерисоваться из кэша (вход/выход, открыли задачу). */
    static void redraw(Context ctx) {
        ctx.sendBroadcast(new Intent(ctx, ClaudeTasksWidgetProvider.class)
                .setAction(ACTION_REDRAW)
                .setPackage(ctx.getPackageName()));
    }

    /** Рисуем кэш сразу, в фоне догружаем свежий список и перерисовываем. */
    private void load(Context ctx, boolean force, boolean spinner) {
        Context app = ctx.getApplicationContext();
        int[] ids = widgetIds(app);
        schedule(app, ids.length > 0);
        if (ids.length == 0) return;
        boolean canRead = ClaudeUsage.canReadSessions(app);
        redrawAll(app, spinner && canRead);
        if (!canRead) return;

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                ClaudeSessions.fetch(app, force);
            } finally {
                redrawAll(app, false);
                pending.finish();
            }
        }, "claude-sessions").start();
    }

    private static int[] widgetIds(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, ClaudeTasksWidgetProvider.class));
    }

    private static void redrawAll(Context ctx, boolean refreshing) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = widgetIds(ctx);
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id, refreshing));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.tasks_list);
    }

    private static RemoteViews build(Context ctx, int widgetId, boolean refreshing) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_claude_tasks);
        ClaudeSessions.Snapshot s = ClaudeSessions.cached(ctx);

        // Шапка: сколько в работе и сколько готово, ошибка (красным) или время обновления
        int working = 0, ready = 0;
        for (ClaudeSessions.Item it : s.items) {
            if (it.state == ClaudeSessions.WORKING) working++; else ready++;
        }
        rv.setTextViewText(R.id.tasks_working, String.valueOf(working));
        rv.setViewVisibility(R.id.tasks_working_box, working > 0 ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.tasks_ready, String.valueOf(ready));
        rv.setViewVisibility(R.id.tasks_ready_box, ready > 0 ? View.VISIBLE : View.GONE);

        String status;
        int statusColor = 0xFF6B7280;
        if (s.connected && !s.canRead) {
            status = "";
        } else if (!s.connected) {
            status = s.fetchedAt > 0 ? "войдите снова" : "";
            statusColor = 0xFFDC2626;
        } else if (s.error != null) {
            status = s.error;
            statusColor = 0xFFDC2626;
        } else if (s.fetchedAt > 0) {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(s.fetchedAt);
            status = String.format(Locale.ROOT, "%d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
        } else {
            status = "";
        }
        rv.setTextViewText(R.id.tasks_status, status);
        rv.setTextColor(R.id.tasks_status, statusColor);

        rv.setViewVisibility(R.id.tasks_refresh, refreshing ? View.GONE : View.VISIBLE);
        rv.setViewVisibility(R.id.tasks_refreshing, refreshing ? View.VISIBLE : View.GONE);

        // Пусто: подсказка войти (нет входа / вход без доступа к задачам) или «всё просмотрено»
        String empty = !s.canRead
                ? (s.connected ? ctx.getString(R.string.tasks_relogin_hint) : ctx.getString(R.string.tasks_connect_hint))
                : s.fetchedAt == 0 ? ctx.getString(R.string.tasks_loading) : ctx.getString(R.string.tasks_empty);
        rv.setTextViewText(R.id.tasks_empty, empty);
        rv.setTextColor(R.id.tasks_empty, s.canRead ? 0xFF9095A8 : 0xFF357A17);

        // Список (тот же токен сборки, что у таймлайна: после обновления APK — новая раскладка)
        Intent svc = new Intent(ctx, ClaudeTasksWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        long token = 0L;
        try {
            token = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).lastUpdateTime;
        } catch (Exception ignored) {
        }
        svc.putExtra("build_token", token);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.tasks_list, svc);
        rv.setEmptyView(R.id.tasks_list, R.id.tasks_empty);

        // Тап по задаче → ClaudeOpenActivity (запомнить «смотрел» и открыть в Claude Code)
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(ctx, 30,
                new Intent(ctx, ClaudeOpenActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        rv.setPendingIntentTemplate(R.id.tasks_list, open);

        PendingIntent reload = PendingIntent.getBroadcast(ctx, 31,
                new Intent(ctx, ClaudeTasksWidgetProvider.class).setAction(ACTION_RELOAD),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.tasks_refresh, reload);

        // Шапка и подсказка «войдите» — экран аккаунта Claude
        PendingIntent account = PendingIntent.getActivity(ctx, 32,
                new Intent(ctx, UsageActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.tasks_title, account);
        rv.setOnClickPendingIntent(R.id.tasks_empty, account);
        return rv;
    }

    /** Неточный таймер раз в 5 минут, пока на экране есть хотя бы один виджет задач. */
    private static void schedule(Context ctx, boolean on) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 33,
                new Intent(ctx, ClaudeTasksWidgetProvider.class).setAction(ACTION_TICK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (on) {
            am.setInexactRepeating(AlarmManager.RTC, System.currentTimeMillis() + TICK_MS, TICK_MS, pi);
        } else {
            am.cancel(pi);
        }
    }
}
