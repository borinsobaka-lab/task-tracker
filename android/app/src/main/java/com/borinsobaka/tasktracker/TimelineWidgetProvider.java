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

/** Виджет-таймлайн на рабочем столе: список задач из публичного timeline.json. */
public class TimelineWidgetProvider extends AppWidgetProvider {

    static final String ACTION_REFRESH = "com.borinsobaka.tasktracker.ACTION_REFRESH"; // тихо перечитать список
    static final String ACTION_RELOAD = "com.borinsobaka.tasktracker.ACTION_RELOAD";   // кнопка «Обновить»: с крутилкой
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
            // Тихое обновление (поминутный тик, уход из приложения) — без крутилки.
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        } else if (ACTION_RELOAD.equals(action)) {
            // Нажата кнопка «Обновить»: форсим свежую загрузку и показываем крутилку
            // вместо кнопки, чтобы было видно, что нажатие сработало (снимем в ACTION_BAR).
            TimelineRemoteViewsFactory.invalidate();
            for (int id : ids) {
                RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_timeline);
                rv.setViewVisibility(R.id.widget_refresh, View.GONE);
                rv.setViewVisibility(R.id.widget_refreshing, View.VISIBLE);
                mgr.partiallyUpdateAppWidget(id, rv);
            }
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        } else if (ACTION_BAR.equals(action)) {
            // Фабрика посчитала задачи на сегодня — обновляем число в шапке и
            // возвращаем кнопку «Обновить» вместо крутилки.
            int count = todayCount(ctx);
            for (int id : ids) {
                RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_timeline);
                rv.setTextViewText(R.id.widget_today, todayLabel());
                rv.setTextViewText(R.id.widget_today_count, count > 0 ? String.valueOf(count) : "");
                rv.setViewVisibility(R.id.widget_today_count, count > 0 ? View.VISIBLE : View.GONE);
                rv.setViewVisibility(R.id.widget_refreshing, View.GONE);
                rv.setViewVisibility(R.id.widget_refresh, View.VISIBLE);
                mgr.partiallyUpdateAppWidget(id, rv);
            }
            // Тикаем раз в минуту, пока идёт задача (двигаем красную линию по ней) или
            // впереди сегодня ещё есть задачи (чтобы полоса «сейчас» между задачами
            // вовремя переходила в нужный промежуток). Когда сегодня всё позади —
            // отключаем частые обновления (экономим батарею).
            var prefs = ctx.getSharedPreferences("widget", Context.MODE_PRIVATE);
            boolean hasCurrent = prefs.getBoolean("has_current", false);
            boolean hasUpcoming = prefs.getBoolean("has_upcoming", false);
            scheduleTick(ctx, (hasCurrent || hasUpcoming) && ids.length > 0);
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
        rv.setViewVisibility(R.id.widget_today_count, count > 0 ? View.VISIBLE : View.GONE);
        rv.setViewVisibility(R.id.widget_refreshing, View.GONE);
        rv.setViewVisibility(R.id.widget_refresh, View.VISIBLE);

        // Список задач заполняет TimelineWidgetService/Factory
        Intent svc = new Intent(ctx, TimelineWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        // Токен сборки: при обновлении APK меняется data-URI адаптера, и хост
        // пересоздаёт список с НОВОЙ раскладкой (иначе кэширует старую — из-за
        // этого карточки/полоса выглядели по-старому после обновления).
        long token = 0L;
        try {
            token = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).lastUpdateTime;
        } catch (Exception ignored) {
        }
        svc.putExtra("build_token", token);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.widget_list, svc);
        rv.setEmptyView(R.id.widget_list, R.id.widget_empty);

        // Тап по задаче -> открыть её в приложении (#card=<id>)
        Intent click = new Intent(ctx, MainActivity.class);
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent clickPI = PendingIntent.getActivity(
                ctx, 0, click, PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        rv.setPendingIntentTemplate(R.id.widget_list, clickPI);

        // Кнопка «Обновить» — с крутилкой (ACTION_RELOAD, отдельно от тихого тика)
        Intent refresh = new Intent(ctx, TimelineWidgetProvider.class).setAction(ACTION_RELOAD);
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
