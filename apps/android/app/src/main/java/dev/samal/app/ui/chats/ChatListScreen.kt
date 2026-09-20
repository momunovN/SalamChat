package dev.samal.app.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.R
import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.db.SamalDao
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Text
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun ChatListScreen(dao: SamalDao, onOpen: (ChatEntity) -> Unit) {
    var q by remember { mutableStateOf("") }
    var seg by remember { mutableStateOf("all") }
    val type = when (seg) {
        "direct" -> "direct"
        "group" -> "group"
        else -> ""
    }
    val chats by dao.chats(type, q).collectAsState(initial = emptyList())

    Column(Modifier.fillMaxSize().background(Bg)) {
        Text(
            stringResource(R.string.app_name),
            color = Text,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        TextField(
            value = q,
            onValueChange = { q = it },
            placeholder = { Text(stringResource(R.string.search), color = Muted) },
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp)),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Elevated,
                unfocusedContainerColor = Elevated,
                focusedTextColor = Text,
                unfocusedTextColor = Text,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            singleLine = true,
        )
        Row(Modifier.padding(16.dp, 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf(
                "all" to stringResource(R.string.seg_all),
                "direct" to stringResource(R.string.seg_direct),
                "group" to stringResource(R.string.seg_groups),
                "calls" to stringResource(R.string.seg_calls),
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
            Text(
                stringResource(R.string.chats_empty),
                color = Muted,
                modifier = Modifier.padding(24.dp),
            )
        } else {
            LazyColumn {
                items(chats, key = { it.id }) { chat ->
                    ChatRow(chat) { onOpen(chat) }
                }
            }
        }
    }
}

@Composable
private fun ChatRow(chat: ChatEntity, onClick: () -> Unit) {
    val time = remember(chat.lastAt) {
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(chat.lastAt))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(56.dp).clip(CircleShape).background(Elevated),
            contentAlignment = Alignment.Center,
        ) {
            Text(chat.title.take(1).uppercase(), color = Text, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Row {
                Text(chat.title, color = Text, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(time, color = Muted, fontSize = 12.sp)
            }
            Row {
                Text(chat.lastText, color = Muted, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1)
                if (chat.unread > 0) {
                    Box(
                        Modifier.clip(CircleShape).background(Accent).padding(horizontal = 7.dp, vertical = 2.dp),
                    ) { Text("${chat.unread}", color = Text, fontSize = 12.sp) }
                }
            }
        }
    }
}
