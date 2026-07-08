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
import java.util.HashMap;
import java.util.List;
import java.util.Locale;

/**
 * Наполняет список виджета данными из публичного timeline.json.
 * Сверху закреплены просроченные невыполненные задачи (красным), затем задачи
 * сегодня и далее с заголовками дней и счётчиком. У идущей сейчас задачи —
 * красная горизонтальная линия, показывающая, сколько её времени прошло.
 */
public class TimelineRemoteViewsFactory implements RemoteViewsService.RemoteViewsFactory {

    static final String TIMELINE_URL =
            "https://raw.githubusercontent.com/borinsobaka-lab/task-tracker/app-config/timeline.json";
    static final String APP_URL = "https://borinsobaka-lab.github.io/task-tracker/";
    static final int RED = 0xFFDC2626;
    static final int ACCENT = 0xFF5B5BD6;
    static final int MEETING_COLOR = 0xFF1F2937; // тёмная полоса у встреч
    static final int CARD_H_DP = 58; // высота карточки — для позиционирования красной линии

    // Кэш загруженного timeline.json, чтобы поминутный тик не дёргал сеть каждую минуту
    private static List<Item> sCache = null;
    private static long sCacheAt = 0;

    private final Context ctx;
    private final List<Row> rows = new ArrayList<>();
    private long now = System.currentTimeMillis();

    TimelineRemoteViewsFactory(Context c) {
        this.ctx = c;
    }

    private static class Item {
        String id, title, date, start, kind, priorityColor;
        int durationMin = 60;
        boolean done;
        int color = ACCENT; // цвет полосы ответственности (исполнитель / встреча)
        long startMs, endMs;
    }

    private static class Row {
        boolean header;
        boolean overdueHeader;
        String headerText;
        int count;
        Item item;
        boolean overdue;
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
        now = System.currentTimeMillis();
        List<Item> items = load();
        String today = dayKey(now);

        List<Item> overdue = new ArrayList<>();
        List<Item> future = new ArrayList<>();
        boolean hasCurrent = false;
        for (Item it : items) {
            boolean isMeeting = "meeting".equals(it.kind);
            if (isCurrent(it)) hasCurrent = true;
            if (isMeeting) {
                if (it.endMs >= now) future.add(it);
            } else if (isOverdue(it) && cmp(it.date, today) < 0) {
                overdue.add(it);            // просрочено с прошлых дней — закрепляем сверху
            } else if (cmp(it.date, today) >= 0) {
                future.add(it);             // сегодня и дальше (в т.ч. сегодняшние просроченные)
            }
            // прошлый день и уже выполнено — не показываем
        }
        Comparator<Item> byDate = new Comparator<Item>() {
            @Override public int compare(Item a, Item b) {
                int c = cmp(a.date, b.date);
                return c != 0 ? c : safe(a.start).compareTo(safe(b.start));
            }
        };
        Collections.sort(overdue, byDate);
        Collections.sort(future, byDate);

        int todayCount = 0;
        for (Item it : future) if (today.equals(it.date)) todayCount++;
        ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).edit()
                .putInt("today_count", todayCount)
                .putBoolean("has_current", hasCurrent)
                .apply();
        // Просим провайдер обновить число в шапке и (пере)запланировать поминутный тик
        ctx.sendBroadcast(new Intent(ctx, TimelineWidgetProvider.class)
                .setAction(TimelineWidgetProvider.ACTION_BAR)
                .setPackage(ctx.getPackageName()));

        if (!overdue.isEmpty()) {
            Row h = new Row();
            h.header = true;
            h.overdueHeader = true;
            h.headerText = "Просрочено";
            h.count = overdue.size();
            rows.add(h);
            for (Item it : overdue) {
                Row r = new Row();
                r.item = it;
                r.overdue = true;
                rows.add(r);
            }
        }

        HashMap<String, Integer> dayCount = new HashMap<>();
        for (Item it : future) {
            Integer n = dayCount.get(it.date);
            dayCount.put(it.date, n == null ? 1 : n + 1);
        }

        String lastDay = null;
        for (Item it : future) {
            if (!it.date.equals(lastDay)) {
                lastDay = it.date;
                if (!today.equals(it.date)) {
                    Row h = new Row();
                    h.header = true;
                    h.headerText = dayLabel(it.date, today);
                    Integer n = dayCount.get(it.date);
                    h.count = n == null ? 0 : n;
                    rows.add(h);
                }
            }
            Row r = new Row();
            r.item = it;
            r.overdue = isOverdue(it); // сегодняшняя задача, у которой уже прошло время
            rows.add(r);
        }
    }

    private boolean isCurrent(Item it) {
        return it.start != null && !it.start.isEmpty() && it.startMs > 0
                && now >= it.startMs && now < it.endMs;
    }

    /**
     * Просрочено: невыполненная задача (не встреча), у которой:
     *  - есть время и оно уже прошло (endMs < now), либо
     *  - времени нет, а её дата уже прошла (date < сегодня).
     */
    private boolean isOverdue(Item it) {
        if ("meeting".equals(it.kind) || it.done) return false;
        boolean timed = it.start != null && !it.start.isEmpty();
        if (timed) return it.endMs < now;
        return cmp(it.date, dayKey(now)) < 0;
    }

    @Override
    public RemoteViews getViewAt(int position) {
        if (position < 0 || position >= rows.size()) return null;
        Row row = rows.get(position);

        if (row.header) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_item_header);
            rv.setTextViewText(R.id.header_text, row.headerText);
            rv.setTextViewText(R.id.header_count, row.count > 0 ? String.valueOf(row.count) : "");
            rv.setTextColor(R.id.header_text, row.overdueHeader ? RED : 0xFF3B3F66);
            rv.setTextColor(R.id.header_count, row.overdueHeader ? RED : 0xFF9095A8);
            return rv;
        }

        Item it = row.item;
        boolean isMeeting = "meeting".equals(it.kind);
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_item_task);

        // Полоса ответственности (цвет исполнителя; у встречи тёмная)
        rv.setInt(R.id.item_bar, "setColorFilter", it.color);
        rv.setInt(R.id.item_bar, "setImageAlpha", it.done ? 110 : 255);

        // Иконка встречи — перед названием; точка приоритета — под названием, слева от времени
        if (isMeeting) {
            rv.setViewVisibility(R.id.item_meeting, View.VISIBLE);
            rv.setViewVisibility(R.id.item_dot, View.GONE);
        } else {
            rv.setViewVisibility(R.id.item_meeting, View.GONE);
            if (it.priorityColor != null) {
                rv.setViewVisibility(R.id.item_dot, View.VISIBLE);
                rv.setInt(R.id.item_dot, "setColorFilter", parseColor(it.priorityColor));
                rv.setInt(R.id.item_dot, "setImageAlpha", it.done ? 110 : 255);
            } else {
                rv.setViewVisibility(R.id.item_dot, View.GONE);
            }
        }

        // Тег «просрочено» в правом нижнем углу — только у просроченных
        rv.setViewVisibility(R.id.item_overdue_tag, row.overdue ? View.VISIBLE : View.GONE);

        // Название (одна строка); просроченные — красным, выполненные — зачёркнуты
        if (row.overdue) {
            rv.setTextViewText(R.id.item_title, it.title);
            rv.setTextColor(R.id.item_title, RED);
            rv.setTextColor(R.id.item_time, 0xFF9CA3AF);
        } else if (it.done) {
            SpannableString s = new SpannableString(it.title);
            s.setSpan(new StrikethroughSpan(), 0, s.length(), 0);
            rv.setTextViewText(R.id.item_title, s);
            rv.setTextColor(R.id.item_title, 0xFF9AA0AE);
            rv.setTextColor(R.id.item_time, 0xFFB3B8C4);
        } else {
            rv.setTextViewText(R.id.item_title, it.title);
            rv.setTextColor(R.id.item_title, 0xFF111827);
            rv.setTextColor(R.id.item_time, 0xFF6B7280);
        }

        if (it.start != null && !it.start.isEmpty()) {
            rv.setViewVisibility(R.id.item_time, View.VISIBLE);
            rv.setTextViewText(R.id.item_time, it.start + "–" + addMinutes(it.start, it.durationMin));
        } else {
            rv.setViewVisibility(R.id.item_time, View.GONE);
        }

        // Красная линия текущего времени внутри идущей сейчас задачи
        if (isCurrent(it)) {
            float p = (float) (now - it.startMs) / (float) (it.endMs - it.startMs);
            if (p < 0f) p = 0f;
            if (p > 1f) p = 1f;
            int cardPx = dp(CARD_H_DP);
            int top = (int) (p * (cardPx - dp(3)));
            rv.setViewVisibility(R.id.item_now_holder, View.VISIBLE);
            rv.setViewPadding(R.id.item_now_holder, 0, top, 0, 0);
        } else {
            rv.setViewVisibility(R.id.item_now_holder, View.GONE);
        }

        Intent fill = new Intent();
        fill.setData(Uri.parse(APP_URL + "#card=" + Uri.encode(it.id)));
        rv.setOnClickFillInIntent(R.id.item_root, fill);
        return rv;
    }

    private int dp(int v) {
        return Math.round(v * ctx.getResources().getDisplayMetrics().density);
    }

    // ---------- Загрузка (с кэшем) ----------

    private List<Item> load() {
        if (sCache == null || now - sCacheAt >= 100000) {
            List<Item> f = fetch();
            if (!f.isEmpty()) {
                sCache = f;
                sCacheAt = now;
            } else if (sCache == null) {
                sCache = f; // первый раз сеть недоступна — пусто, повторим на следующем тике
            }
        }
        return sCache != null ? sCache : new ArrayList<Item>();
    }

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
                } else {
                    it.color = ACCENT;
                }
                boolean timed = it.start != null && !it.start.isEmpty();
                it.startMs = timed ? computeMs(it.date, it.start, 0) : 0;
                it.endMs = timed ? computeMs(it.date, it.start, it.durationMin) : endOfDay(it.date);
                out.add(it);
            }
        } catch (Exception e) {
            // сеть недоступна — вернём пусто (используем кэш, если был)
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
            if (dateKey.equals(todayKey)) name = "Сегодня";
            else if (dateKey.equals(tomorrow)) name = "Завтра";
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
