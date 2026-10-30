package com.borinsobaka.tasktracker;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

/** Строки списка виджета «Задачи Claude» — из кэша ClaudeSessions, без сети. */
public class ClaudeTasksWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    private static final class Factory implements RemoteViewsFactory {
        private final Context ctx;
        private final List<ClaudeSessions.Item> items = new ArrayList<>();
        private long now;

        Factory(Context ctx) {
            this.ctx = ctx;
        }

        @Override public void onCreate() {}
        @Override public void onDestroy() { items.clear(); }
        @Override public int getCount() { return items.size(); }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public RemoteViews getLoadingView() { return null; }

        @Override
        public void onDataSetChanged() {
            items.clear();
            items.addAll(ClaudeSessions.cached(ctx).items);
            now = System.currentTimeMillis();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= items.size()) return null;
            ClaudeSessions.Item it = items.get(position);
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_item_claude_task);
            int color = ClaudeSessions.color(it.state);
            rv.setInt(R.id.ct_dot, "setColorFilter", color);
            rv.setTextViewText(R.id.ct_title, it.title);
            rv.setTextViewText(R.id.ct_state, ClaudeSessions.stateText(it.state));
            rv.setTextColor(R.id.ct_state, color);
            rv.setTextViewText(R.id.ct_time, ClaudeSessions.ago(it.updatedAt, now));
            rv.setTextViewText(R.id.ct_summary, it.summary);
            rv.setViewVisibility(R.id.ct_summary, it.summary.isEmpty() ? View.GONE : View.VISIBLE);

            Intent fill = new Intent()
                    .putExtra(ClaudeOpenActivity.EXTRA_ID, it.id)
                    .putExtra(ClaudeOpenActivity.EXTRA_UPDATED, it.updatedRaw);
            rv.setOnClickFillInIntent(R.id.ct_root, fill);
            return rv;
        }
    }
}
