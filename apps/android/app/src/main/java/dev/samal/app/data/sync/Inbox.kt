package dev.samal.app.data.sync

import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.SamalDao
import dev.samal.app.data.session.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class Inbox(
    private val api: SamalApi,
    private val dao: SamalDao,
    private val session: SessionStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val stream = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    fun start() {
        scope.launch {
            while (isActive) {
                val me = session.user?.id
                if (me != null) {
                    runCatching { pull(me) }
                    runCatching { flush(me) }
                }
                delay(3_000)
            }
        }
        scope.launch {
            var job: Job? = null
            var forUser: String? = null
            while (isActive) {
                val me = session.user?.id
                val token = api.token
                if (me == null || token.isNullOrBlank()) {
                    job?.cancel()
                    job = null
                    forUser = null
                } else if (forUser != me || job?.isActive != true) {
                    job?.cancel()
                    forUser = me
                    val current = token
                    job = launch { listen(current, me) }
                }
                delay(1_000)
            }
        }
    }

    private suspend fun pull(me: String) {
        val items = api.chats()
        val chats = (0 until items.length()).map { chatEntity(items.getJSONObject(it)) }
        if (chats.isNotEmpty()) dao.upsertChats(chats)
    }

    private suspend fun flush(me: String) {
        val now = System.currentTimeMillis()
        for (row in dao.pendingOutbox(now)) {
            val sent = runCatching {
                api.send(row.chatId, row.clientId, row.type, JSONObject(row.payloadJson))
            }.getOrNull() ?: continue
            val msg = messageEntity(sent, me)
            dao.upsertMessages(listOf(msg))
            if (msg.clientId.isNotBlank()) dao.dropClientCopy(msg.clientId, msg.id)
            dao.deleteOutbox(row.clientId)
            dao.noteMessage(msg.chatId, msg.text, msg.createdAt, 0)
        }
    }

    private suspend fun listen(token: String, me: String) {
        if (api.token != token) return
        while (kotlinx.coroutines.currentCoroutineContext().isActive && session.user?.id == me) {
            val call = stream.newCall(api.streamRequest())
            try {
                call.execute().use { resp ->
                    val source = resp.body?.source() ?: return@use
                    while (!source.exhausted()) {
                        val line = source.readUtf8Line() ?: break
                        if (!line.startsWith("data:")) continue
                        apply(line.removePrefix("data:").trim(), me)
                    }
                }
            } catch (_: Exception) {
                call.cancel()
            }
            delay(1_500)
        }
    }

    private suspend fun apply(raw: String, me: String) {
        val env = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (env.optString("type") != "message.created") return
        val body = env.optJSONObject("body") ?: return
        val msg = messageEntity(body, me)
        dao.upsertMessages(listOf(msg))
        if (msg.clientId.isNotBlank()) dao.dropClientCopy(msg.clientId, msg.id)
        val updated = dao.noteMessage(msg.chatId, msg.text, msg.createdAt, if (msg.outgoing) 0 else 1)
        if (updated == 0) pull(me)
    }
}
