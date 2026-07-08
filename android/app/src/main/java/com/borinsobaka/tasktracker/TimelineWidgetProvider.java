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
import android.widget.RemoteViews;

import java.util.Calendar;

/** Виджет-таймлайн на рабочем столе: список задач из публичного timeline.json. */
public class TimelineWidgetProvider extends AppWidgetProvider {

    static final String ACTION_REFRESH = "com.borinsobaka.tasktracker.ACTION_REFRESH";
    static final String ACTION_BAR = "com.borinsobaka.tasktracker.ACTION_BAR"; // обновить число задач в шапке

    private static final String[] MON = {"янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"};

    private static String todayLabel() {
        Calendar c = Calendar.getInstance();
        return "Сегодня · " + c.get(Calendar.DAY_OF_MONTH) + " " + MON[c.get(Calendar.MONTH)];
    }

    private static int todayCount(Context ctx) {
        return ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).getInt("today_count", 0);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(ctx, mgr, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String action = intent.getAction();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TimelineWidgetProvider.class));

        if (ACTION_REFRESH.equals(action)) {
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        } else if (ACTION_BAR.equals(action)) {
            // Фабрика посчитала задачи на сегодня — обновляем только число в шапке
            int count = todayCount(ctx);
            for (int id : ids) {
                RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_timeline);
                rv.setTextViewText(R.id.widget_today, todayLabel());
                rv.setTextViewText(R.id.widget_today_count, count > 0 ? String.valueOf(count) : "");
                mgr.partiallyUpdateAppWidget(id, rv);
            }
            // Пока идёт какая-то задача — тикаем раз в минуту (двигаем красную линию),
            // иначе отключаем частые обновления (экономим батарею).
            boolean hasCurrent = ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).getBoolean("has_current", false);
            scheduleTick(ctx, hasCurrent && ids.length > 0);
        }
    }

    @Override
    public void onDisabled(Context ctx) {
        scheduleTick(ctx, false); // последний виджет удалён — гасим тик
    }

    /** Планирует (или отменяет) поминутное обновление для движения красной линии. */
    private static void scheduleTick(Context ctx, boolean on) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(
                ctx, 7, new Intent(ctx, TimelineWidgetProvider.class).setAction(ACTION_REFRESH), flags);
        if (on) {
            am.set(AlarmManager.RTC, System.currentTimeMillis() + 60000, pi); // неточный — без спец-разрешений и экономно
        } else {
            am.cancel(pi);
        }
    }

    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_timeline);

        // Шапка: сегодняшняя дата + количество задач
        rv.setTextViewText(R.id.widget_today, todayLabel());
        int count = todayCount(ctx);
        rv.setTextViewText(R.id.widget_today_count, count > 0 ? String.valueOf(count) : "");

        // Список задач заполняет TimelineWidgetService/Factory
        Intent svc = new Intent(ctx, TimelineWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.widget_list, svc);
        rv.setEmptyView(R.id.widget_list, R.id.widget_empty);

        // Тап по задаче -> открыть её в приложении (#card=<id>)
        Intent click = new Intent(ctx, MainActivity.class);
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent clickPI = PendingIntent.getActivity(
                ctx, 0, click, PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        rv.setPendingIntentTemplate(R.id.widget_list, clickPI);

        // Кнопка «Обновить»
        Intent refresh = new Intent(ctx, TimelineWidgetProvider.class).setAction(ACTION_REFRESH);
        PendingIntent refreshPI = PendingIntent.getBroadcast(
                ctx, 0, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widget_refresh, refreshPI);

        // Кнопка «+» — быстрое добавление задачи
        Intent add = new Intent(ctx, MainActivity.class)
                .setData(Uri.parse(MainActivity.APP_URL + "#new"))
                .setAction(Intent.ACTION_VIEW);
        PendingIntent addPI = PendingIntent.getActivity(
                ctx, 1, add, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widget_add, addPI);

        mgr.updateAppWidget(widgetId, rv);
        mgr.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list);
    }
}
