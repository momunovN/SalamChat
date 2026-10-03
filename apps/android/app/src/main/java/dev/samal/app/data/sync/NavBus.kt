package dev.samal.app.data.sync

import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

object NavBus {
    var openChatId: String? = null
    var resumed: Boolean = false
    val pendingChat = MutableStateFlow<String?>(null)
    val incoming = MutableStateFlow<String?>(null)
    /** Id of the last call the server reported as ended, missed or declined. */
    val ended = MutableStateFlow<String?>(null)
    val typingUntil = MutableStateFlow<Map<String, Long>>(emptyMap())
    /** Bumped when someone we can see posts or removes a status. */
    val storiesTick = MutableStateFlow(0L)
    /** Calls this device answered, declined or left: never offered again. */
    val left: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** Someone else's call we can pick up: ringing, or a group call that is already going. */
    fun joinable(call: JSONObject, me: String): Boolean {
        val status = call.optString("status")
        if (call.optString("initiator_id") == me || call.optString("id") in left) return false
        return status == "ringing" || (status == "active" && call.optBoolean("group"))
    }
}
