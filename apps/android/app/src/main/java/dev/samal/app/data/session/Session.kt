package dev.samal.app.data.session

import org.json.JSONObject

data class User(
    val id: String,
    val phone: String,
    val email: String? = null,
    val displayName: String,
    val username: String? = null,
    val avatarUrl: String? = null,
    val bio: String = "",
    val birthDate: String? = null,
    val address: String = "",
    val usernameHidden: Boolean = false,
    val publicId: String? = null,
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
                .put("email", user.email)
                .put("display_name", user.displayName)
                .put("username", user.username)
                .put("avatar_url", user.avatarUrl)
                .put("bio", user.bio)
                .put("birth_date", user.birthDate)
                .put("address", user.address)
                .put("username_hidden", user.usernameHidden)
                .put("public_id", user.publicId),
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
                    phone = u.optString("phone"),
                    email = u.optionalString("email"),
                    displayName = u.optString("display_name"),
                    username = u.optionalString("username"),
                    avatarUrl = u.optionalString("avatar_url"),
                    bio = u.optString("bio"),
                    birthDate = u.optionalString("birth_date"),
                    address = u.optString("address"),
                    usernameHidden = u.optBoolean("username_hidden", false),
                    publicId = u.optionalString("public_id"),
                ),
            )
        }
    }
}

private fun JSONObject.optionalString(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() }
}
