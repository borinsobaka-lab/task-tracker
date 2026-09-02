package com.borinsobaka.tasktracker;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Общее хранилище виджета: кто выбран в приложении («Кто вы?») и что показывать
 * в шапке. Участника пишет оболочка-WebView (MainActivity), читает виджет.
 */
final class WidgetPrefs {

    static final String FILE = "widget";

    private static final String KEY_ID = "identity_id";
    private static final String KEY_NAME = "identity_name";
    private static final String KEY_WHO = "who_label";

    private WidgetPrefs() {}

    static SharedPreferences of(Context ctx) {
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** id выбранного участника или null, если в приложении никто не выбран. */
    static String identityId(Context ctx) {
        return emptyToNull(of(ctx).getString(KEY_ID, null));
    }

    /** Имя выбранного участника (для шапки и для старых снимков без id) или null. */
    static String identityName(Context ctx) {
        return emptyToNull(of(ctx).getString(KEY_NAME, null));
    }

    /** Запоминает выбранного участника. Возвращает true, если что-то изменилось. */
    static boolean setIdentity(Context ctx, String id, String name) {
        String newId = emptyToNull(id);
        String newName = emptyToNull(name);
        if (eq(newId, identityId(ctx)) && eq(newName, identityName(ctx))) return false;
        of(ctx).edit()
                .putString(KEY_ID, newId == null ? "" : newId)
                .putString(KEY_NAME, newName == null ? "" : newName)
                .apply();
        return true;
    }

    /** Подпись в шапке виджета: чьи задачи показаны (пусто — фильтра нет). */
    static String whoLabel(Context ctx) {
        String s = of(ctx).getString(KEY_WHO, "");
        return s == null ? "" : s;
    }

    static void setWhoLabel(Context ctx, String label) {
        of(ctx).edit().putString(KEY_WHO, label == null ? "" : label).apply();
    }

    private static String emptyToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }
}
