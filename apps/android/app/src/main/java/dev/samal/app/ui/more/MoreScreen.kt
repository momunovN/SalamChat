package dev.samal.app.ui.more

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.R
import dev.samal.app.data.contacts.sanitizeUsername
import dev.samal.app.data.session.SessionStore
import dev.samal.app.ui.auth.AuthField
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Danger
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.SalamLogo
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.launch

@Composable
fun MoreScreen(session: SessionStore) {
    val user = session.user
    var name by remember(user?.id) { mutableStateOf(user?.displayName.orEmpty()) }
    var nick by remember(user?.id) { mutableStateOf(user?.username.orEmpty()) }
    var bio by remember(user?.id) { mutableStateOf(user?.bio.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun save() {
        if (busy || user == null) return
        if (name.trim().length < 2) {
            error = "name"
            return
        }
        if (nick.isNotBlank() && sanitizeUsername(nick) == null) {
            error = "nick"
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                session.patchProfile(name.trim(), sanitizeUsername(nick)?.ifBlank { null }, bio.trim())
            } catch (e: Exception) {
                error = e.message ?: "name"
            } finally {
                busy = false
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Bg)) {
        Column(
            Modifier
                .align(Alignment.TopCenter)
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SalamLogo(36.dp)
                Text(
                    stringResource(R.string.tab_more),
                    color = Text,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Elevated)
                    .padding(16.dp),
            ) {
                Text(name.ifBlank { user?.displayName.orEmpty() }, color = Text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    listOfNotNull(user?.username?.let { "@$it" }, user?.phone).joinToString(" · "),
                    color = Muted,
                    fontSize = 14.sp,
                )
            }
            Spacer(Modifier.height(16.dp))
            Text(stringResource(R.string.field_name), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            AuthField(value = name, onValueChange = { name = it; error = null }, keyboard = KeyboardType.Text, onGo = ::save)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.field_nick), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            AuthField(
                value = nick,
                onValueChange = { nick = it.removePrefix("@"); error = null },
                keyboard = KeyboardType.Ascii,
                onGo = ::save,
            )
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.nick_hint), color = Muted, fontSize = 12.sp)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.field_bio), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            AuthField(value = bio, onValueChange = { bio = it }, keyboard = KeyboardType.Text, onGo = ::save)
            if (error != null) {
                Spacer(Modifier.height(12.dp))
                Text(
                    when (error) {
                        "name" -> stringResource(R.string.err_name)
                        "nick" -> stringResource(R.string.err_nick)
                        else -> error.orEmpty()
                    },
                    color = Danger,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
            Spacer(Modifier.height(16.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Accent.copy(alpha = if (busy) 0.6f else 1f))
                    .clickable(enabled = !busy, onClick = ::save),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.save), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(20.dp))
            Text(
                stringResource(R.string.logout),
                color = Danger,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable { session.logout() }.padding(vertical = 8.dp),
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}
