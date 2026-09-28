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

class SamalApi(
    var base: String = defaultBase(),
    var token: String? = null,
) {
    private val json = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    fun requestOtp(phone: String): String? {
        val body = post("/v1/auth/otp/request", JSONObject().put("phone", phone), false)
        return body.optString("dev_code").takeIf { it.isNotBlank() }
    }

    fun verifyOtp(phone: String, code: String, deviceName: String = "Android"): Session {
        val payload = JSONObject()
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

    fun chats(q: String = "", type: String = ""): JSONArray {
        var path = "/v1/chats?"
        if (q.isNotEmpty()) path += "q=$q&"
        if (type.isNotEmpty()) path += "type=$type&"
        return get(path).optJSONArray("items") ?: JSONArray()
    }

    fun messages(chatId: String, q: String = ""): JSONArray {
        var path = "/v1/chats/$chatId/messages?limit=50"
        if (q.isNotEmpty()) path += "&q=$q"
        return get(path).optJSONArray("items") ?: JSONArray()
    }

    fun send(chatId: String, clientId: String, type: String, payload: JSONObject): JSONObject {
        val body = JSONObject()
            .put("client_id", clientId)
            .put("type", type)
            .put("payload", payload)
        return post("/v1/chats/$chatId/messages", body, true)
    }

    fun patchMe(displayName: String, username: String?, bio: String? = null): JSONObject {
        val body = JSONObject().put("display_name", displayName)
        if (!username.isNullOrBlank()) body.put("username", username)
        if (bio != null) body.put("bio", bio)
        return patch("/v1/me", body)
    }

    fun syncContacts(enabled: Boolean, items: List<dev.samal.app.data.contacts.BookContact>): JSONObject {
        val arr = JSONArray()
        for (it in items) {
            arr.put(JSONObject().put("phone", it.phone).put("name", it.name))
        }
        return post("/v1/contacts/sync", JSONObject().put("enabled", enabled).put("items", arr), true)
    }

    fun contacts(): JSONArray = get("/v1/contacts").optJSONArray("items") ?: JSONArray()

    fun users(q: String): JSONArray {
        val enc = URLEncoder.encode(q, Charsets.UTF_8.name())
        return get("/v1/users?q=$enc").optJSONArray("items") ?: JSONArray()
    }

    fun direct(userId: String): JSONObject =
        post("/v1/chats/direct", JSONObject().put("user_id", userId), true)

    fun streamRequest(): Request {
        val enc = URLEncoder.encode(token.orEmpty(), Charsets.UTF_8.name())
        return Request.Builder()
            .url("$base/v1/stream?token=$enc")
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .build()
    }

    private fun get(path: String): JSONObject = exec(Request.Builder().url(base + path).get())

    private fun patch(path: String, body: JSONObject): JSONObject {
        val b = Request.Builder()
            .url(base + path)
            .patch(body.toString().toRequestBody(json))
        return exec(b, true)
    }

    private fun post(path: String, body: JSONObject, authed: Boolean): JSONObject {
        val b = Request.Builder()
            .url(base + path)
            .post(body.toString().toRequestBody(json))
        return exec(b, authed)
    }

    private fun exec(builder: Request.Builder, authed: Boolean = true): JSONObject {
        if (authed) token?.let { builder.header("Authorization", "Bearer $it") }
        builder.header("Accept", "application/json")
        http.newCall(builder.build()).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
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

    companion object {
        fun defaultBase(): String {
            val emulator = Build.FINGERPRINT.startsWith("generic")
                || Build.FINGERPRINT.contains("emulator", ignoreCase = true)
                || Build.MODEL.contains("Emulator")
                || Build.MODEL.contains("Android SDK")
                || Build.HARDWARE.contains("ranchu")
                || Build.HARDWARE.contains("goldfish")
                || Build.PRODUCT.contains("sdk")
            // Physical USB device: adb reverse tcp:8080 tcp:8080
            return if (emulator) "http://10.0.2.2:3000" else "https://salam-chat.ru"
        }
    }
}
