package dev.samal.app.data.sync

import kotlinx.coroutines.flow.MutableStateFlow

object NavBus {
    var openChatId: String? = null
    var resumed: Boolean = false
    val pendingChat = MutableStateFlow<String?>(null)
    val incoming = MutableStateFlow<String?>(null)
    /** Id of the last call the server reported as ended, missed or declined. */
    val ended = MutableStateFlow<String?>(null)
    val typingUntil = MutableStateFlow<Map<String, Long>>(emptyMap())
}
