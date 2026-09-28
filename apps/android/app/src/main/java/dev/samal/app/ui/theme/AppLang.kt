package dev.samal.app.ui.theme

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import java.util.Locale

object AppLang {
    private const val PREFS = "samal.session"
    private const val KEY = "lang"

    fun code(ctx: Context): String {
        val saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        if (saved == "ru" || saved == "ky") return saved
        return if (Locale.getDefault().language == "ky") "ky" else "ru"
    }

    fun wrap(base: Context): Context {
        val locale = Locale(code(base))
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        return base.createConfigurationContext(config)
    }

    fun set(activity: Activity, lang: String) {
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, lang).apply()
        activity.recreate()
    }
}
