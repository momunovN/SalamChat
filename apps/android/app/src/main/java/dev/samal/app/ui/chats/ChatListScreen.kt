package dev.samal.app.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.R
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.db.SamalDao
import dev.samal.app.data.sync.chatEntity
import dev.samal.app.ui.previewLabel
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Danger
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.SalamLogo
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import dev.samal.app.ui.theme.LetterAvatar
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width

@Composable
fun ChatListScreen(dao: SamalDao, api: SamalApi, me: String, onOpen: (ChatEntity) -> Unit) {
    var q by remember { mutableStateOf("") }
    var seg by remember { mutableStateOf("all") }
    var picking by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf(setOf<String>()) }
    var confirm by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf<ChatEntity?>(null) }
    var renaming by remember { mutableStateOf<ChatEntity?>(null) }
    val type = when (seg) {
        "direct" -> "direct"
        "group" -> "group"
        else -> ""
    }
    // remember: a new Flow on every recomposition re-ran the query on each keystroke.
    val chats by remember(dao, type, q) { dao.chats(type, q) }.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            SalamLogo(36.dp)
            Text(
                if (picking) picked.size.toString() else stringResource(R.string.app_name),
                color = Text,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 10.dp).weight(1f),
            )
            if (picking) {
                Text(stringResource(R.string.delete), color = Danger, modifier = Modifier.clickable { if (picked.isNotEmpty()) confirm = true }.padding(8.dp))
                Text(stringResource(R.string.cancel), color = Muted, modifier = Modifier.clickable { picking = false; picked = emptySet() }.padding(8.dp))
            } else {
                Text(stringResource(R.string.select), color = Muted, modifier = Modifier.clickable { picking = true }.padding(8.dp))
                Icon(Icons.Default.Edit, stringResource(R.string.new_chat), tint = Text, modifier = Modifier.clickable { creating = true }.padding(8.dp))
            }
        }
        TextField(
            value = q,
            onValueChange = { q = it },
            placeholder = { Text(stringResource(R.string.search), color = Muted) },
            modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)),
            colors = fieldColors(),
            singleLine = true,
        )
        Row(Modifier.padding(16.dp, 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf(
                "all" to stringResource(R.string.seg_all),
                "direct" to stringResource(R.string.seg_direct),
                "group" to stringResource(R.string.seg_groups),
            ).forEach { (id, label) ->
                val on = seg == id
                Text(
                    label,
                    color = if (on) Text else Muted,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (on) Accent else Color.Transparent)
                        .clickable { seg = id }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }
        if (chats.isEmpty()) {
            Text(stringResource(R.string.chats_empty), color = Muted, modifier = Modifier.padding(24.dp))
        } else {
            LazyColumn {
                items(chats, key = { it.id }) { chat ->
                    ChatRow(
                        chat,
                        selected = picked.contains(chat.id),
                        onClick = {
                            if (picking) {
                                picked = if (picked.contains(chat.id)) picked - chat.id else picked + chat.id
                            } else onOpen(chat)
                        },
                        onLong = {
                            if (!picking) menu = chat
                        },
                    )
                }
            }
        }
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            confirmButton = {
                Text(stringResource(R.string.delete), color = Danger, modifier = Modifier.clickable {
                    val ids = picked.toList()
                    confirm = false
                    picking = false
                    picked = emptySet()
                    scope.launch {
                        dao.deleteChats(ids)
                        withContext(Dispatchers.IO) { ids.forEach { runCatching { api.hideChat(it) } } }
                    }
                }.padding(8.dp))
            },
            dismissButton = {
                Text(stringResource(R.string.cancel), color = Muted, modifier = Modifier.clickable { confirm = false }.padding(8.dp))
            },
            text = { Text(if (picked.size > 1) stringResource(R.string.confirm_hide_many) else stringResource(R.string.confirm_hide), color = Text) },
            containerColor = Elevated,
        )
    }

    menu?.let { chat ->
        AlertDialog(
            onDismissRequest = { menu = null },
            confirmButton = {},
            title = { Text(chat.title, color = Text) },
            text = {
                Column {
                    Text(stringResource(R.string.delete), color = Danger, modifier = Modifier.fillMaxWidth().clickable {
                        menu = null
                        picked = setOf(chat.id)
                        confirm = true
                    }.padding(vertical = 10.dp))
                    if (chat.type == "group") {
                        Text(stringResource(R.string.rename), color = Text, modifier = Modifier.fillMaxWidth().clickable {
                            renaming = chat
                            menu = null
                        }.padding(vertical = 10.dp))
                    }
                }
            },
            containerColor = Elevated,
        )
    }

    renaming?.let { chat ->
        var title by remember(chat.id) { mutableStateOf(chat.title) }
        var nick by remember(chat.id) { mutableStateOf("") }
        var nickReady by remember(chat.id) { mutableStateOf(false) }
        LaunchedEffect(chat.id) {
            val remote = withContext(Dispatchers.IO) { runCatching { api.chat(chat.id) }.getOrNull() }
            nick = remote?.optString("username").orEmpty()
            nickReady = true
        }
        AlertDialog(
            onDismissRequest = { renaming = null },
            confirmButton = {
                Text(stringResource(R.string.save), color = Accent, modifier = Modifier.clickable {
                    val next = title.trim()
                    if (next.length < 2) return@clickable
                    renaming = null
                    scope.launch {
                        dao.renameLocal(chat.id, next)
                        val clean = nick.trim().removePrefix("@")
                        withContext(Dispatchers.IO) {
                            runCatching { api.renameChat(chat.id, next, if (nickReady) clean else null) }
                        }
                    }
                }.padding(8.dp))
            },
            dismissButton = {
                Text(stringResource(R.string.cancel), color = Muted, modifier = Modifier.clickable { renaming = null }.padding(8.dp))
            },
            text = {
                Column {
                    TextField(value = title, onValueChange = { title = it }, label = { Text(stringResource(R.string.group_title)) }, colors = fieldColors())
                    TextField(value = nick, onValueChange = { nick = it.removePrefix("@") }, label = { Text(stringResource(R.string.group_nick)) }, colors = fieldColors())
                }
            },
            containerColor = Elevated,
        )
    }

    if (creating) NewChatDialog(api, dao, me, onOpen = { creating = false; onOpen(it) }, onClose = { creating = false })
}

@Composable
private fun NewChatDialog(api: SamalApi, dao: SamalDao, me: String, onOpen: (ChatEntity) -> Unit, onClose: () -> Unit) {
    var q by remember { mutableStateOf("") }
    var found by remember { mutableStateOf(listOf<JSONObject>()) }
    var group by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var nick by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf(setOf<String>()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(q) {
        val query = q.trim()
        if (query.isEmpty()) {
            found = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        found = withContext(Dispatchers.IO) {
            runCatching {
                val arr = api.users(query)
                (0 until arr.length()).map { arr.getJSONObject(it) }.filter { it.optString("id") != me }
            }.getOrDefault(emptyList())
        }
    }
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = {
            if (group) {
                Text(stringResource(R.string.create), color = Accent, modifier = Modifier.clickable {
                    val name = title.trim()
                    if (name.length < 2 || picked.isEmpty()) return@clickable
                    scope.launch {
                        val clean = nick.trim().removePrefix("@")
                        val chat = withContext(Dispatchers.IO) {
                            runCatching { chatEntity(api.group(name, picked.toList(), clean.ifBlank { null })) }.getOrNull()
                        } ?: return@launch
                        dao.upsertChats(listOf(chat))
                        onOpen(chat)
                    }
                }.padding(8.dp))
            }
        },
        dismissButton = {
            Text(stringResource(R.string.cancel), color = Muted, modifier = Modifier.clickable(onClick = onClose).padding(8.dp))
        },
        title = { Text(if (group) stringResource(R.string.new_group) else stringResource(R.string.new_chat), color = Text) },
        text = {
            Column {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.new_chat), color = if (!group) Text else Muted, modifier = Modifier.clickable { group = false }.padding(4.dp))
                    Text(stringResource(R.string.new_group), color = if (group) Text else Muted, modifier = Modifier.clickable { group = true }.padding(4.dp))
                }
                if (group) {
                    TextField(value = title, onValueChange = { title = it }, placeholder = { Text(stringResource(R.string.group_title), color = Muted) }, colors = fieldColors())
                    TextField(value = nick, onValueChange = { nick = it.removePrefix("@") }, placeholder = { Text(stringResource(R.string.group_nick), color = Muted) }, colors = fieldColors())
                }
                TextField(value = q, onValueChange = { q = it }, placeholder = { Text(stringResource(R.string.search_people), color = Muted) }, colors = fieldColors())
                found.forEach { user ->
                    val id = user.optString("id")
                    val on = picked.contains(id)
                    Text(
                        user.optString("display_name").ifBlank { user.optString("username") },
                        color = if (on) Accent else Text,
                        modifier = Modifier.fillMaxWidth().clickable {
                            if (group) picked = if (on) picked - id else picked + id
                            else scope.launch {
                                val chat = withContext(Dispatchers.IO) { runCatching { chatEntity(api.direct(id)) }.getOrNull() } ?: return@launch
                                dao.upsertChats(listOf(chat))
                                onOpen(chat)
                            }
                        }.padding(vertical = 8.dp),
                    )
                }
            }
        },
        containerColor = Elevated,
    )
}

@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Elevated,
    unfocusedContainerColor = Elevated,
    focusedTextColor = Text,
    unfocusedTextColor = Text,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
)

@Composable
private fun ChatRow(chat: ChatEntity, selected: Boolean, onClick: () -> Unit, onLong: () -> Unit) {
    val time = remember(chat.lastAt) {
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(chat.lastAt))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 1.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) Accent.copy(alpha = 0.16f) else Color.Transparent)
            .pointerInput(chat.id) { detectTapGestures(onTap = { onClick() }, onLongPress = { onLong() }) }
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LetterAvatar(chat.title, 54.dp)
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    chat.title,
                    color = Text,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(time, color = if (chat.unread > 0) Accent else Muted, fontSize = 12.sp)
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    previewLabel(chat.lastText),
                    color = Muted,
                    fontSize = 14.sp,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (chat.unread > 0) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier.defaultMinSize(minWidth = 22.dp, minHeight = 22.dp).clip(CircleShape).background(Accent)
                            .padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (chat.unread > 99) "99+" else "${chat.unread}", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
