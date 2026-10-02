package dev.samal.app.data.sync

import android.content.Context
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.SamalDao
import dev.samal.app.data.notify.Mutes
import dev.samal.app.data.notify.Notifier
import dev.samal.app.data.session.SessionStore
import dev.samal.app.ui.previewLabel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
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
        .readTimeout(0, TimeUnit.MILLISECONDS)
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

    private suspend fun listen(token: String, me: String) {
        if (api.token != token) return
        while (kotlinx.coroutines.currentCoroutineContext().isActive && session.user?.id == me) {
            val closed = CompletableDeferred<Unit>()
            val socket = stream.newWebSocket(api.wsRequest(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    scope.launch { runCatching { pull(me) } }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    scope.launch { runCatching { apply(text, me) } }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (!closed.isCompleted) closed.complete(Unit)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (response?.code == 401) runCatching { api.refresh() }
                    if (!closed.isCompleted) closed.complete(Unit)
                }
            })
            val ping = scope.launch {
                while (isActive) {
                    delay(20_000)
                    socket.send("""{"type":"ping"}""")
                }
            }
            closed.await()
            ping.cancel()
            socket.cancel()
            delay(1_500)
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
            "call.updated" -> {
                val body = env.optJSONObject("body") ?: return
                if (body.optString("initiator_id") != me && body.optString("status") == "ringing") {
                    NavBus.incoming.value = body.toString()
                } else if (body.optString("status") != "ringing") {
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
