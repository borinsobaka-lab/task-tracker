package com.borinsobaka.tasktracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Calendar;
import java.util.Iterator;
import java.util.Locale;

/**
 * Лимиты подписки Claude (то же, что показывает /usage в Claude Code):
 * 5-часовая сессия, неделя по всем моделям и неделя по Fable.
 *
 * Вход — свой OAuth-токен телефона (PKCE, код вставляется вручную), а не токен
 * с компьютера: refresh-токен при обновлении меняется, и если бы телефон обновлял
 * токен Claude Code, тот на компьютере разлогинивался бы. Просим только scope
 * user:profile — его хватает, чтобы читать лимиты; писать в Claude от имени
 * пользователя этот токен не может.
 */
final class ClaudeUsage {

    // Те же адреса и client_id, что у Claude Code (`claude auth login`).
    private static final String AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
    private static final String TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
    private static final String REDIRECT_URL = "https://platform.claude.com/oauth/code/callback";
    private static final String CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
    private static final String SCOPE = "user:profile";
    private static final String USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
    private static final String OAUTH_BETA = "oauth-2025-04-20";
    private static final String USER_AGENT = "task-tracker-android/1.0";

    /** Отдельный файл настроек — исключён из резервной копии (там токены). */
    static final String FILE = "claude_usage";
    private static final String K_ACCESS = "access_token";
    private static final String K_REFRESH = "refresh_token";
    private static final String K_EXPIRES = "expires_at";
    private static final String K_VERIFIER = "pkce_verifier";
    private static final String K_STATE = "pkce_state";
    private static final String K_RAW = "usage_raw";
    private static final String K_FETCHED = "usage_fetched_at";
    private static final String K_ERROR = "usage_error";

    /** Данные моложе этого не перезапрашиваем (тик виджета, повторные нажатия). */
    static final long FRESH_MS = 4 * 60 * 1000L;

    private static final Object LOCK = new Object(); // один refresh за раз: токен одноразовый

    private ClaudeUsage() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- вход

    static boolean isConnected(Context ctx) {
        return prefs(ctx).getString(K_REFRESH, null) != null;
    }

    /** Шаг 1: адрес страницы входа Claude. Verifier/state запоминаем до шага 2. */
    static String startLogin(Context ctx) {
        String verifier = randomUrlSafe(32);
        String state = randomUrlSafe(32);
        prefs(ctx).edit().putString(K_VERIFIER, verifier).putString(K_STATE, state).apply();
        return Uri.parse(AUTHORIZE_URL).buildUpon()
                .appendQueryParameter("code", "true")
                .appendQueryParameter("client_id", CLIENT_ID)
                .appendQueryParameter("response_type", "code")
                .appendQueryParameter("redirect_uri", REDIRECT_URL)
                .appendQueryParameter("scope", SCOPE)
                .appendQueryParameter("code_challenge", challenge(verifier))
                .appendQueryParameter("code_challenge_method", "S256")
                .appendQueryParameter("state", state)
                .build().toString();
    }

    /**
     * Шаг 2: код со страницы Claude («код#state») меняем на токены.
     * Сеть — вызывать не из главного потока. Бросает исключение с понятным текстом.
     */
    static void finishLogin(Context ctx, String pasted) throws Exception {
        SharedPreferences p = prefs(ctx);
        String verifier = p.getString(K_VERIFIER, null);
        String state = p.getString(K_STATE, null);
        if (verifier == null || state == null) throw new Exception("Сначала нажмите «Открыть вход Claude»");
        String code = pasted == null ? "" : pasted.trim();
        int hash = code.indexOf('#');
        if (hash >= 0) {
            String gotState = code.substring(hash + 1).trim();
            code = code.substring(0, hash).trim();
            if (!gotState.isEmpty() && !gotState.equals(state)) {
                throw new Exception("Код от другой попытки входа — откройте вход ещё раз");
            }
        }
        if (code.isEmpty()) throw new Exception("Вставьте код со страницы Claude");

        JSONObject body = new JSONObject()
                .put("grant_type", "authorization_code")
                .put("code", code)
                .put("redirect_uri", REDIRECT_URL)
                .put("client_id", CLIENT_ID)
                .put("code_verifier", verifier)
                .put("state", state);
        Http r = post(TOKEN_URL, body);
        if (r.code != 200) {
            throw new Exception(r.code == 400 || r.code == 401
                    ? "Код не подошёл (устарел или уже использован) — откройте вход ещё раз"
                    : r.code == 429 ? "Claude просит подождать — попробуйте через минуту"
                    : "Ошибка входа: HTTP " + r.code);
        }
        synchronized (LOCK) {
            saveTokens(ctx, new JSONObject(r.body), null);
        }
        p.edit().remove(K_VERIFIER).remove(K_STATE).remove(K_ERROR).apply();
    }

    static void logout(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }

    private static void saveTokens(Context ctx, JSONObject t, String oldRefresh) throws Exception {
        String access = t.optString("access_token", "");
        if (access.isEmpty()) throw new Exception("Сервер не вернул токен");
        String refresh = t.optString("refresh_token", "");
        if (refresh.isEmpty()) refresh = oldRefresh;
        long expiresIn = t.optLong("expires_in", 3600);
        prefs(ctx).edit()
                .putString(K_ACCESS, access)
                .putString(K_REFRESH, refresh)
                .putLong(K_EXPIRES, System.currentTimeMillis() + expiresIn * 1000L)
                .commit(); // сразу на диск: старый refresh-токен уже потрачен, терять новый нельзя
    }

    /** Обновляет access-токен. false — refresh-токен отозван, нужен новый вход. */
    private static boolean refresh(Context ctx) throws Exception {
        String rt = prefs(ctx).getString(K_REFRESH, null);
        if (rt == null) return false;
        JSONObject body = new JSONObject()
                .put("grant_type", "refresh_token")
                .put("refresh_token", rt)
                .put("client_id", CLIENT_ID)
                .put("scope", SCOPE);
        Http r = post(TOKEN_URL, body);
        if (r.code == 400 || r.code == 401) return false;
        if (r.code != 200) {
            throw new Exception(r.code == 429 ? "слишком частые запросы" : "ошибка входа HTTP " + r.code);
        }
        saveTokens(ctx, new JSONObject(r.body), rt);
        return true;
    }

    // ---------------------------------------------------------------- загрузка

    /**
     * Загружает свежие лимиты (если кэш старше FRESH_MS или force) и кладёт их в кэш.
     * Ошибку не бросает — записывает её текст, виджет покажет его рядом со старыми цифрами.
     */
    static void fetch(Context ctx, boolean force) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            if (!isConnected(ctx)) return;
            if (!force && System.currentTimeMillis() - p.getLong(K_FETCHED, 0) < FRESH_MS) return;
            try {
                if (System.currentTimeMillis() > p.getLong(K_EXPIRES, 0) - 5 * 60 * 1000L && !refresh(ctx)) {
                    signedOut(ctx);
                    return;
                }
                Http r = getUsage(p.getString(K_ACCESS, ""));
                if (r.code == 401) { // токен отозвали раньше срока — одна попытка обновить
                    if (!refresh(ctx)) {
                        signedOut(ctx);
                        return;
                    }
                    r = getUsage(p.getString(K_ACCESS, ""));
                }
                if (r.code != 200) {
                    p.edit().putString(K_ERROR, r.code == 429 ? "слишком частые запросы" : "ошибка HTTP " + r.code).apply();
                    return;
                }
                new JSONObject(r.body); // проверяем, что это JSON, прежде чем заменить кэш
                p.edit()
                        .putString(K_RAW, r.body)
                        .putLong(K_FETCHED, System.currentTimeMillis())
                        .remove(K_ERROR)
                        .apply();
            } catch (IOException e) {
                p.edit().putString(K_ERROR, "нет связи").apply();
            } catch (Exception e) {
                p.edit().putString(K_ERROR, e.getMessage() != null ? e.getMessage() : "ошибка").apply();
            }
        }
    }

    private static void signedOut(Context ctx) {
        // Вход отозван: токены больше не годятся, последние цифры оставляем для истории.
        prefs(ctx).edit().remove(K_ACCESS).remove(K_REFRESH).remove(K_EXPIRES)
                .putString(K_ERROR, "вход устарел — войдите снова").apply();
    }

    private static Http getUsage(String access) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(USAGE_URL).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setRequestProperty("Authorization", "Bearer " + access);
        c.setRequestProperty("anthropic-beta", OAUTH_BETA);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", USER_AGENT);
        return Http.read(c);
    }

    private static Http post(String url, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", USER_AGENT);
        try (OutputStream os = c.getOutputStream()) {
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        return Http.read(c);
    }

    private static final class Http {
        int code;
        String body;

        static Http read(HttpURLConnection c) throws Exception {
            Http h = new Http();
            try {
                h.code = c.getResponseCode();
                InputStream in = h.code >= 400 ? c.getErrorStream() : c.getInputStream();
                StringBuilder sb = new StringBuilder();
                if (in != null) {
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line).append('\n');
                    }
                }
                h.body = sb.toString();
                return h;
            } finally {
                c.disconnect();
            }
        }
    }

    // ---------------------------------------------------------------- разбор

    /** Одно окно лимита. percent < 0 — данных нет. */
    static final class Window {
        double percent = -1;
        long resetsAt; // мс; 0 — окно ещё не началось

        boolean known() {
            return percent >= 0;
        }
    }

    static final class Snapshot {
        final Window session = new Window();  // 5 часов
        final Window weekAll = new Window();  // неделя, все модели
        final Window weekFable = new Window(); // неделя, Fable
        String fableName = "Fable";
        long fetchedAt;
        String error;
        boolean connected;
    }

    /** Последние загруженные лимиты (из кэша, без сети). */
    static Snapshot cached(Context ctx) {
        SharedPreferences p = prefs(ctx);
        Snapshot s = new Snapshot();
        s.connected = isConnected(ctx);
        s.error = p.getString(K_ERROR, null);
        s.fetchedAt = p.getLong(K_FETCHED, 0);
        String raw = p.getString(K_RAW, null);
        if (raw != null) {
            try {
                parse(new JSONObject(raw), s);
            } catch (Exception ignored) {
                // битый кэш — просто покажем «нет данных»
            }
        }
        return s;
    }

    /**
     * Ответ /api/oauth/usage: five_hour / seven_day ({utilization 0–100, resets_at})
     * и массив limits[] ({kind: session | weekly_all | weekly_scoped, percent,
     * resets_at, scope.model.display_name}) — в нём и лежит недельный лимит Fable.
     */
    static void parse(JSONObject o, Snapshot s) {
        readWindow(o.optJSONObject("five_hour"), "utilization", s.session);
        readWindow(o.optJSONObject("seven_day"), "utilization", s.weekAll);

        JSONArray limits = o.optJSONArray("limits");
        if (limits != null) {
            for (int i = 0; i < limits.length(); i++) {
                JSONObject l = limits.optJSONObject(i);
                if (l == null) continue;
                String kind = l.optString("kind", "");
                if ("session".equals(kind) && !s.session.known()) {
                    readWindow(l, "percent", s.session);
                } else if ("weekly_all".equals(kind) && !s.weekAll.known()) {
                    readWindow(l, "percent", s.weekAll);
                } else if ("weekly_scoped".equals(kind) && !s.weekFable.known()) {
                    JSONObject scope = l.optJSONObject("scope");
                    JSONObject model = scope == null ? null : scope.optJSONObject("model");
                    String name = model == null ? "" : model.optString("display_name", "");
                    if (name.toLowerCase(Locale.ROOT).contains("fable")) {
                        s.fableName = name;
                        readWindow(l, "percent", s.weekFable);
                    }
                }
            }
        }

        // Запасной вариант: отдельное поле вида seven_day_fable
        if (!s.weekFable.known()) {
            Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (k.startsWith("seven_day_") && k.contains("fable")) {
                    readWindow(o.optJSONObject(k), "utilization", s.weekFable);
                    if (s.weekFable.known()) break;
                }
            }
        }
    }

    private static void readWindow(JSONObject w, String percentKey, Window out) {
        if (w == null || !w.has(percentKey) || w.isNull(percentKey)) return;
        out.percent = Math.max(0, w.optDouble(percentKey, 0));
        out.resetsAt = parseTime(w.opt("resets_at"));
    }

    private static long parseTime(Object v) {
        if (v instanceof Number) {
            long n = ((Number) v).longValue();
            return n < 100_000_000_000L ? n * 1000L : n; // секунды или уже миллисекунды
        }
        if (v instanceof String && !((String) v).isEmpty()) {
            try {
                return OffsetDateTime.parse((String) v).toInstant().toEpochMilli();
            } catch (Exception ignored) {
            }
        }
        return 0;
    }

    // ---------------------------------------------------------------- подписи

    private static final String[] DOW = {"вс", "пн", "вт", "ср", "чт", "пт", "сб"};

    static String percentText(Window w) {
        return w.known() ? Math.round(w.percent) + "%" : "—";
    }

    /** «сброс через 2 ч 14 мин · 15:00», «сброс через 3 д 5 ч · пт 10:00». */
    static String resetText(Window w, long now) {
        if (!w.known()) return "нет данных";
        if (w.resetsAt <= 0) return "ещё не начат";
        long left = w.resetsAt - now;
        if (left <= 0) return "сбрасывается…";
        return "сброс через " + duration(left) + " · " + clock(w.resetsAt, now);
    }

    static String duration(long ms) {
        long min = (ms + 59_999) / 60_000; // вверх, чтобы не писать «0 мин»
        if (min < 60) return min + " мин";
        long h = min / 60, m = min % 60;
        if (h < 24) return m == 0 ? h + " ч" : h + " ч " + m + " мин";
        long d = h / 24, hh = h % 24;
        return hh == 0 ? d + " д" : d + " д " + hh + " ч";
    }

    private static String clock(long at, long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        String hm = String.format(Locale.ROOT, "%d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
        Calendar t = Calendar.getInstance();
        t.setTimeInMillis(now);
        boolean sameDay = t.get(Calendar.YEAR) == c.get(Calendar.YEAR)
                && t.get(Calendar.DAY_OF_YEAR) == c.get(Calendar.DAY_OF_YEAR);
        return sameDay ? hm : DOW[c.get(Calendar.DAY_OF_WEEK) - 1] + " " + hm;
    }

    /** Цвет по заполненности: спокойный → оранжевый (от 75%) → красный (от 90%). */
    static int levelColor(Window w) {
        if (!w.known()) return 0xFF9CA3AF;
        if (w.percent >= 90) return 0xFFDC2626;
        if (w.percent >= 75) return 0xFFF59E0B;
        return 0xFF5B5BD6;
    }

    // ---------------------------------------------------------------- PKCE

    private static String randomUrlSafe(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private static String challenge(String verifier) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.encodeToString(d, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
