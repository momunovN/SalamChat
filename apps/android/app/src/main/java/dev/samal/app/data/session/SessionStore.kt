package dev.samal.app.data.session

import android.content.Context
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.samal.app.data.api.SamalApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class SessionStore(
    context: Context,
    private val api: SamalApi,
) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var user by mutableStateOf<User?>(null)
        private set

    val isLoggedIn: Boolean get() = user != null

    init {
        val raw = prefs.getString(KEY, null)
        if (raw != null) {
            runCatching { apply(Session.from(JSONObject(raw))) }
        }
    }

    fun apply(sess: Session) {
        user = sess.user
        api.token = sess.accessToken
        prefs.edit().putString(KEY, sess.toJson().toString()).apply()
    }

    fun logout() {
        user = null
        api.token = null
        prefs.edit().remove(KEY).apply()
    }

    suspend fun requestOtp(phone: String): String? = withContext(Dispatchers.IO) {
        api.requestOtp(phone)
    }

    suspend fun login(phone: String, code: String) {
        val sess = withContext(Dispatchers.IO) {
            api.verifyOtp(phone, code, Build.MODEL.ifBlank { "Android" })
        }
        apply(sess)
    }

    companion object {
        private const val PREFS = "samal.session"
        private const val KEY = "session"
    }
}
