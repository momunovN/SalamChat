package dev.samal.app.data.sync

import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.db.MessageEntity
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

fun parseIso(raw: String): Long {
    if (raw.isBlank()) return System.currentTimeMillis()
    return runCatching { Instant.parse(raw).toEpochMilli() }.getOrDefault(System.currentTimeMillis())
}

fun messageText(payload: JSONObject?): String {
    if (payload == null) return ""
    return payload.optString("text").ifBlank { payload.optString("caption") }
}

fun previewText(type: String, text: String, deleted: Boolean): String {
    if (deleted) return "\u001Fdeleted"
    if (text.isNotBlank()) return text
    return "\u001F$type"
}

fun messageEntity(o: JSONObject, me: String): MessageEntity {
    val author = o.optString("author_id").ifBlank { null }
    val payload = o.optJSONObject("payload")
    val deleted = o.optString("deleted_at").isNotBlank()
    val attachment = o.optJSONArray("attachments")?.optJSONObject(0)
    val wave = payload?.optJSONArray("waveform")
    val duration = attachment?.optInt("duration_ms")?.takeIf { it > 0 }
        ?: payload?.optInt("duration_ms")
        ?: 0
    val reply = o.optJSONObject("reply_to")?.optString("text").orEmpty()
    return MessageEntity(
        id = o.getString("id"),
        chatId = o.getString("chat_id"),
        authorId = author,
        type = o.optString("type", "text"),
        text = if (deleted) "" else messageText(payload),
        clientId = o.optString("client_id"),
        createdAt = parseIso(o.optString("created_at")),
        status = o.optString("status").ifBlank { "sent" },
        outgoing = author == me,
        replyText = reply,
        edited = o.optString("edited_at").isNotBlank(),
        deleted = deleted,
        mediaUrl = attachment?.optString("url").orEmpty(),
        durationMs = duration,
        waveform = waveString(wave),
    )
}

fun chatEntity(o: JSONObject): ChatEntity {
    val peer = o.optJSONObject("peer")
    val nick = peer?.optString("username").orEmpty()
    val title = o.optString("title").ifBlank { peer?.optString("display_name").orEmpty() }
        .ifBlank { if (nick.isBlank()) "" else "@$nick" }
    val last = o.optJSONObject("last_message")
    val deleted = last?.optString("deleted_at").orEmpty().isNotBlank()
    val type = last?.optString("type").orEmpty().ifBlank { "text" }
    val text = previewText(type, messageText(last?.optJSONObject("payload")), deleted)
    val at = parseIso(last?.optString("created_at").orEmpty().ifBlank { o.optString("updated_at") })
    return ChatEntity(
        id = o.getString("id"),
        type = o.optString("type", "direct"),
        title = title,
        lastText = text,
        lastAt = at,
        unread = o.optInt("unread_count"),
        peerOnline = peer?.optBoolean("online") == true,
        peerId = peer?.optString("id").orEmpty(),
    )
}

private fun waveString(arr: JSONArray?): String {
    if (arr == null || arr.length() == 0) return ""
    return (0 until arr.length().coerceAtMost(64)).joinToString(",") { i ->
        arr.optDouble(i, 0.2).coerceIn(0.0, 1.0).toString()
    }
}
