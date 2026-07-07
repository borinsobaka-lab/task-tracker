package com.borinsobaka.tasktracker;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.text.SpannableString;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Наполняет список виджета данными из публичного timeline.json:
 * заголовки дней + карточки задач (как в виджете Google Календаря).
 */
public class TimelineRemoteViewsFactory implements RemoteViewsService.RemoteViewsFactory {

    static final String TIMELINE_URL =
            "https://raw.githubusercontent.com/borinsobaka-lab/task-tracker/app-config/timeline.json";
    static final String APP_URL = "https://borinsobaka-lab.github.io/task-tracker/";
    static final int MEETING_COLOR = 0xFF1F2937;
    static final int ACCENT = 0xFF5B5BD6;

    private final Context ctx;
    private final List<Row> rows = new ArrayList<>();

    TimelineRemoteViewsFactory(Context c) {
        this.ctx = c;
    }

    private static class Item {
        String id, title, date, start, kind, priorityColor;
        int durationMin = 60;
        boolean done;
        int color = ACCENT;
        long endMs;
    }

    private static class Row {
        boolean header;
        String headerText;
        Item item;
    }

    @Override public void onCreate() {}
    @Override public void onDestroy() { rows.clear(); }
    @Override public int getCount() { return rows.size(); }
    @Override public long getItemId(int position) { return position; }
    @Override public boolean hasStableIds() { return false; }
    @Override public int getViewTypeCount() { return 2; }
    @Override public RemoteViews getLoadingView() { return null; }

    @Override
    public void onDataSetChanged() {
        rows.clear();
        List<Item> items = fetch();
        long now = System.currentTimeMillis();
        String today = dayKey(now);

        List<Item> keep = new ArrayList<>();
        for (Item it : items) {
            boolean isMeeting = "meeting".equals(it.kind);
            if (isMeeting) {
                if (it.endMs >= now) keep.add(it); // предстоящие/идущие встречи
            } else {
                if (cmp(it.date, today) >= 0) keep.add(it); // сегодня и позже, включая выполненные (зачёркнутые)
            }
        }
        Collections.sort(keep, new Comparator<Item>() {
            @Override public int compare(Item a, Item b) {
                int c = cmp(a.date, b.date);
                if (c != 0) return c;
                return safe(a.start).compareTo(safe(b.start));
            }
        });

        String lastDay = null;
        for (Item it : keep) {
            if (!it.date.equals(lastDay)) {
                lastDay = it.date;
                Row h = new Row();
                h.header = true;
                h.headerText = dayLabel(it.date, today);
                rows.add(h);
            }
            Row r = new Row();
            r.item = it;
            rows.add(r);
        }
    }

    @Override
    public RemoteViews getViewAt(int position) {
        if (position < 0 || position >= rows.size()) return null;
        Row row = rows.get(position);
        if (row.header) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_item_header);
            rv.setTextViewText(R.id.header_text, row.headerText);
            return rv;
        }
        Item it = row.item;
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_item_task);
        // Тонируем белую скруглённую полосу в цвет задачи
        rv.setInt(R.id.item_bar, "setColorFilter", it.color);

        if (it.done) {
            // Выполненные — зачёркнуты и приглушены
            SpannableString s = new SpannableString(it.title);
            s.setSpan(new StrikethroughSpan(), 0, s.length(), 0);
            rv.setTextViewText(R.id.item_title, s);
            rv.setTextColor(R.id.item_title, 0xFF9AA0AE);
            rv.setTextColor(R.id.item_time, 0xFFB3B8C4);
            rv.setInt(R.id.item_bar, "setImageAlpha", 110);
        } else {
            rv.setTextViewText(R.id.item_title, it.title);
            rv.setTextColor(R.id.item_title, 0xFF111827);
            rv.setTextColor(R.id.item_time, 0xFF6B7280);
            rv.setInt(R.id.item_bar, "setImageAlpha", 255);
        }

        if (it.start != null && !it.start.isEmpty()) {
            rv.setViewVisibility(R.id.item_time, View.VISIBLE);
            rv.setTextViewText(R.id.item_time, it.start + "–" + addMinutes(it.start, it.durationMin));
        } else {
            rv.setViewVisibility(R.id.item_time, View.GONE);
        }

        Intent fill = new Intent();
        fill.setData(Uri.parse(APP_URL + "#card=" + Uri.encode(it.id)));
        rv.setOnClickFillInIntent(R.id.item_root, fill);
        return rv;
    }

    // ---------- Сеть + разбор ----------

    private List<Item> fetch() {
        List<Item> out = new ArrayList<>();
        HttpURLConnection conn = null;
        try {
            URL url = new URL(TIMELINE_URL + "?t=" + System.currentTimeMillis());
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Cache-Control", "no-cache");
            if (conn.getResponseCode() != 200) return out;

            StringBuilder sb = new StringBuilder();
            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();

            JSONObject root = new JSONObject(sb.toString());
            JSONArray arr = root.optJSONArray("items");
            if (arr == null) return out;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Item it = new Item();
                it.id = o.optString("id");
                it.title = o.optString("title", "Без названия");
                it.date = o.optString("date");
                it.start = o.isNull("start") ? null : o.optString("start", null);
                it.durationMin = o.optInt("durationMin", 60);
                it.kind = o.isNull("kind") ? null : o.optString("kind", null);
                it.done = o.optBoolean("done", false);
                it.priorityColor = o.isNull("priorityColor") ? null : o.optString("priorityColor", null);
                JSONArray mem = o.optJSONArray("members");
                if ("meeting".equals(it.kind)) {
                    it.color = MEETING_COLOR;
                } else if (mem != null && mem.length() > 0) {
                    it.color = parseColor(mem.getJSONObject(0).optString("color", "#5B5BD6"));
                }
                it.endMs = (it.start != null && !it.start.isEmpty())
                        ? computeMs(it.date, it.start, it.durationMin)
                        : endOfDay(it.date);
                out.add(it);
            }
        } catch (Exception e) {
            // сеть недоступна — покажем пусто
        } finally {
            if (conn != null) conn.disconnect();
        }
        return out;
    }

    // ---------- Дата/время (локальная зона телефона) ----------

    private static int cmp(String a, String b) {
        return safe(a).compareTo(safe(b));
    }
    private static String safe(String s) { return s == null ? "" : s; }

    private static long computeMs(String dateKey, String start, int addMin) {
        try {
            String[] d = dateKey.split("-");
            int hh = 0, mm = 0;
            if (start != null && !start.isEmpty()) {
                String[] t = start.split(":");
                hh = Integer.parseInt(t[0]);
                mm = Integer.parseInt(t[1]);
            }
            Calendar c = Calendar.getInstance();
            c.set(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]), hh, mm, 0);
            c.set(Calendar.MILLISECOND, 0);
            return c.getTimeInMillis() + addMin * 60000L;
        } catch (Exception e) {
            return 0;
        }
    }

    private static long endOfDay(String dateKey) {
        try {
            String[] d = dateKey.split("-");
            Calendar c = Calendar.getInstance();
            c.set(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]), 23, 59, 59);
            return c.getTimeInMillis();
        } catch (Exception e) {
            return 0;
        }
    }

    private static String dayKey(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return String.format(Locale.US, "%04d-%02d-%02d",
                c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    private static final String[] WD = {"вс", "пн", "вт", "ср", "чт", "пт", "сб"};
    private static final String[] MON = {"янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"};

    private String dayLabel(String dateKey, String todayKey) {
        try {
            String[] d = dateKey.split("-");
            Calendar c = Calendar.getInstance();
            c.set(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]), 0, 0, 0);
            String tomorrow = dayKey(System.currentTimeMillis() + 86400000L);
            String name;
            if (dateKey.equals(todayKey)) name = "Сегодня"; // Сегодня
            else if (dateKey.equals(tomorrow)) name = "Завтра"; // Завтра
            else name = WD[c.get(Calendar.DAY_OF_WEEK) - 1];
            String date = Integer.parseInt(d[2]) + " " + MON[Integer.parseInt(d[1]) - 1];
            return name + " · " + date;
        } catch (Exception e) {
            return dateKey;
        }
    }

    private static String addMinutes(String start, int add) {
        try {
            String[] t = start.split(":");
            int m = Integer.parseInt(t[0]) * 60 + Integer.parseInt(t[1]) + add;
            m = ((m % 1440) + 1440) % 1440;
            return String.format(Locale.US, "%02d:%02d", m / 60, m % 60);
        } catch (Exception e) {
            return "";
        }
    }

    private static int parseColor(String hex) {
        try {
            return Color.parseColor(hex);
        } catch (Exception e) {
            return ACCENT;
        }
    }
}
