package com.borinsobaka.tasktracker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Задачи (сессии) Claude Code для виджета «Задачи Claude»: те, что сейчас в работе
 * (синяя точка), и готовые, которые ещё не открывали (зелёная). Открытые в Claude
 * готовые задачи из виджета пропадают.
 *
 * Список — тот же, что у `claude --teleport`: GET /v1/code/sessions (старый API —
 * /v1/sessions) со входом телефона из ClaudeUsage. «Не смотрел» берём из поля
 * unread, если сервер его отдаёт; иначе помним сами, что и в каком состоянии
 * открывали из виджета.
 */
final class ClaudeSessions {

    private static final String API = "https://api.anthropic.com";
    private static final String LIST_V2 = API + "/v1/code/sessions?limit=50";
    private static final String LIST_V1 = API + "/v1/sessions?limit=50";
    private static final String CCR_BETA = "ccr-byoc-2025-07-29";
    static final String OPEN_URL = "https://claude.ai/code/";

    private static final String FILE = "claude_sessions";
    private static final String K_RAW = "raw";
    private static final String K_FETCHED = "fetched_at";
    private static final String K_ERROR = "error";
    private static final String K_SEEN = "seen";         // {id: updated_at, когда открыли/застали}
    private static final String K_BASELINE = "baseline"; // первая загрузка без unread уже была

    /** Данные моложе этого по таймеру не перезапрашиваем. */
    static final long FRESH_MS = 2 * 60 * 1000L;

    static final int WORKING = 0, READY = 1, FAILED = 2;

    private ClaudeSessions() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static final class Item {
        String id;       // session_…
        String title;
        String summary;  // что сделано / что спрашивает — из post_turn_summary
        int state;
        long updatedAt;
        String updatedRaw = "";
        Boolean unread;  // null — сервер не сказал
    }

    static final class Snapshot {
        final List<Item> items = new ArrayList<>();
        long fetchedAt;
        String error;
        boolean connected;   // вход в Claude есть
        boolean canRead;     // и в нём есть доступ к задачам
    }

    // ---------------------------------------------------------------- загрузка

    /** Свежий список в кэш (если кэш устарел или force). Ошибку не бросает — пишет её текст. */
    static void fetch(Context ctx, boolean force) {
        synchronized (ClaudeUsage.LOCK) {
            SharedPreferences p = prefs(ctx);
            if (!ClaudeUsage.canReadSessions(ctx)) return;
            if (!force && System.currentTimeMillis() - p.getLong(K_FETCHED, 0) < FRESH_MS) return;
            try {
                String access = ClaudeUsage.accessToken(ctx);
                if (access == null) return;
                String org = ClaudeUsage.orgUuid(ctx, access);
                ClaudeUsage.Http r = list(access, org);
                if (r.code == 401) {
                    access = ClaudeUsage.accessTokenAfter401(ctx);
                    if (access == null) return;
                    r = list(access, org);
                }
                if (r.code != 200) {
                    p.edit().putString(K_ERROR, r.code == 429 ? "слишком частые запросы"
                            : r.code == 403 ? "нет доступа — войдите заново"
                            : "ошибка HTTP " + r.code).apply();
                    return;
                }
                JSONObject o = new JSONObject(r.body);
                if (o.optJSONArray("data") == null) throw new Exception("непонятный ответ сервера");
                p.edit()
                        .putString(K_RAW, r.body)
                        .putLong(K_FETCHED, System.currentTimeMillis())
                        .remove(K_ERROR)
                        .apply();
                baseline(ctx, parse(o));
            } catch (IOException e) {
                p.edit().putString(K_ERROR, "нет связи").apply();
            } catch (Exception e) {
                p.edit().putString(K_ERROR, e.getMessage() != null ? e.getMessage() : "ошибка").apply();
            }
        }
    }

    /** Новый API, а если его нет (404) — старый. */
    private static ClaudeUsage.Http list(String access, String org) throws Exception {
        ClaudeUsage.Http r = get(LIST_V2, access, org, null);
        if (r.code == 404) r = get(LIST_V1, access, org, CCR_BETA);
        return r;
    }

    private static ClaudeUsage.Http get(String url, String access, String org, String beta) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(10000);
        c.setRequestProperty("Authorization", "Bearer " + access);
        c.setRequestProperty("anthropic-version", "2023-06-01");
        c.setRequestProperty("x-organization-uuid", org);
        if (beta != null) c.setRequestProperty("anthropic-beta", beta);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", ClaudeUsage.USER_AGENT);
        return ClaudeUsage.Http.read(c);
    }

    // ---------------------------------------------------------------- «смотрел»

    /**
     * Сервер не отдаёт unread — при первой загрузке считаем просмотренным всё, что
     * уже готово, иначе виджет вывалил бы всю историю.
     */
    private static void baseline(Context ctx, List<Item> items) {
        SharedPreferences p = prefs(ctx);
        if (p.getBoolean(K_BASELINE, false)) return;
        for (Item it : items) if (it.unread != null) {
            p.edit().putBoolean(K_BASELINE, true).apply(); // сервер знает сам — запоминать нечего
            return;
        }
        JSONObject seen = seen(ctx);
        try {
            for (Item it : items) if (it.state != WORKING) seen.put(it.id, it.updatedRaw);
        } catch (Exception ignored) {
        }
        p.edit().putString(K_SEEN, seen.toString()).putBoolean(K_BASELINE, true).apply();
    }

    /** Задачу открыли из виджета: скрываем её, пока в ней ничего не изменится. */
    static void markSeen(Context ctx, String id, String updatedRaw) {
        JSONObject seen = seen(ctx);
        try {
            seen.put(id, updatedRaw == null ? "" : updatedRaw);
            // Не копим вечно: оставляем последние 200
            if (seen.length() > 200) {
                JSONArray names = seen.names();
                for (int i = 0; names != null && i < names.length() - 200; i++) seen.remove(names.getString(i));
            }
        } catch (Exception ignored) {
        }
        prefs(ctx).edit().putString(K_SEEN, seen.toString()).apply();
    }

    private static JSONObject seen(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString(K_SEEN, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    // ---------------------------------------------------------------- разбор

    /** Что показать в виджете (из кэша, без сети): готовые сверху, потом в работе; новые выше. */
    static Snapshot cached(Context ctx) {
        SharedPreferences p = prefs(ctx);
        Snapshot s = new Snapshot();
        s.connected = ClaudeUsage.isConnected(ctx);
        s.canRead = ClaudeUsage.canReadSessions(ctx);
        s.error = p.getString(K_ERROR, null);
        s.fetchedAt = p.getLong(K_FETCHED, 0);
        if (!s.canRead) return s;
        String raw = p.getString(K_RAW, null);
        if (raw == null) return s;
        JSONObject seen = seen(ctx);
        try {
            for (Item it : parse(new JSONObject(raw))) {
                // Открывали из виджета и с тех пор ничего не поменялось — уже смотрели
                if (it.updatedRaw.equals(seen.optString(it.id, null))) continue;
                // Готовую, просмотренную в Claude, не показываем. Без unread от сервера
                // сюда доходят только новые или изменившиеся после открытия задачи.
                if (it.state != WORKING && Boolean.FALSE.equals(it.unread)) continue;
                s.items.add(it);
            }
        } catch (Exception ignored) {
            // битый кэш — покажем пустой список
        }
        Collections.sort(s.items, (a, b) -> {
            int ga = a.state == WORKING ? 1 : 0, gb = b.state == WORKING ? 1 : 0;
            if (ga != gb) return ga - gb;
            return Long.compare(b.updatedAt, a.updatedAt);
        });
        return s;
    }

    /** Сессии из ответа списка; архивные отбрасываем. */
    static List<Item> parse(JSONObject o) {
        List<Item> out = new ArrayList<>();
        JSONArray data = o.optJSONArray("data");
        if (data == null) return out;
        for (int i = 0; i < data.length(); i++) {
            JSONObject n = data.optJSONObject(i);
            if (n == null) continue;
            String id = n.optString("id", "");
            if (id.isEmpty()) continue;
            if (id.startsWith("cse_")) id = "session_" + id.substring(4); // id нового API → адрес claude.ai
            if (!id.matches("[A-Za-z0-9_-]+")) continue;

            String status = norm(n.optString("status", ""));
            String sessionStatus = norm(n.optString("session_status", ""));
            if ("archived".equals(status) || "archived".equals(sessionStatus)) continue;
            Integer state = stateOf(n, sessionStatus);
            if (state == null) continue;

            Item it = new Item();
            it.id = id;
            it.state = state;
            it.title = n.optString("title", "").trim();
            if (it.title.isEmpty()) it.title = "Без названия";
            it.summary = summary(n);
            for (String k : new String[]{"updated_at", "last_event_at", "created_at"}) {
                String v = n.optString(k, "");
                if (!v.isEmpty() && !"null".equals(v)) {
                    it.updatedRaw = v;
                    break;
                }
            }
            it.updatedAt = parseTime(it.updatedRaw);
            if (n.has("unread") && !n.isNull("unread")) it.unread = n.optBoolean("unread", false);
            out.add(it);
        }
        // Сервер пишет unread только у непросмотренных: раз поле где-то есть,
        // у остальных его отсутствие значит «смотрел»
        boolean serverKnows = false;
        for (Item it : out) serverKnows |= it.unread != null;
        if (serverKnows) for (Item it : out) if (it.unread == null) it.unread = false;
        return out;
    }

    /** working → в работе; blocked / review_ready / completed → готово; failed → ошибка. */
    private static Integer stateOf(JSONObject n, String sessionStatus) {
        String bucket = norm(n.optString("status_bucket", ""));
        switch (bucket) {
            case "working": return WORKING;
            case "blocked":
            case "review_ready":
            case "completed": return READY;
            case "failed": return FAILED;
            default: break;
        }
        String s = sessionStatus.isEmpty() ? norm(n.optString("worker_status", "")) : sessionStatus;
        switch (s) {
            case "running":
            case "pending":
            case "active": return WORKING;
            case "idle":
            case "requires_action":
            case "paused":
            case "completed": return READY;
            case "failed": return FAILED;
            default: return null;
        }
    }

    /** «SESSION_STATUS_BUCKET_WORKING» и «working» — одно и то же. */
    private static String norm(String v) {
        String s = v == null ? "" : v.trim().toLowerCase(Locale.ROOT);
        for (String prefix : new String[]{"session_status_bucket_", "session_status_", "worker_status_"}) {
            if (s.startsWith(prefix)) return s.substring(prefix.length());
        }
        return s;
    }

    private static String summary(JSONObject n) {
        JSONObject meta = n.optJSONObject("external_metadata");
        JSONObject pts = n.optJSONObject("post_turn_summary");
        if (pts == null && meta != null) pts = meta.optJSONObject("post_turn_summary");
        if (pts != null) {
            for (String k : new String[]{"needs_action", "recent_action", "status_detail"}) {
                String v = pts.optString(k, "").trim();
                if (!v.isEmpty() && !"null".equals(v)) return v;
            }
        }
        String t = n.optString("task_summary", "").trim();
        if (t.isEmpty() && meta != null) t = meta.optString("task_summary", "").trim();
        return "null".equals(t) ? "" : t;
    }

    private static long parseTime(String v) {
        if (v == null || v.isEmpty()) return 0;
        try {
            return OffsetDateTime.parse(v).toInstant().toEpochMilli();
        } catch (Exception e) {
            return 0;
        }
    }

    // ---------------------------------------------------------------- подписи

    static int color(int state) {
        switch (state) {
            case WORKING: return 0xFF2563EB; // синяя — в работе
            case FAILED: return 0xFFDC2626;  // красная — упала
            default: return 0xFF16A34A;      // зелёная — готово, не смотрел
        }
    }

    static String stateText(int state) {
        switch (state) {
            case WORKING: return "в работе";
            case FAILED: return "ошибка";
            default: return "готово";
        }
    }

    /** «только что», «5 мин назад», «2 ч назад», «3 д назад». */
    static String ago(long at, long now) {
        if (at <= 0) return "";
        long min = Math.max(0, (now - at) / 60_000);
        if (min < 1) return "только что";
        if (min < 60) return min + " мин назад";
        long h = min / 60;
        if (h < 24) return h + " ч назад";
        return (h / 24) + " д назад";
    }
}
