package com.borinsobaka.tasktracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

/** Виджет-таймлайн на рабочем столе: список задач из публичного timeline.json. */
public class TimelineWidgetProvider extends AppWidgetProvider {

    static final String ACTION_REFRESH = "com.borinsobaka.tasktracker.ACTION_REFRESH";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(ctx, mgr, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TimelineWidgetProvider.class));
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        }
    }

    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_timeline);

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

        // Кнопка «обновить»
        Intent refresh = new Intent(ctx, TimelineWidgetProvider.class).setAction(ACTION_REFRESH);
        PendingIntent refreshPI = PendingIntent.getBroadcast(
                ctx, 0, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.widget_refresh, refreshPI);

        mgr.updateAppWidget(widgetId, rv);
        mgr.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list);
    }
}
