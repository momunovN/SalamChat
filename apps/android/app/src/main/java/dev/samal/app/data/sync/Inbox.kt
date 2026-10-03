package dev.samal.app.data.sync

import android.content.Context
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.SamalDao
import dev.samal.app.data.notify.Mutes
import dev.samal.app.data.notify.Notifier
import dev.samal.app.data.session.SessionStore
import dev.samal.app.ui.previewLabel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit

class Inbox(
    private val app: Context,
    private val api: SamalApi,
    private val dao: SamalDao,
    private val session: SessionStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val stream = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        // The server sends a pong every 20s; a silent minute means the stream is dead.
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private val seen = ArrayDeque<String>()
    private val seenSet = HashSet<String>()

    fun start() {
        scope.launch {
            while (isActive) {
                val me = session.user?.id
                if (me != null) runCatching { flush(me) }
                delay(1_000)
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
                    job = launch {
                        runCatching { pull(me) }
                        listen(current, me)
                    }
                }
                delay(1_000)
            }
        }
    }

    fun stop() {
        scope.cancel()
    }

    private suspend fun pull(me: String) {
        val items = api.chats()
        Mutes.applyList(app, items)
        val chats = (0 until items.length()).map { chatEntity(items.getJSONObject(it)) }
        if (chats.isEmpty()) dao.deleteAllChats()
        else {
            dao.deleteMissing(chats.map { it.id })
            dao.upsertChats(chats)
            catchUp(me, chats)
        }
    }

    private suspend fun catchUp(me: String, chats: List<dev.samal.app.data.db.ChatEntity>) {
        for (chat in chats) {
            var at = dao.latestServerAt(chat.id) ?: continue
            if (chat.lastAt <= at + 500) continue
            // The server returns the oldest messages after `at`; page forward until the gap is
            // closed so a long offline stretch does not leave a hole in the middle of the history.
            for (step in 0 until 20) {
                val page = runCatching { api.messagesAfter(chat.id, Instant.ofEpochMilli(at).toString()) }.getOrNull() ?: break
                val arr = page.optJSONArray("items") ?: break
                if (arr.length() == 0) break
                val msgs = (0 until arr.length()).map { messageEntity(arr.getJSONObject(it), me) }
                dao.upsertMessages(msgs)
                msgs.forEach { if (it.clientId.isNotBlank()) dao.dropClientCopy(it.clientId, it.id) }
                val newest = msgs.maxOf { it.createdAt }
                if (!page.optBoolean("more") || newest <= at) break
                at = newest
            }
        }
    }

    private suspend fun flush(me: String) {
        val now = System.currentTimeMillis()
        for (row in dao.pendingOutbox(now)) {
            val sent = runCatching { deliver(row.chatId, row.clientId, row.type, JSONObject(row.payloadJson)) }.getOrNull()
            if (sent == null) {
                val attempts = row.attempts + 1
                val wait = (1_000L shl attempts.coerceAtMost(5)).coerceAtMost(30_000L)
                dao.bumpOutbox(row.clientId, now + wait)
                if (attempts >= 3) dao.setStatus(row.clientId, "failed")
                continue
            }
            val msg = messageEntity(sent, me)
            dao.upsertMessages(listOf(msg))
            if (msg.clientId.isNotBlank()) dao.dropClientCopy(msg.clientId, msg.id)
            dao.deleteOutbox(row.clientId)
            dao.noteMessage(msg.chatId, previewText(msg.type, msg.text, msg.deleted), msg.createdAt, 0)
        }
    }

    private fun deliver(chatId: String, clientId: String, type: String, payload: JSONObject): JSONObject {
        val local = payload.optString("_local")
        var uploadId: String? = null
        if (local.isNotBlank()) {
            val file = File(local)
            val bytes = file.readBytes()
            uploadId = api.upload(
                bytes,
                payload.optString("_mime").ifBlank { "application/octet-stream" },
                payload.optString("_kind").ifBlank { type },
            )
        }
        val reply = payload.optString("_reply").ifBlank { null }
        payload.remove("_local")
        payload.remove("_mime")
        payload.remove("_kind")
        payload.remove("_reply")
        val sent = api.send(chatId, clientId, type, payload, listOfNotNull(uploadId), reply)
        if (local.isNotBlank()) File(local).delete()
        return sent
    }

    /**
     * Server events over SSE (GET /v1/stream), the same stream the website uses. The host runs
     * the plain Next.js server, which has no WebSocket endpoint: /v1/ws answered 502, so the
     * phone never heard about incoming calls or new messages while the app stayed open.
     */
    private suspend fun listen(token: String, me: String) {
        if (api.token != token) return
        var fails = 0
        while (currentCoroutineContext().isActive && session.user?.id == me) {
            val opened = runCatching { readStream(me) }.getOrDefault(false)
            fails = if (opened) 0 else fails + 1
            delay((1_000L shl fails.coerceAtMost(5)).coerceAtMost(30_000L))
        }
    }

    /** Reads one stream until it ends. True when it was open (so the next retry is quick). */
    private suspend fun readStream(me: String): Boolean = withContext(Dispatchers.IO) {
        val call = stream.newCall(api.streamRequest())
        val cancel = coroutineContext[Job]?.invokeOnCompletion { call.cancel() }
        try {
            call.execute().use { resp ->
                if (resp.code == 401) {
                    runCatching { api.refresh() }
                    return@withContext false
                }
                if (!resp.isSuccessful) return@withContext false
                // (Re)connected: fetch whatever arrived while there was no stream, including a
                // call that started ringing before we were listening.
                scope.launch { runCatching { pull(me) } }
                scope.launch { runCatching { ringingCatchUp(me) } }
                val source = resp.body?.source() ?: return@withContext false
                val data = StringBuilder()
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    when {
                        line.startsWith("data:") -> data.append(line.removePrefix("data:").trimStart())
                        line.isEmpty() && data.isNotEmpty() -> {
                            val text = data.toString()
                            data.setLength(0)
                            scope.launch { runCatching { apply(text, me) } }
                        }
                    }
                }
                true
            }
        } finally {
            cancel?.dispose()
        }
    }

    private suspend fun ringingCatchUp(me: String) {
        val calls = api.calls()
        for (i in 0 until calls.length()) {
            val call = calls.optJSONObject(i) ?: continue
            if (!NavBus.joinable(call, me)) continue
            if (NavBus.incoming.value == null) NavBus.incoming.value = call.toString()
            if (!NavBus.resumed && call.optString("status") == "ringing") {
                val title = dao.chat(call.optString("chat_id"))?.title.orEmpty()
                Notifier.incomingCall(app, call, title)
            }
            return
        }
    }

    private suspend fun applyAck(body: JSONObject) {
        val serverId = body.optString("id")
        val clientId = body.optString("client_id")
        if (serverId.isBlank() || clientId.isBlank()) return
        if (dao.countId(serverId) > 0) {
            dao.dropClientCopy(clientId, serverId)
            dao.markSentIfPending(serverId)
        } else {
            dao.rekey(clientId, serverId)
        }
        dao.deleteOutbox(clientId)
    }

    private fun fresh(id: String): Boolean {
        if (id.isBlank() || !seenSet.add(id)) return false
        seen.addLast(id)
        while (seen.size > 400) seenSet.remove(seen.removeFirst())
        return true
    }

    private suspend fun apply(raw: String, me: String) {
        val env = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (env.optString("type")) {
            "message.new", "message.created" -> onMessage(env.optJSONObject("body") ?: return, me)
            "message.ack" -> applyAck(env.optJSONObject("body") ?: return)
            "message.updated" -> {
                val body = env.optJSONObject("body") ?: return
                dao.upsertMessages(listOf(messageEntity(body, me)))
            }
            "message.deleted" -> {
                val body = env.optJSONObject("body") ?: return
                dao.deleteLocal(body.optString("id"))
            }
            "receipt", "receipt.upserted" -> {
                val body = env.optJSONObject("body") ?: return
                val id = body.optString("message_id")
                val status = body.optString("status")
                if (id.isNotBlank() && status.isNotBlank()) dao.setStatus(id, status)
            }
            "story.updated" -> NavBus.storiesTick.value = System.currentTimeMillis()
            "call.updated" -> {
                val body = env.optJSONObject("body") ?: return
                if (body.optString("status") == "active" && NavBus.joinable(body, me)) {
                    // Someone answered a group call: the ring stops, the offer to join stays.
                    Notifier.cancelCall(app, body.optString("id"))
                    val current = NavBus.incoming.value
                    if (current == null || JSONObject(current).optString("id") == body.optString("id")) {
                        NavBus.incoming.value = body.toString()
                    }
                } else if (body.optString("initiator_id") != me && body.optString("status") == "ringing") {
                    NavBus.incoming.value = body.toString()
                    if (!NavBus.resumed) {
                        val title = dao.chat(body.optString("chat_id"))?.title.orEmpty()
                        Notifier.incomingCall(app, body, title)
                    }
                } else if (body.optString("status") != "ringing") {
                    Notifier.cancelCall(app, body.optString("id"))
                    if (body.optString("status") in setOf("ended", "missed", "declined")) {
                        NavBus.ended.value = body.optString("id")
                    }
                    val current = NavBus.incoming.value
                    if (current != null && JSONObject(current).optString("id") == body.optString("id")) {
                        NavBus.incoming.value = null
                    }
                }
            }
            "presence" -> {
                val body = env.optJSONObject("body") ?: return
                val userId = body.optString("user_id")
                if (userId.isNotBlank()) dao.setPeerOnline(userId, body.optBoolean("online"))
            }
            "typing" -> {
                val body = env.optJSONObject("body") ?: return
                if (body.optString("user_id") == me) return
                val chatId = body.optString("chat_id")
                if (chatId.isBlank()) return
                NavBus.typingUntil.value = NavBus.typingUntil.value + (chatId to System.currentTimeMillis() + 3_000)
            }
            "chat.updated" -> pull(me)
        }
    }

    private suspend fun onMessage(body: JSONObject, me: String) {
        val msg = messageEntity(body, me)
        dao.upsertMessages(listOf(msg))
        if (msg.clientId.isNotBlank()) dao.dropClientCopy(msg.clientId, msg.id)
        if (!fresh(msg.id)) return
        val looking = NavBus.resumed && NavBus.openChatId == msg.chatId
        val updated = dao.noteMessage(
            msg.chatId,
            previewText(msg.type, msg.text, msg.deleted),
            msg.createdAt,
            if (msg.outgoing || looking) 0 else 1,
        )
        if (updated == 0) pull(me)
        if (msg.outgoing) return
        val status = if (looking) "read" else "delivered"
        runCatching { api.receipts(listOf(msg.id), status) }
        if (Mutes.has(app, msg.chatId)) return
        if (looking) {
            Notifier.chime(app)
        } else {
            val chat = dao.chat(msg.chatId)
            Notifier.message(app, msg.chatId, chat?.title ?: "Salam", previewLabel(app, previewText(msg.type, msg.text, msg.deleted)))
        }
    }
}
