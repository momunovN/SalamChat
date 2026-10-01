package dev.samal.app.ui.chat

import android.content.Intent
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import dev.samal.app.R
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.notify.Mutes
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Success
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@Composable
internal fun ProfileSheet(
    api: SamalApi,
    userId: String,
    onClose: () -> Unit,
    onWrite: (() -> Unit)?,
    showNotes: Boolean = true,
    onOpenChat: ((String) -> Unit)? = null,
) {
    var user by remember(userId) { mutableStateOf<JSONObject?>(null) }
    var lib by remember(userId) { mutableStateOf<JSONObject?>(null) }
    var fail by remember(userId) { mutableStateOf(false) }
    var tab by remember(userId) { mutableIntStateOf(0) }
    var notes by remember(userId) { mutableStateOf(true) }
    var noteBusy by remember(userId) { mutableStateOf(false) }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val player = remember { MediaPlayer() }
    DisposableEffect(Unit) {
        onDispose { runCatching { player.release() } }
    }
    LaunchedEffect(userId) {
        val loaded = withContext(Dispatchers.IO) { runCatching { api.user(userId) }.getOrNull() }
        val shelf = withContext(Dispatchers.IO) { runCatching { api.library(userId) }.getOrNull() }
        if (loaded == null) fail = true else {
            user = loaded
            notes = loaded.optBoolean("notifications", true)
        }
        lib = shelf
    }
    val name = user?.optString("display_name").orEmpty()
    val nick = user?.optString("username").orEmpty()
    val phone = user?.optString("phone").orEmpty()
    val bio = user?.optString("bio").orEmpty()
    val birth = user?.optString("birth_date").orEmpty()
    val address = user?.optString("address").orEmpty()
    val online = user?.optBoolean("online") == true
    val seen = user?.optString("last_seen_at").orEmpty().isNotBlank()
    val photo = user?.optString("avatar_url").orEmpty()
    val tabs = listOf(
        stringResource(R.string.tab_media) to "media",
        stringResource(R.string.tab_links) to "links",
        stringResource(R.string.tab_voice) to "voice",
        stringResource(R.string.tab_groups) to "groups",
    )
    val key = tabs[tab].second
    val items = lib?.optJSONArray(key) ?: JSONArray()
    val empty = when (key) {
        "links" -> stringResource(R.string.empty_links)
        "voice" -> stringResource(R.string.empty_voice)
        "groups" -> stringResource(R.string.empty_groups)
        else -> stringResource(R.string.empty_media)
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(16.dp)
                .fillMaxWidth()
                .heightIn(max = 640.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Elevated)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                stringResource(R.string.cancel),
                color = Muted,
                modifier = Modifier.fillMaxWidth().clickable(onClick = onClose),
                textAlign = TextAlign.End,
            )
            if (photo.isNotBlank()) {
                AsyncImage(
                    model = photo,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(96.dp).clip(CircleShape),
                )
            } else {
                Box(
                    Modifier.size(96.dp).clip(CircleShape).background(Bg),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(name.take(1).uppercase().ifBlank { "?" }, color = Text, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            if (user == null && !fail) {
                CircularProgressIndicator(color = Accent, modifier = Modifier.padding(top = 16.dp))
            }
            if (name.isNotBlank()) {
                Text(name, color = Text, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
            }
            if (nick.isNotBlank()) Text("@$nick", color = Accent, fontSize = 14.sp)
            if (online || seen) {
                Text(
                    if (online) stringResource(R.string.online) else stringResource(R.string.last_seen),
                    color = if (online) Success else Muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Column(Modifier.fillMaxWidth().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (phone.isNotBlank()) Field(stringResource(R.string.phone_label), phone)
                if (bio.isNotBlank()) Field(stringResource(R.string.field_bio), bio)
                if (birth.isNotBlank()) Field(stringResource(R.string.field_birth), birth.take(10))
                if (address.isNotBlank()) Field(stringResource(R.string.field_address), address)
                if (showNotes && user != null) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.notifications), color = Text, modifier = Modifier.weight(1f))
                        Switch(
                            checked = notes,
                            enabled = !noteBusy,
                            onCheckedChange = { next ->
                                if (noteBusy) return@Switch
                                notes = next
                                noteBusy = true
                                scope.launch {
                                    val saved = withContext(Dispatchers.IO) {
                                        runCatching { api.setNotifications(userId, next) }.getOrNull()
                                    }
                                    if (saved == null) notes = !next
                                    else Mutes.set(ctx, saved.optString("chat_id"), !saved.optBoolean("enabled", next))
                                    noteBusy = false
                                }
                            },
                        )
                    }
                }
            }
            if (fail && name.isBlank()) {
                Text(stringResource(R.string.preview_fail), color = Muted, modifier = Modifier.padding(top = 12.dp))
            }
            if (onWrite != null && user != null) {
                Text(
                    stringResource(R.string.write_user),
                    color = androidx.compose.ui.graphics.Color.White,
                    modifier = Modifier
                        .padding(top = 16.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Accent)
                        .clickable(onClick = onWrite)
                        .padding(vertical = 12.dp),
                    textAlign = TextAlign.Center,
                )
            }
            Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                tabs.forEachIndexed { index, pair ->
                    Text(
                        pair.first,
                        color = if (tab == index) Accent else Muted,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable { tab = index }.padding(4.dp),
                    )
                }
            }
            if (lib == null) {
                Text("…", color = Muted, modifier = Modifier.padding(top = 16.dp))
            } else if (items.length() == 0) {
                Text(empty, color = Muted, modifier = Modifier.padding(top = 16.dp), textAlign = TextAlign.Center)
            } else {
                Column(Modifier.fillMaxWidth().padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (i in 0 until items.length()) {
                        val item = items.optJSONObject(i) ?: continue
                        when (key) {
                            "media" -> {
                                val url = item.optString("url")
                                if (item.optString("kind") == "video") {
                                    Text(stringResource(R.string.video), color = Text)
                                } else {
                                    AsyncImage(
                                        model = url,
                                        contentDescription = null,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.fillMaxWidth().heightIn(max = 180.dp).clip(RoundedCornerShape(12.dp)),
                                    )
                                }
                            }
                            "links" -> {
                                val url = item.optString("url")
                                Text(url, color = Accent, modifier = Modifier.clickable {
                                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                })
                            }
                            "voice" -> {
                                val url = item.optString("url")
                                Text(
                                    stringResource(R.string.voice),
                                    color = Text,
                                    modifier = Modifier.fillMaxWidth().clickable {
                                        runCatching {
                                            player.reset()
                                            player.setDataSource(url)
                                            player.setOnPreparedListener { it.start() }
                                            player.prepareAsync()
                                        }
                                    }.padding(vertical = 6.dp),
                                )
                            }
                            else -> {
                                val title = item.optString("title")
                                val groupNick = item.optString("username")
                                val id = item.optString("id")
                                Text(
                                    if (groupNick.isBlank()) title else "$title  @$groupNick",
                                    color = Text,
                                    modifier = Modifier.fillMaxWidth().clickable { if (id.isNotBlank()) onOpenChat?.invoke(id) }.padding(vertical = 6.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String) {
    Column(Modifier.fillMaxWidth()) {
        Text(label, color = Muted, fontSize = 12.sp)
        Text(value, color = Text, fontSize = 15.sp)
    }
}
