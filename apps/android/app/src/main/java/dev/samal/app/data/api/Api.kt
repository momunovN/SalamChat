package dev.samal.app.data.api

import android.os.Build
import dev.samal.app.data.session.Session
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class SamalApi(
    var base: String = defaultBase(),
    var token: String? = null,
    var refreshToken: String? = null,
    var onSession: ((Session) -> Unit)? = null,
) {
    private val json = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val uploadHttp = http.newBuilder()
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .build()
    private val refreshing = AtomicBoolean(false)

    fun requestOtp(email: String, phone: String): String? {
        val body = post(
            "/v1/auth/otp/request",
            JSONObject().put("email", email).put("phone", phone),
            false,
        )
        return body.optString("dev_code").takeIf { it.isNotBlank() }
    }

    fun verifyOtp(email: String, phone: String, code: String, deviceName: String = "Android"): Session {
        val payload = JSONObject()
            .put("email", email)
            .put("phone", phone)
            .put("code", code)
            .put(
                "device",
                JSONObject()
                    .put("platform", "android")
                    .put("device_name", deviceName),
            )
        return Session.from(post("/v1/auth/otp/verify", payload, false))
    }

    /**
     * Several threads can get 401 at once. They queue on the lock; whoever comes second sees the
     * access token already replaced and just retries with it, instead of failing the request or
     * spending the rotated refresh token a second time.
     */
    @Synchronized
    fun refresh(used: String? = token): Boolean {
        val now = token
        if (now != null && now != used) return true
        val current = refreshToken ?: return false
        if (!refreshing.compareAndSet(false, true)) return false
        return try {
            val body = post("/v1/auth/refresh", JSONObject().put("refresh_token", current), false)
            val sess = Session.from(body)
            token = sess.accessToken
            refreshToken = sess.refreshToken
            onSession?.invoke(sess)
            true
        } catch (_: Exception) {
            false
        } finally {
            refreshing.set(false)
        }
    }

    fun chats(q: String = "", type: String = ""): JSONArray {
        var path = "/v1/chats?"
        if (q.isNotEmpty()) path += "q=${enc(q)}&"
        if (type.isNotEmpty()) path += "type=$type&"
        return get(path).optJSONArray("items") ?: JSONArray()
    }

    fun messagePage(chatId: String, cursor: String = ""): JSONObject {
        var path = "/v1/chats/$chatId/messages?limit=50"
        if (cursor.isNotEmpty()) path += "&cursor=${enc(cursor)}"
        return get(path)
    }

    fun messagesAfter(chatId: String, after: String): JSONObject {
        return get("/v1/chats/$chatId/messages?limit=50&after=${enc(after)}")
    }

    fun messages(chatId: String, q: String = ""): JSONArray {
        var path = "/v1/chats/$chatId/messages?limit=50"
        if (q.isNotEmpty()) path += "&q=${enc(q)}"
        return get(path).optJSONArray("items") ?: JSONArray()
    }

    fun send(
        chatId: String,
        clientId: String,
        type: String,
        payload: JSONObject,
        uploadIds: List<String> = emptyList(),
        replyTo: String? = null,
    ): JSONObject {
        val body = JSONObject()
            .put("client_id", clientId)
            .put("type", type)
            .put("payload", payload)
        if (!replyTo.isNullOrBlank()) body.put("reply_to_id", replyTo)
        if (uploadIds.isNotEmpty()) {
            val arr = JSONArray()
            uploadIds.forEach { arr.put(it) }
            body.put("upload_ids", arr)
        }
        return post("/v1/chats/$chatId/messages", body, true)
    }

    fun editMessage(id: String, text: String): JSONObject =
        patch("/v1/messages/$id", JSONObject().put("text", text))

    fun deleteMessage(id: String): JSONObject = delete("/v1/messages/$id")

    /** This device's FCM token, so the server can wake it for messages and calls. */
    fun registerPush(token: String): JSONObject = post("/v1/devices/push", JSONObject().put("token", token), true)

    fun receipts(ids: List<String>, status: String): JSONObject {
        val arr = JSONArray()
        ids.forEach { arr.put(it) }
        return post("/v1/receipts", JSONObject().put("message_ids", arr).put("status", status), true)
    }

    fun hideChat(id: String): JSONObject = delete("/v1/chats/$id")

    fun chat(id: String): JSONObject = get("/v1/chats/$id")

    fun renameChat(id: String, title: String, username: String? = null): JSONObject {
        val body = JSONObject().put("title", title)
        if (username != null) body.put("username", username)
        return patch("/v1/chats/$id", body)
    }

    fun group(title: String, memberIds: List<String>, username: String? = null): JSONObject {
        val arr = JSONArray()
        memberIds.forEach { arr.put(it) }
        val body = JSONObject().put("title", title).put("member_ids", arr)
        if (!username.isNullOrBlank()) body.put("username", username)
        return post("/v1/chats/groups", body, true)
    }

    fun members(chatId: String): JSONArray =
        get("/v1/chats/$chatId/members").optJSONArray("items") ?: JSONArray()

    fun addMembers(chatId: String, userIds: List<String>): JSONObject {
        val arr = JSONArray()
        userIds.forEach { arr.put(it) }
        return post("/v1/chats/$chatId/members", JSONObject().put("user_ids", arr), true)
    }

    fun removeMember(chatId: String, userId: String): JSONObject =
        delete("/v1/chats/$chatId/members/$userId")

    fun calls(): JSONArray = get("/v1/calls").optJSONArray("items") ?: JSONArray()

    fun startCall(chatId: String, kind: String): JSONObject =
        post("/v1/chats/$chatId/calls", JSONObject().put("kind", kind), true)

    fun answerCall(id: String): JSONObject = post("/v1/calls/$id/answer", JSONObject(), true)

    fun rejectCall(id: String): JSONObject = post("/v1/calls/$id/reject", JSONObject(), true)

    fun hangupCall(id: String): JSONObject = post("/v1/calls/$id/hangup", JSONObject(), true)

    fun callToken(id: String): JSONObject = get("/v1/calls/$id/token")

    fun call(id: String): JSONObject = get("/v1/calls/$id")

    fun typing(chatId: String): JSONObject =
        post("/v1/typing", JSONObject().put("chat_id", chatId), true)

    fun upload(bytes: ByteArray, mime: String, kind: String): String {
        val intent = post(
            "/v1/uploads/intent",
            JSONObject().put("mime", mime).put("kind", kind).put("size_bytes", bytes.size),
            true,
        )
        val id = intent.getString("id")
        val putUrl = intent.getString("put_url")
        val media = mime.ifBlank { "application/octet-stream" }.toMediaType()
        exec({
            Request.Builder().url(putUrl).put(bytes.toRequestBody(media))
        }, authed = true, client = uploadHttp)
        post("/v1/uploads/$id/complete", JSONObject(), true)
        return id
    }

    fun patchMe(
        displayName: String,
        username: String?,
        bio: String? = null,
        birthDate: String? = null,
        address: String? = null,
        usernameHidden: Boolean? = null,
    ): JSONObject {
        val body = JSONObject().put("display_name", displayName)
        if (username != null) body.put("username", username)
        if (bio != null) body.put("bio", bio)
        if (birthDate != null) body.put("birth_date", birthDate)
        if (address != null) body.put("address", address)
        if (usernameHidden != null) body.put("username_hidden", usernameHidden)
        return patch("/v1/me", body)
    }

    fun library(id: String): JSONObject = get("/v1/users/$id/library")

    fun setNotifications(id: String, enabled: Boolean): JSONObject =
        patch("/v1/users/$id/notifications", JSONObject().put("enabled", enabled))

    fun syncContacts(enabled: Boolean, items: List<dev.samal.app.data.contacts.BookContact>): JSONObject {
        val arr = JSONArray()
        for (it in items) {
            arr.put(JSONObject().put("phone", it.phone).put("name", it.name))
        }
        return post("/v1/contacts/sync", JSONObject().put("enabled", enabled).put("items", arr), true)
    }

    fun contacts(): JSONArray = get("/v1/contacts").optJSONArray("items") ?: JSONArray()

    fun users(q: String): JSONArray =
        get("/v1/users?q=${enc(q)}").optJSONArray("items") ?: JSONArray()

    fun user(id: String): JSONObject = get("/v1/users/$id")

    fun direct(userId: String): JSONObject =
        post("/v1/chats/direct", JSONObject().put("user_id", userId), true)

    fun wsRequest(): Request {
        val tokenEnc = enc(token.orEmpty())
        val root = base.trimEnd('/').replace("https://", "wss://").replace("http://", "ws://")
        return Request.Builder()
            .url("$root/v1/ws?token=$tokenEnc")
            .build()
    }

    private fun get(path: String): JSONObject = exec({ Request.Builder().url(base + path).get() })

    private fun patch(path: String, body: JSONObject): JSONObject =
        exec({ Request.Builder().url(base + path).patch(body.toString().toRequestBody(json)) })

    private fun delete(path: String): JSONObject =
        exec({ Request.Builder().url(base + path).delete() })

    private fun post(path: String, body: JSONObject, authed: Boolean): JSONObject =
        exec({ Request.Builder().url(base + path).post(body.toString().toRequestBody(json)) }, authed)

    private fun exec(
        make: () -> Request.Builder,
        authed: Boolean = true,
        retry: Boolean = true,
        client: OkHttpClient = http,
    ): JSONObject {
        val builder = make()
        val used = if (authed) token else null
        if (authed) used?.let { builder.header("Authorization", "Bearer $it") }
        builder.header("Accept", "application/json")
        client.newCall(builder.build()).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (resp.code == 401 && authed && retry && refresh(used)) {
                return exec(make, authed, retry = false, client = client)
            }
            if (!resp.isSuccessful) error(apiError(resp.code, text))
            return if (text.isEmpty()) JSONObject() else JSONObject(text)
        }
    }

    private fun apiError(code: Int, text: String): String {
        val msg = runCatching {
            JSONObject(text).getJSONObject("error").optString("message")
        }.getOrNull()?.takeIf { it.isNotBlank() }
        return msg ?: "http $code"
    }

    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    companion object {
        fun defaultBase(): String {
            val emulator = Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.contains("emulator", ignoreCase = true)
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("Android SDK")
                || Build.HARDWARE.contains("ranchu")
                || Build.HARDWARE.contains("goldfish")
                || Build.PRODUCT.contains("sdk")
            return if (emulator) "http://10.0.2.2:3000" else "https://salam-chat.ru"
        }
    }
}
