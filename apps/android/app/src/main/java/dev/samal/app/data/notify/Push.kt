package dev.samal.app.data.notify

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.samal.app.BuildConfig
import dev.samal.app.SamalApp
import dev.samal.app.data.sync.NavBus
import dev.samal.app.data.sync.previewText
import dev.samal.app.ui.previewLabel
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Firebase push, so messages and calls reach the phone while the app is closed.
 * Values come from app/google-services.json at build time (see app/build.gradle.kts);
 * without that file every call here is a no-op and the app works as before.
 */
object Push {
    private val io = Executors.newSingleThreadExecutor()

    val enabled: Boolean get() = BuildConfig.FCM_APP_ID.isNotBlank()

    fun init(ctx: Context) {
        if (!enabled || FirebaseApp.getApps(ctx).isNotEmpty()) return
        val options = FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FCM_APP_ID)
            .setApiKey(BuildConfig.FCM_API_KEY)
            .setProjectId(BuildConfig.FCM_PROJECT_ID)
            .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
            .build()
        runCatching { FirebaseApp.initializeApp(ctx, options) }
    }

    /** Sends this device's current token to the server; call after login and on start. */
    fun sync(app: SamalApp) {
        if (!enabled || !app.session.isLoggedIn) return
        init(app)
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> register(app, token) }
        }
    }

    fun register(app: SamalApp, token: String) {
        if (token.isBlank() || !app.session.isLoggedIn) return
        io.execute { runCatching { app.api.registerPush(token) } }
    }
}

class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Push.register(application as SamalApp, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["kind"]) {
            "message" -> {
                val chatId = data["chat_id"].orEmpty()
                if (chatId.isBlank() || Mutes.has(this, chatId)) return
                // The open chat on screen already shows it.
                if (NavBus.resumed && NavBus.openChatId == chatId) return
                val label = previewLabel(this, previewText(data["type"] ?: "text", data["text"].orEmpty(), false))
                Notifier.message(this, chatId, data["title"].orEmpty(), label)
            }
            "call" -> {
                val raw = data["call"] ?: return
                val call = runCatching { JSONObject(raw) }.getOrNull() ?: return
                if (call.optString("status") != "ringing") return
                Notifier.incomingCall(this, call, data["title"].orEmpty())
                if (NavBus.incoming.value == null) NavBus.incoming.value = raw
            }
            "call_end" -> {
                val id = data["call_id"].orEmpty()
                Notifier.cancelCall(this, id)
                val current = NavBus.incoming.value
                if (current != null && runCatching { JSONObject(current).optString("id") }.getOrNull() == id) {
                    NavBus.incoming.value = null
                }
            }
        }
    }
}
