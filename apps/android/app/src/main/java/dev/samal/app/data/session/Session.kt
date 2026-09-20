package dev.samal.app.data.session

import org.json.JSONObject

data class User(
    val id: String,
    val phone: String,
    val displayName: String,
    val username: String? = null,
    val avatarUrl: String? = null,
    val bio: String = "",
)

data class Session(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: String,
    val user: User,
    val deviceId: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("access_token", accessToken)
        .put("refresh_token", refreshToken)
        .put("expires_at", expiresAt)
        .put("device_id", deviceId)
        .put(
            "user",
            JSONObject()
                .put("id", user.id)
                .put("phone", user.phone)
                .put("display_name", user.displayName)
                .put("username", user.username)
                .put("avatar_url", user.avatarUrl)
                .put("bio", user.bio),
        )

    companion object {
        fun from(o: JSONObject): Session {
            val u = o.getJSONObject("user")
            return Session(
                accessToken = o.getString("access_token"),
                refreshToken = o.getString("refresh_token"),
                expiresAt = o.optString("expires_at"),
                deviceId = o.getString("device_id"),
                user = User(
                    id = u.getString("id"),
                    phone = u.getString("phone"),
                    displayName = u.optString("display_name"),
                    username = u.optionalString("username"),
                    avatarUrl = u.optionalString("avatar_url"),
                    bio = u.optString("bio"),
                ),
            )
        }
    }
}

private fun JSONObject.optionalString(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() }
}
