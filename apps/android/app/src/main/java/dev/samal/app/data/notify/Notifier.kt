package dev.samal.app.data.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import java.time.Instant
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import dev.samal.app.MainActivity
import dev.samal.app.R

object Notifier {
    private const val ONGOING = "salam.ongoing"
    private const val MESSAGES = "salam.messages.v2"
    private const val ONGOING_ID = 41

    fun ensure(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(ONGOING) == null) {
            nm.createNotificationChannel(
                NotificationChannel(ONGOING, ctx.getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW),
            )
        }
        if (nm.getNotificationChannel(MESSAGES) == null) {
            val ch = NotificationChannel(MESSAGES, ctx.getString(R.string.tab_chats), NotificationManager.IMPORTANCE_HIGH)
            ch.enableVibration(true)
            ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(ch)
        }
    }

    fun ongoing(ctx: Context): Notification {
        ensure(ctx)
        return NotificationCompat.Builder(ctx, ONGOING)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(ctx.getString(R.string.app_name))
            .setContentText(ctx.getString(R.string.notify_listening))
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    fun inCall(ctx: Context, title: String): Notification {
        ensure(ctx)
        val open = PendingIntent.getActivity(
            ctx,
            42,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(ctx, ONGOING)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(ctx.getString(R.string.in_call))
            .setContentText(title)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build()
    }

    fun message(ctx: Context, chatId: String, title: String, body: String) {
        ensure(ctx)
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("chat_id", chatId)
        }
        val pi = PendingIntent.getActivity(
            ctx,
            chatId.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val text = body.ifBlank { ctx.getString(R.string.composer) }
        val note = NotificationCompat.Builder(ctx, MESSAGES)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title.ifBlank { ctx.getString(R.string.app_name) })
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(chatId.hashCode(), note)
    }

    fun chime(ctx: Context) {
        Handler(Looper.getMainLooper()).post {
            val player = runCatching { MediaPlayer.create(ctx.applicationContext, R.raw.alert_tone) }.getOrNull() ?: return@post
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            player.setOnCompletionListener { it.release() }
            player.start()
            Handler(Looper.getMainLooper()).postDelayed({
                runCatching {
                    if (player.isPlaying) player.stop()
                    player.release()
                }
            }, 220)
        }
    }
}

object Mutes {
    private const val PREFS = "samal.session"
    private const val KEY = "muted.chats"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun ids(ctx: Context) = (prefs(ctx).getStringSet(KEY, emptySet()) ?: emptySet()).toMutableSet()

    fun has(ctx: Context, chatId: String): Boolean {
        if (chatId.isBlank()) return false
        return ids(ctx).contains(chatId.lowercase())
    }

    fun set(ctx: Context, chatId: String, muted: Boolean) {
        if (chatId.isBlank()) return
        val next = ids(ctx)
        val id = chatId.lowercase()
        if (muted) next.add(id) else next.remove(id)
        prefs(ctx).edit().putStringSet(KEY, next).apply()
    }

    fun applyList(ctx: Context, items: JSONArray) {
        val next = ids(ctx)
        val now = System.currentTimeMillis()
        for (i in 0 until items.length()) {
            val row = items.optJSONObject(i) ?: continue
            val id = row.optString("id").lowercase()
            if (id.isBlank()) continue
            val until = row.optString("muted_until")
            val muted = until.isNotBlank() && until != "null" && runCatching {
                Instant.parse(until).toEpochMilli() > now
            }.getOrDefault(false)
            if (muted) next.add(id) else next.remove(id)
        }
        prefs(ctx).edit().putStringSet(KEY, next).apply()
    }
}
