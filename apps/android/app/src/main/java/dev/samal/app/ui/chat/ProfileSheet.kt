package dev.samal.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
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
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Success
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
internal fun ProfileSheet(api: SamalApi, userId: String, onClose: () -> Unit, onWrite: (() -> Unit)?) {
    var user by remember(userId) { mutableStateOf<JSONObject?>(null) }
    var fail by remember(userId) { mutableStateOf(false) }
    LaunchedEffect(userId) {
        val loaded = withContext(Dispatchers.IO) { runCatching { api.user(userId) }.getOrNull() }
        if (loaded == null) fail = true else user = loaded
    }
    val name = user?.optString("display_name").orEmpty()
    val nick = user?.optString("username").orEmpty()
    val phone = user?.optString("phone").orEmpty()
    val bio = user?.optString("bio").orEmpty()
    val online = user?.optBoolean("online") == true
    val seen = user?.optString("last_seen_at").orEmpty().isNotBlank()
    val photo = user?.optString("avatar_url").orEmpty()
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(24.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Elevated)
                .padding(horizontal = 20.dp, vertical = 24.dp),
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
                androidx.compose.foundation.layout.Box(
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
            if (bio.isNotBlank()) {
                Text(bio, color = Text, fontSize = 15.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
            }
            if (phone.isNotBlank()) {
                Text(phone, color = Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 12.dp))
            }
            if (fail && name.isBlank()) {
                Text(stringResource(R.string.preview_fail), color = Muted, modifier = Modifier.padding(top = 12.dp))
            }
            if (onWrite != null && user != null) {
                Text(
                    stringResource(R.string.write_user),
                    color = androidx.compose.ui.graphics.Color.White,
                    modifier = Modifier
                        .padding(top = 20.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Accent)
                        .clickable(onClick = onWrite)
                        .padding(vertical = 12.dp),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
