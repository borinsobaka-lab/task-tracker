package com.borinsobaka.tasktracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Calendar;
import java.util.Locale;

/**
 * Виджет «Лимиты Claude»: 5-часовая сессия, неделя по всем моделям и неделя по
 * Fable — сколько потрачено и через сколько сброс. Данные — /api/oauth/usage
 * (см. ClaudeUsage); тап по виджету открывает экран подключения аккаунта.
 */
public class UsageWidgetProvider extends AppWidgetProvider {

    static final String ACTION_TICK = "com.borinsobaka.tasktracker.USAGE_TICK";     // по таймеру: без крутилки
    static final String ACTION_RELOAD = "com.borinsobaka.tasktracker.USAGE_RELOAD"; // кнопка «Обновить»
    static final String ACTION_REDRAW = "com.borinsobaka.tasktracker.USAGE_REDRAW"; // перерисовать из кэша

    /** Раз в 5 минут пересчитываем «через сколько сброс» и, если пора, берём свежие цифры. */
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
            redrawAll(ctx, false);
        } else {
            super.onReceive(ctx, intent);
        }
    }

    @Override
    public void onDisabled(Context ctx) {
        schedule(ctx, false); // последний виджет удалён — гасим таймер
    }

    /** Попросить все виджеты лимитов перерисоваться (например, после входа/выхода). */
    static void redraw(Context ctx) {
        ctx.sendBroadcast(new Intent(ctx, UsageWidgetProvider.class)
                .setAction(ACTION_REDRAW)
                .setPackage(ctx.getPackageName()));
    }

    /** Рисуем кэш сразу, в фоне догружаем свежие цифры и перерисовываем. */
    private void load(Context ctx, boolean force, boolean spinner) {
        Context app = ctx.getApplicationContext();
        int[] ids = widgetIds(app);
        schedule(app, ids.length > 0);
        if (ids.length == 0) return;
        redrawAll(app, spinner && ClaudeUsage.isConnected(app));
        if (!ClaudeUsage.isConnected(app)) return;

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                ClaudeUsage.fetch(app, force);
            } finally {
                redrawAll(app, false);
                pending.finish();
            }
        }, "claude-usage").start();
    }

    private static int[] widgetIds(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, UsageWidgetProvider.class));
    }

    private static void redrawAll(Context ctx, boolean refreshing) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        RemoteViews rv = build(ctx, refreshing);
        for (int id : widgetIds(ctx)) mgr.updateAppWidget(id, rv);
    }

    static RemoteViews build(Context ctx, boolean refreshing) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_usage);
        ClaudeUsage.Snapshot s = ClaudeUsage.cached(ctx);
        long now = System.currentTimeMillis();
        boolean hasData = s.session.known() || s.weekAll.known() || s.weekFable.known();

        // Не подключены и показать нечего — вместо карточек подсказка «нажмите, чтобы подключить»
        boolean showRows = s.connected || hasData;
        rv.setViewVisibility(R.id.usage_rows, showRows ? View.VISIBLE : View.GONE);
        rv.setViewVisibility(R.id.usage_connect, showRows ? View.GONE : View.VISIBLE);

        applyRow(rv, s.session, now, R.id.usage_session_percent, R.id.usage_session_bar, R.id.usage_session_reset);
        applyRow(rv, s.weekAll, now, R.id.usage_week_percent, R.id.usage_week_bar, R.id.usage_week_reset);
        applyRow(rv, s.weekFable, now, R.id.usage_fable_percent, R.id.usage_fable_bar, R.id.usage_fable_reset);
        rv.setTextViewText(R.id.usage_fable_title, "Неделя · " + s.fableName);

        // Шапка: ошибка (красным) или время последнего обновления
        String status;
        int statusColor = 0xFF6B7280;
        if (!s.connected && hasData) {
            status = "войдите снова";
            statusColor = 0xFFDC2626;
        } else if (s.error != null && s.connected) {
            status = s.error;
            statusColor = 0xFFDC2626;
        } else if (s.fetchedAt > 0) {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(s.fetchedAt);
            status = String.format(Locale.ROOT, "обновлено %d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
        } else {
            status = "";
        }
        rv.setTextViewText(R.id.usage_status, status);
        rv.setTextColor(R.id.usage_status, statusColor);

        rv.setViewVisibility(R.id.usage_refresh, refreshing ? View.GONE : View.VISIBLE);
        rv.setViewVisibility(R.id.usage_refreshing, refreshing ? View.VISIBLE : View.GONE);

        // «Обновить» — свежие цифры; тап по остальному виджету — экран аккаунта Claude
        PendingIntent reload = PendingIntent.getBroadcast(ctx, 20,
                new Intent(ctx, UsageWidgetProvider.class).setAction(ACTION_RELOAD),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.usage_refresh, reload);
        PendingIntent open = PendingIntent.getActivity(ctx, 21,
                new Intent(ctx, UsageActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.usage_root, open);
        return rv;
    }

    private static void applyRow(RemoteViews rv, ClaudeUsage.Window w, long now, int percentId, int barId, int resetId) {
        int color = ClaudeUsage.levelColor(w);
        rv.setTextViewText(percentId, ClaudeUsage.percentText(w));
        rv.setTextColor(percentId, color);
        rv.setProgressBar(barId, 100, w.known() ? (int) Math.round(Math.min(100, w.percent)) : 0, false);
        if (Build.VERSION.SDK_INT >= 31) {
            rv.setColorStateList(barId, "setProgressTintList", ColorStateList.valueOf(color));
        }
        rv.setTextViewText(resetId, ClaudeUsage.resetText(w, now));
    }

    /** Неточный таймер раз в 5 минут, пока на экране есть хотя бы один виджет лимитов. */
    private static void schedule(Context ctx, boolean on) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 22,
                new Intent(ctx, UsageWidgetProvider.class).setAction(ACTION_TICK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (on) {
            am.setInexactRepeating(AlarmManager.RTC, System.currentTimeMillis() + TICK_MS, TICK_MS, pi);
        } else {
            am.cancel(pi);
        }
    }
}
