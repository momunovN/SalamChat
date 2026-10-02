package dev.samal.app.ui.chat

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.location.LocationManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import dev.samal.app.R
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.sync.chatEntity
import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.db.MessageEntity
import dev.samal.app.data.db.OutboxEntity
import dev.samal.app.data.db.SamalDao
import dev.samal.app.data.sync.NavBus
import dev.samal.app.data.sync.messageEntity
import dev.samal.app.data.sync.previewText
import dev.samal.app.ui.previewLabel
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Danger
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Incoming
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Outgoing
import dev.samal.app.ui.theme.Success
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.roundToInt

/** Messages read from Room per step of the chat window. */
private const val PAGE = 100

@Composable
fun ChatScreen(
    chat: ChatEntity,
    dao: SamalDao,
    api: SamalApi,
    me: String,
    onBack: () -> Unit,
    onCall: (String) -> Unit,
    onOpenChat: (ChatEntity) -> Unit,
) {
    val ctx = LocalContext.current
    // Only the newest window is read; "earlier" grows it. The Flow is remembered: building it
    // inline re-ran the query on every recomposition, e.g. on each typed letter.
    var window by remember(chat.id) { mutableIntStateOf(PAGE) }
    val messages by remember(dao, chat.id, window) { dao.recent(chat.id, window) }.collectAsState(initial = emptyList())
    val liveChats by remember(dao) { dao.chats("", "") }.collectAsState(initial = emptyList())
    val current = liveChats.find { it.id == chat.id } ?: chat
    val typingMap by NavBus.typingUntil.collectAsState()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var text by remember { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var held by remember { mutableStateOf(false) }
    var dragX by remember { mutableStateOf(0f) }
    var dragY by remember { mutableStateOf(0f) }
    var reply by remember { mutableStateOf<MessageEntity?>(null) }
    var editing by remember { mutableStateOf<MessageEntity?>(null) }
    var menu by remember { mutableStateOf<MessageEntity?>(null) }
    var stage by remember { mutableStateOf<MessageEntity?>(null) }
    var attach by remember { mutableStateOf(false) }
    var members by remember { mutableStateOf(false) }
    var profile by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var older by remember(chat.id) { mutableStateOf<String?>(null) }
    var hasOlder by remember(chat.id) { mutableStateOf(true) }
    val voice = remember { VoiceHold(ctx) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var typedAt by remember { mutableLongStateOf(0L) }

    DisposableEffect(chat.id) {
        NavBus.openChatId = chat.id
        onDispose {
            if (NavBus.openChatId == chat.id) NavBus.openChatId = null
            voice.cancel()
        }
    }

    val typingUntil = typingMap[chat.id] ?: 0L
    LaunchedEffect(typingUntil) {
        val wait = typingUntil - System.currentTimeMillis()
        if (wait <= 0L) return@LaunchedEffect
        delay(wait)
        now = System.currentTimeMillis()
    }

    LaunchedEffect(chat.id) {
        val page = withContext(Dispatchers.IO) { runCatching { api.messagePage(chat.id) }.getOrNull() } ?: return@LaunchedEffect
        val arr = page.optJSONArray("items") ?: JSONArray()
        if (arr.length() > 0) {
            dao.upsertMessages((0 until arr.length()).map { messageEntity(arr.getJSONObject(it), me) })
            val incoming = (0 until arr.length()).map { arr.getJSONObject(it) }
                .filter { it.optString("author_id") != me && it.optString("deleted_at").isBlank() }
                .map { it.getString("id") }
            if (incoming.isNotEmpty()) runCatching { api.receipts(incoming, "read") }
        }
        dao.clearUnread(chat.id)
        val cursor = page.optString("cursor")
        older = cursor.ifBlank { null }
        if (cursor.isBlank()) hasOlder = false
    }

    // Follow new messages at the bottom, but stay put when an older page is loaded.
    LaunchedEffect(messages.firstOrNull()?.id) {
        if (messages.isNotEmpty()) listState.scrollToItem(0)
    }

    val photoPick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { enqueueFile(ctx, dao, chat.id, me, uri, reply) ; reply = null }
    }
    val filePick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) scope.launch { enqueueFile(ctx, dao, chat.id, me, uri, reply) ; reply = null }
    }
    val locPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (!ok) return@rememberLauncherForActivityResult
        scope.launch {
            val loc = withContext(Dispatchers.IO) { lastLocation(ctx) } ?: return@launch
            sendPayload(dao, chat.id, me, "location", JSONObject().put("lat", loc.first).put("lon", loc.second), reply)
            reply = null
        }
    }

    val typing = typingUntil > now

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Text) }
            Row(
                Modifier.weight(1f).clickable {
                    if (current.type == "group") members = true
                    else if (current.peerId.isNotBlank()) profile = current.peerId
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
            Box(Modifier.size(36.dp).clip(CircleShape).background(Elevated), contentAlignment = Alignment.Center) {
                Text(current.title.take(1).uppercase(), color = Text)
            }
            Column(Modifier.padding(start = 8.dp).weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Lock, stringResource(R.string.sealed), tint = Muted, modifier = Modifier.size(12.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(current.title, color = Text, maxLines = 1)
                }
                val sub = when {
                    typing -> stringResource(R.string.typing)
                    current.peerOnline -> stringResource(R.string.online)
                    else -> ""
                }
                if (sub.isNotEmpty()) Text(sub, color = if (typing || current.peerOnline) Success else Muted, fontSize = 12.sp)
            }
            }
            IconButton(onClick = { onCall("audio") }) { Icon(Icons.Default.Call, null, tint = Text) }
            IconButton(onClick = { onCall("video") }) { Icon(Icons.Default.Videocam, null, tint = Text) }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            reverseLayout = true,
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            itemsIndexed(messages, key = { _, msg -> msg.id }) { index, msg ->
                val older = messages.getOrNull(index + 1)
                val showDay = older == null || !sameInstantDay(msg.createdAt, older.createdAt)
                val showAuthor = current.type == "group" && !msg.outgoing && msg.authorName.isNotBlank() && older?.authorId != msg.authorId
                Bubble(
                    msg,
                    showDay,
                    showAuthor,
                    onOpen = { stage = msg },
                    onMenu = { menu = msg },
                    onAuthor = { msg.authorId?.let { profile = it } },
                )
            }
            if (hasOlder || messages.size >= window) {
                item {
                    Text(
                        stringResource(R.string.earlier),
                        color = Accent,
                        modifier = Modifier.clickable {
                            window += PAGE
                            val cursor = older ?: return@clickable
                            scope.launch {
                                val page = withContext(Dispatchers.IO) {
                                    runCatching { api.messagePage(chat.id, cursor) }.getOrNull()
                                } ?: return@launch
                                val arr = page.optJSONArray("items") ?: JSONArray()
                                if (arr.length() > 0) {
                                    dao.upsertMessages((0 until arr.length()).map { messageEntity(arr.getJSONObject(it), me) })
                                }
                                val next = page.optString("cursor")
                                older = next.ifBlank { null }
                                if (next.isBlank() || arr.length() == 0) hasOlder = false
                            }
                        }.padding(8.dp),
                    )
                }
            }
        }

        if (recording) {
            Text(
                if (dragY < -56) stringResource(R.string.voice_lock) else stringResource(R.string.voice_cancel),
                color = Muted,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        error?.let {
            Text(
                if (it == "short") stringResource(R.string.voice_short) else stringResource(R.string.voice_fail),
                color = Danger,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        val quote = editing ?: reply
        if (quote != null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(if (editing != null) stringResource(R.string.edit) else stringResource(R.string.reply), color = Accent, fontSize = 12.sp)
                    Text(previewLabel(quote.text.ifBlank { previewText(quote.type, "", quote.deleted) }), color = Muted, maxLines = 1)
                }
                IconButton(onClick = { editing = null; reply = null; if (editing != null) text = "" }) {
                    Icon(Icons.Default.Close, null, tint = Muted)
                }
            }
        }
        if (attach && !recording) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                AttachChip(stringResource(R.string.photo)) {
                    attach = false
                    photoPick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
                AttachChip(stringResource(R.string.video)) {
                    attach = false
                    photoPick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly))
                }
                AttachChip(stringResource(R.string.file)) {
                    attach = false
                    filePick.launch("*/*")
                }
                AttachChip(stringResource(R.string.geo)) {
                    attach = false
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        locPerm.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                    } else locPerm.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                }
            }
        }

        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Bottom) {
            if (recording) {
                IconButton(onClick = {
                    recording = false
                    held = false
                    voice.cancel()
                    dragX = 0f
                    dragY = 0f
                }) {
                    Icon(Icons.Default.Close, null, tint = Text)
                }
            } else {
                IconButton(onClick = { attach = !attach }) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(Elevated), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Add, null, tint = Text)
                    }
                }
            }
            TextField(
                value = text,
                onValueChange = {
                    text = it
                    val t = System.currentTimeMillis()
                    if (t - typedAt > 2_000) {
                        typedAt = t
                        scope.launch(Dispatchers.IO) { runCatching { api.typing(chat.id) } }
                    }
                },
                placeholder = { Text(stringResource(R.string.composer), color = Muted) },
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(20.dp)),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Elevated,
                    unfocusedContainerColor = Elevated,
                    focusedTextColor = Text,
                    unfocusedTextColor = Text,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
            )
            if (text.isBlank() && editing == null && !held) {
                Box(
                    Modifier
                        .padding(start = 8.dp)
                        .size(40.dp)
                        .offset { IntOffset(dragX.roundToInt().coerceAtMost(0), dragY.roundToInt().coerceAtMost(0)) }
                        .clip(CircleShape)
                        .background(if (recording) Danger.copy(alpha = 0.2f) else Elevated)
                        .pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = {
                                    recording = true
                                    voice.start()
                                },
                                onDragEnd = {
                                    val locked = dragY < -56
                                    if (locked) {
                                        held = true
                                        dragX = 0f
                                        dragY = 0f
                                    } else {
                                        finishVoice(voice, dao, chat.id, me, reply, { error = it }, { reply = null })
                                        recording = false
                                        held = false
                                        dragX = 0f
                                        dragY = 0f
                                    }
                                },
                                onDragCancel = {
                                    recording = false
                                    voice.cancel()
                                    dragX = 0f
                                    dragY = 0f
                                },
                            ) { change, amount ->
                                change.consume()
                                dragX += amount.x
                                dragY += amount.y
                                voice.sample()
                                if (dragX < -72 && dragY >= -56) {
                                    recording = false
                                    voice.cancel()
                                    dragX = 0f
                                    dragY = 0f
                                }
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.Mic, null, tint = if (recording) Danger else Text) }
            } else {
                IconButton(onClick = {
                    if (held) {
                        held = false
                        recording = false
                        finishVoice(voice, dao, chat.id, me, reply, { error = it }, { reply = null })
                        return@IconButton
                    }
                    val editingNow = editing
                    val replyNow = reply
                    val body = text.trim()
                    if (body.isEmpty()) return@IconButton
                    text = ""
                    editing = null
                    reply = null
                    scope.launch {
                        if (editingNow != null) {
                            withContext(Dispatchers.IO) {
                                runCatching {
                                    val updated = api.editMessage(editingNow.id, body)
                                    dao.upsertMessages(listOf(messageEntity(updated, me)))
                                }.onFailure { dao.editLocal(editingNow.id, body) }
                            }
                        } else {
                            sendPayload(dao, chat.id, me, "text", JSONObject().put("text", body), replyNow)
                        }
                    }
                }) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.ArrowUpward, null, tint = Color.White)
                    }
                }
            }
        }
    }

    menu?.let { msg ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { menu = null },
            confirmButton = {},
            title = { Text(previewLabel(msg.text.ifBlank { previewText(msg.type, "", msg.deleted) }), color = Text, maxLines = 2) },
            text = {
                Column {
                    if (msg.status == "failed") ActionLine(stringResource(R.string.retry)) {
                        menu = null
                        scope.launch { dao.retryOutbox(msg.clientId); dao.setStatus(msg.clientId, "sending") }
                    }
                    if (!msg.deleted) ActionLine(stringResource(R.string.reply)) { reply = msg; editing = null; menu = null }
                    if (msg.text.isNotBlank()) ActionLine(stringResource(R.string.copy)) {
                        ctx.getSystemService(ClipboardManager::class.java)
                            .setPrimaryClip(ClipData.newPlainText("salam", msg.text))
                        menu = null
                    }
                    if (msg.outgoing && msg.type == "text" && !msg.deleted && msg.status != "failed") {
                        ActionLine(stringResource(R.string.edit)) {
                            editing = msg
                            reply = null
                            text = msg.text
                            menu = null
                        }
                    }
                    if (msg.outgoing && !msg.deleted && msg.status != "sending") {
                        ActionLine(stringResource(R.string.delete)) {
                            menu = null
                            scope.launch(Dispatchers.IO) {
                                dao.deleteLocal(msg.id)
                                runCatching { api.deleteMessage(msg.id) }
                            }
                        }
                    }
                }
            },
            containerColor = Elevated,
        )
    }

    if (members) {
        MembersSheet(
            api,
            chat,
            me,
            onLeave = { members = false; onBack() },
            onClose = { members = false },
            onOpenUser = { members = false; profile = it },
        )
    }
    profile?.let { userId ->
        val canWrite = !userId.equals(me, true) && !(current.type == "direct" && userId.equals(current.peerId, true))
        ProfileSheet(api, userId, onClose = { profile = null }, showNotes = !userId.equals(me, true), onOpenChat = { chatId ->
            scope.launch {
                val raw = withContext(Dispatchers.IO) { runCatching { api.chat(chatId) }.getOrNull() } ?: return@launch
                val entity = chatEntity(raw)
                withContext(Dispatchers.IO) { dao.upsertChats(listOf(entity)) }
                profile = null
                onOpenChat(entity)
            }
        }, onWrite = if (canWrite) {
            {
                scope.launch {
                    val raw = withContext(Dispatchers.IO) { runCatching { api.direct(userId) }.getOrNull() } ?: return@launch
                    val entity = chatEntity(raw)
                    withContext(Dispatchers.IO) { dao.upsertChats(listOf(entity)) }
                    profile = null
                    onOpenChat(entity)
                }
            }
        } else {
            null
        })
    }
    stage?.let { msg ->
        val kind = openKind(msg.type, msg.text, msg.mediaUrl, msg.deleted)
        if (kind != null) {
            MediaStage(msg.mediaUrl, msg.text.ifBlank { stringResource(R.string.file) }, kind) { stage = null }
        }
    }
}

@Composable
private fun ActionLine(label: String, onClick: () -> Unit) {
    Text(label, color = Text, modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp))
}

@Composable
private fun AttachChip(label: String, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick)) {
        Box(Modifier.size(48.dp).clip(CircleShape).background(Accent.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
            Text(label.take(1), color = Accent)
        }
        Text(label, color = Muted, fontSize = 12.sp)
    }
}

@Composable
private fun Bubble(
    msg: MessageEntity,
    showDay: Boolean,
    showAuthor: Boolean,
    onOpen: () -> Unit,
    onMenu: () -> Unit,
    onAuthor: () -> Unit,
) {
    val ctx = LocalContext.current
    val time = remember(msg.createdAt) { SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(msg.createdAt)) }
    val day = dayLabel(msg.createdAt, stringResource(R.string.today), stringResource(R.string.yesterday))
    Column(Modifier.fillMaxWidth()) {
        if (showDay) {
            Text(day, color = Muted, fontSize = 11.sp, modifier = Modifier.align(Alignment.CenterHorizontally).padding(vertical = 2.dp))
        }
        if (showAuthor) {
            Text(
                msg.authorName,
                color = Accent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(onClick = onAuthor).padding(start = 8.dp, bottom = 2.dp),
            )
        }
        Row(Modifier.fillMaxWidth().pointerInput(msg.id) {
            detectTapGestures(
                onLongPress = { onMenu() },
                onTap = {
                    if (openKind(msg.type, msg.text, msg.mediaUrl, msg.deleted) != null) onOpen()
                    else if (msg.status == "failed") onMenu()
                },
            )
        }) {
            if (msg.outgoing) Spacer(Modifier.weight(1f))
            Column(
                Modifier
                    .clip(RoundedCornerShape(16.dp, 16.dp, if (msg.outgoing) 4.dp else 16.dp, if (msg.outgoing) 16.dp else 4.dp))
                    .background(if (msg.outgoing) Outgoing else Incoming)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                if (msg.replyText.isNotBlank()) Text(msg.replyText, color = Accent, fontSize = 12.sp, maxLines = 2)
                val kind = openKind(msg.type, msg.text, msg.mediaUrl, msg.deleted)
                when {
                    msg.deleted -> Text(stringResource(R.string.deleted), color = Muted)
                    kind == "image" -> AsyncImage(
                        model = coilModel(msg.mediaUrl),
                        contentDescription = stringResource(R.string.photo),
                        modifier = Modifier.size(220.dp).clip(RoundedCornerShape(12.dp)),
                        contentScale = ContentScale.Crop,
                    )
                    msg.type == "voice" -> VoiceBubble(msg)
                    kind != null -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (kind == "video") Icons.Default.PlayArrow else Icons.Default.Description,
                            contentDescription = null,
                            tint = Accent,
                            modifier = Modifier.size(22.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            msg.text.ifBlank { stringResource(if (kind == "video") R.string.video else R.string.file) },
                            color = Text,
                            fontSize = 16.sp,
                        )
                    }
                    msg.type == "location" -> Text(msg.text.ifBlank { stringResource(R.string.geo) }, color = Text)
                    else -> Text(msg.text, color = Text, fontSize = 16.sp)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (msg.edited) Text(stringResource(R.string.edited), color = Muted, fontSize = 11.sp)
                    Spacer(Modifier.width(6.dp))
                    Text(time, color = Muted, fontSize = 11.sp)
                    if (msg.outgoing) {
                        Spacer(Modifier.width(4.dp))
                        val tint = if (msg.status == "read") Success else Muted
                        when (msg.status) {
                            "read", "delivered" -> Icon(Icons.Default.DoneAll, null, tint = tint, modifier = Modifier.size(14.dp))
                            "failed" -> Text("!", color = Danger, fontSize = 12.sp)
                            else -> Icon(Icons.Default.Check, null, tint = Muted, modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }
            if (!msg.outgoing) Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun VoiceBubble(msg: MessageEntity) {
    var playing by remember(msg.id) { mutableStateOf(false) }
    val bars = msg.waveform.split(",").mapNotNull { it.toFloatOrNull() }.ifEmpty { List(16) { 0.3f } }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable {
        if (msg.mediaUrl.isBlank()) return@clickable
        if (playing) {
            VoicePlayer.stop()
            playing = false
        } else {
            VoicePlayer.play(msg.mediaUrl, msg.durationMs) { playing = false }
            playing = true
        }
    }) {
        Text(if (playing) "■" else "▶", color = Accent)
        Spacer(Modifier.width(8.dp))
        Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.height(28.dp)) {
            bars.take(32).forEach { amp ->
                Box(
                    Modifier
                        .padding(horizontal = 1.dp)
                        .width(3.dp)
                        .height((4 + amp.coerceIn(0f, 1f) * 24).dp)
                        .background(Accent, RoundedCornerShape(2.dp)),
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(clock(msg.durationMs), color = Muted, fontSize = 12.sp)
    }
}

private fun clock(ms: Int): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

private fun dayLabel(at: Long, today: String, yesterday: String): String {
    val now = Calendar.getInstance()
    val then = Calendar.getInstance().apply { timeInMillis = at }
    if (sameDay(now, then)) return today
    now.add(Calendar.DAY_OF_YEAR, -1)
    if (sameDay(now, then)) return yesterday
    return SimpleDateFormat("d MMMM", Locale.getDefault()).format(Date(at))
}

private fun sameDay(a: Calendar, b: Calendar): Boolean =
    a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)

private fun sameInstantDay(a: Long, b: Long): Boolean {
    val left = Calendar.getInstance().apply { timeInMillis = a }
    val right = Calendar.getInstance().apply { timeInMillis = b }
    return sameDay(left, right)
}

private suspend fun sendPayload(
    dao: SamalDao,
    chatId: String,
    me: String,
    type: String,
    payload: JSONObject,
    reply: MessageEntity?,
    local: String = "",
    mime: String = "",
    kind: String = "",
) {
    val client = UUID.randomUUID().toString()
    val now = System.currentTimeMillis()
    val text = payload.optString("text").ifBlank { payload.optString("caption") }
    if (reply != null) payload.put("_reply", reply.id)
    if (local.isNotBlank()) {
        payload.put("_local", local)
        payload.put("_mime", mime)
        payload.put("_kind", kind.ifBlank { type })
    }
    dao.upsertMessages(
        listOf(
            MessageEntity(
                client, chatId, me, type, text, client, now, "sending", true,
                replyText = reply?.text.orEmpty(),
                mediaUrl = local,
                durationMs = payload.optInt("duration_ms"),
                waveform = (payload.optJSONArray("waveform")?.let { arr ->
                    (0 until arr.length()).joinToString(",") { arr.optDouble(it).toString() }
                }).orEmpty(),
            ),
        ),
    )
    dao.insertOutbox(OutboxEntity(client, chatId, type, payload.toString(), 0, now))
    dao.noteMessage(chatId, previewText(type, text, false), now, 0)
}

private suspend fun enqueueFile(ctx: Context, dao: SamalDao, chatId: String, me: String, uri: Uri, reply: MessageEntity?) = withContext(Dispatchers.IO) {
    val mime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
    val name = ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
        val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (i >= 0 && c.moveToFirst()) c.getString(i) else null
    } ?: "file"
    val named = if (name.contains('.')) name else {
        val ext = when (mime) {
            "image/jpeg" -> "jpg"
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "video/mp4" -> "mp4"
            "video/webm" -> "webm"
            "video/quicktime" -> "mov"
            "application/pdf" -> "pdf"
            else -> ""
        }
        if (ext.isEmpty()) name else "$name.$ext"
    }
    val dest = File(ctx.cacheDir, "out/${UUID.randomUUID()}-$named")
    dest.parentFile?.mkdirs()
    val input = ctx.contentResolver.openInputStream(uri)
    if (input == null) return@withContext
    input.use { src -> dest.outputStream().use { src.copyTo(it) } }
    val kind = when {
        mime.startsWith("image/") -> "photo"
        mime.startsWith("video/") -> "video"
        else -> "file"
    }
    val type = if (kind == "video") "file" else kind
    val payload = JSONObject()
    if (kind != "photo" && name.isNotBlank()) payload.put("caption", name)
    sendPayload(
        dao, chatId, me, type,
        payload,
        reply, dest.absolutePath, mime, kind,
    )
}

private fun lastLocation(ctx: Context): Pair<Double, Double>? {
    val lm = ctx.getSystemService(LocationManager::class.java) ?: return null
    val loc = runCatching { lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) }.getOrNull()
        ?: runCatching { lm.getLastKnownLocation(LocationManager.GPS_PROVIDER) }.getOrNull()
        ?: return null
    return loc.latitude to loc.longitude
}

private fun finishVoice(
    voice: VoiceHold,
    dao: SamalDao,
    chatId: String,
    me: String,
    reply: MessageEntity?,
    onError: (String) -> Unit,
    onSent: () -> Unit,
) {
    val taken = voice.stop()
    if (taken == null) {
        onError("")
        return
    }
    val (file, ms, bars) = taken
    if (ms < 500 || file.length() < 80) {
        file.delete()
        onError("short")
        return
    }
    kotlinx.coroutines.CoroutineScope(Dispatchers.IO).launch {
        val wave = JSONArray()
        bars.forEach { wave.put(it.toDouble()) }
        sendPayload(
            dao, chatId, me, "voice",
            JSONObject().put("duration_ms", ms).put("waveform", wave),
            reply, file.absolutePath, "audio/mp4", "voice",
        )
        onSent()
    }
}

private class VoiceHold(private val ctx: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var started = 0L
    private val bars = mutableListOf<Float>()

    fun start() {
        cancel()
        val dest = File(ctx.cacheDir, "voice/${UUID.randomUUID()}.m4a")
        dest.parentFile?.mkdirs()
        val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
        runCatching {
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setOutputFile(dest.absolutePath)
            rec.prepare()
            rec.start()
            recorder = rec
            file = dest
            started = System.currentTimeMillis()
        }.onFailure {
            rec.release()
            dest.delete()
        }
    }

    fun sample() {
        val amp = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
        if (bars.size < 64) bars.add((amp / 16000f).coerceIn(0.08f, 1f))
    }

    fun stop(): Triple<File, Int, List<Float>>? {
        val rec = recorder ?: return null
        val dest = file
        val ms = (System.currentTimeMillis() - started).toInt()
        runCatching { rec.stop() }
        rec.release()
        recorder = null
        file = null
        val taken = bars.toList()
        bars.clear()
        if (dest == null) return null
        return Triple(dest, ms, taken)
    }

    fun cancel() {
        val rec = recorder
        recorder = null
        runCatching { rec?.stop() }
        runCatching { rec?.release() }
        file?.delete()
        file = null
        bars.clear()
    }
}

private object VoicePlayer {
    private var player: MediaPlayer? = null
    fun stop() {
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
    }

    fun play(url: String, durationMs: Int, onEnd: () -> Unit) {
        stop()
        val mp = MediaPlayer()
        player = mp
        runCatching {
            mp.setDataSource(url)
            mp.setOnCompletionListener { stop(); onEnd() }
            mp.prepare()
            mp.start()
            if (durationMs > 0) {
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    if (player === mp) {
                        stop()
                        onEnd()
                    }
                }, durationMs.toLong())
            }
        }.onFailure { stop(); onEnd() }
    }
}

@Composable
private fun MembersSheet(
    api: SamalApi,
    chat: ChatEntity,
    me: String,
    onLeave: () -> Unit,
    onClose: () -> Unit,
    onOpenUser: (String) -> Unit,
) {
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var q by remember { mutableStateOf("") }
    var found by remember { mutableStateOf(listOf<JSONObject>()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(chat.id) {
        items = withContext(Dispatchers.IO) {
            runCatching {
                val arr = api.members(chat.id)
                (0 until arr.length()).map { arr.getJSONObject(it) }
            }.getOrDefault(emptyList())
        }
    }
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
                (0 until arr.length()).map { arr.getJSONObject(it) }
            }.getOrDefault(emptyList())
        }
    }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose,
        confirmButton = {
            Text(stringResource(R.string.leave), color = Danger, modifier = Modifier.clickable {
                scope.launch(Dispatchers.IO) { runCatching { api.removeMember(chat.id, me) } }
                onLeave()
            }.padding(8.dp))
        },
        dismissButton = {
            Text(stringResource(R.string.cancel), color = Muted, modifier = Modifier.clickable(onClick = onClose).padding(8.dp))
        },
        title = { Text(stringResource(R.string.members), color = Text) },
        text = {
            Column {
                items.forEach { row ->
                    val user = row.optJSONObject("user") ?: return@forEach
                    val id = user.optString("id")
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            user.optString("display_name"),
                            color = Text,
                            modifier = Modifier.weight(1f).clickable { if (id.isNotBlank() && id != me) onOpenUser(id) },
                        )
                        if (id != me) {
                            Text(stringResource(R.string.kick), color = Danger, modifier = Modifier.clickable {
                                scope.launch {
                                    withContext(Dispatchers.IO) { runCatching { api.removeMember(chat.id, id) } }
                                    items = items.filter { it.optJSONObject("user")?.optString("id") != id }
                                }
                            })
                        }
                    }
                }
                TextField(
                    value = q,
                    onValueChange = { q = it },
                    placeholder = { Text(stringResource(R.string.add_member), color = Muted) },
                    colors = TextFieldDefaults.colors(focusedTextColor = Text, unfocusedTextColor = Text),
                )
                found.forEach { user ->
                    Text(
                        user.optString("display_name"),
                        color = Accent,
                        modifier = Modifier.fillMaxWidth().clickable {
                            scope.launch(Dispatchers.IO) { runCatching { api.addMembers(chat.id, listOf(user.getString("id"))) } }
                            q = ""
                        }.padding(vertical = 6.dp),
                    )
                }
            }
        },
        containerColor = Elevated,
    )
}
