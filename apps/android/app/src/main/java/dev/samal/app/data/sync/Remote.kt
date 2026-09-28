package dev.samal.app.data.sync

import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.db.MessageEntity
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

fun messageEntity(o: JSONObject, me: String): MessageEntity {
    val author = o.optString("author_id").ifBlank { null }
    return MessageEntity(
        id = o.getString("id"),
        chatId = o.getString("chat_id"),
        authorId = author,
        type = o.optString("type", "text"),
        text = messageText(o.optJSONObject("payload")),
        clientId = o.optString("client_id"),
        createdAt = parseIso(o.optString("created_at")),
        status = o.optString("status").ifBlank { "sent" },
        outgoing = author == me,
    )
}

fun chatEntity(o: JSONObject): ChatEntity {
    val peer = o.optJSONObject("peer")
    val nick = peer?.optString("username").orEmpty()
    val title = o.optString("title").ifBlank { peer?.optString("display_name").orEmpty() }
        .ifBlank { if (nick.isBlank()) "" else "@$nick" }
    val last = o.optJSONObject("last_message")
    val text = messageText(last?.optJSONObject("payload"))
    val at = parseIso(last?.optString("created_at").orEmpty().ifBlank { o.optString("updated_at") })
    return ChatEntity(
        id = o.getString("id"),
        type = o.optString("type", "direct"),
        title = title,
        lastText = text,
        lastAt = at,
        unread = o.optInt("unread_count"),
    )
}
