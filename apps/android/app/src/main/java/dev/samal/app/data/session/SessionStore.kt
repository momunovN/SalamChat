package dev.samal.app.data.session

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.contacts.BookContact
import dev.samal.app.data.sync.InboxService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class SessionStore(
    context: Context,
    private val api: SamalApi,
) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var user by mutableStateOf<User?>(null)
        private set

    val isLoggedIn: Boolean get() = user != null

    init {
        val raw = prefs.getString(KEY, null)
        if (raw != null) {
            runCatching { apply(Session.from(JSONObject(raw)), startInbox = false) }
        }
    }

    fun apply(sess: Session, startInbox: Boolean = true) {
        user = sess.user
        api.token = sess.accessToken
        api.refreshToken = sess.refreshToken
        api.onSession = { next ->
            Handler(Looper.getMainLooper()).post { apply(next) }
        }
        prefs.edit().putString(KEY, sess.toJson().toString()).apply()
        if (startInbox) InboxService.start(app)
    }

    fun logout() {
        user = null
        api.token = null
        api.refreshToken = null
        api.onSession = null
        prefs.edit().remove(KEY).apply()
        InboxService.stop(app)
    }

    suspend fun requestOtp(email: String, phone: String): String? = withContext(Dispatchers.IO) {
        api.requestOtp(email, phone)
    }

    suspend fun login(email: String, phone: String, code: String) {
        val sess = withContext(Dispatchers.IO) {
            api.verifyOtp(email, phone, code, Build.MODEL.ifBlank { "Android" })
        }
        apply(sess)
    }

    suspend fun patchProfile(displayName: String, username: String?, bio: String? = null) {
        val raw = withContext(Dispatchers.IO) { api.patchMe(displayName, username, bio) }
        val current = prefs.getString(KEY, null) ?: return
        val sess = Session.from(JSONObject(current))
        val nextUser = Session.from(
            JSONObject()
                .put("access_token", sess.accessToken)
                .put("refresh_token", sess.refreshToken)
                .put("expires_at", sess.expiresAt)
                .put("device_id", sess.deviceId)
                .put("user", raw),
        )
        apply(nextUser)
    }

    suspend fun syncContacts(enabled: Boolean, items: List<BookContact>) {
        withContext(Dispatchers.IO) { api.syncContacts(enabled, items) }
    }

    companion object {
        private const val PREFS = "samal.session"
        private const val KEY = "session"
    }
}
