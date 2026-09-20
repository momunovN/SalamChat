package dev.samal.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.R
import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.db.MessageEntity
import dev.samal.app.data.db.OutboxEntity
import dev.samal.app.data.db.SamalDao
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Danger
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Incoming
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Outgoing
import dev.samal.app.ui.theme.Success
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.math.roundToInt

@Composable
fun ChatScreen(chat: ChatEntity, dao: SamalDao, me: String, onBack: () -> Unit) {
    val messages by dao.messages(chat.id, "").collectAsState(initial = emptyList())
    var text by remember { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var dragX by remember { mutableStateOf(0f) }
    var dragY by remember { mutableStateOf(0f) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Text)
            }
            Box(Modifier.size(36.dp).clip(CircleShape).background(Elevated), contentAlignment = Alignment.Center) {
                Text(chat.title.take(1).uppercase(), color = Text)
            }
            Column(Modifier.padding(start = 8.dp).weight(1f)) {
                Text(chat.title, color = Text)
                Text(stringResource(R.string.online), color = Success, fontSize = 12.sp)
            }
            IconButton(onClick = {}) { Icon(Icons.Default.Call, null, tint = Text) }
            IconButton(onClick = {}) { Icon(Icons.Default.Videocam, null, tint = Text) }
        }

        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            reverseLayout = true,
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(messages, key = { it.id }) { msg ->
                Bubble(msg)
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

        Row(
            Modifier.padding(12.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconButton(onClick = { /* attach sheet */ }) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(Elevated), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Add, null, tint = Text)
                }
            }
            TextField(
                value = text,
                onValueChange = { text = it },
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
            if (text.isBlank()) {
                Box(
                    Modifier
                        .padding(start = 8.dp)
                        .size(40.dp)
                        .offset { IntOffset(dragX.roundToInt().coerceAtMost(0), dragY.roundToInt().coerceAtMost(0)) }
                        .clip(CircleShape)
                        .background(if (recording) Danger.copy(alpha = 0.2f) else Elevated)
                        .pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = { recording = true },
                                onDragEnd = {
                                    recording = false
                                    dragX = 0f
                                    dragY = 0f
                                },
                                onDragCancel = {
                                    recording = false
                                    dragX = 0f
                                    dragY = 0f
                                },
                            ) { change, amount ->
                                change.consume()
                                dragX += amount.x
                                dragY += amount.y
                                if (dragX < -72) {
                                    recording = false
                                    dragX = 0f
                                    dragY = 0f
                                }
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.Mic, null, tint = if (recording) Danger else Text) }
            } else {
                IconButton(onClick = {
                    val t = text.trim()
                    if (t.isEmpty()) return@IconButton
                    text = ""
                    val client = UUID.randomUUID().toString()
                    val now = System.currentTimeMillis()
                    scope.launch {
                        dao.upsertMessages(
                            listOf(
                                MessageEntity(client, chat.id, me, "text", t, client, now, "sending", true),
                            ),
                        )
                        dao.insertOutbox(OutboxEntity(client, chat.id, "text", """{"text":${JSONString(t)}}""", 0, now))
                    }
                }) {
                    Box(Modifier.size(40.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.ArrowUpward, null, tint = Color.White)
                    }
                }
            }
        }
    }
}

@Composable
private fun Bubble(msg: MessageEntity) {
    Row(Modifier.fillMaxWidth()) {
        if (msg.outgoing) Spacer(Modifier.weight(1f))
        Column(
            Modifier
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (msg.outgoing) 16.dp else 4.dp,
                        bottomEnd = if (msg.outgoing) 4.dp else 16.dp,
                    ),
                )
                .background(if (msg.outgoing) Outgoing else Incoming)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(msg.text, color = Text, fontSize = 16.sp)
        }
        if (!msg.outgoing) Spacer(Modifier.weight(1f))
    }
}

private fun JSONString(s: String): String =
    org.json.JSONObject.quote(s)
