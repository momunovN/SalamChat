package dev.samal.app.ui.auth

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.samal.app.R
import dev.samal.app.data.contacts.readBookContacts
import dev.samal.app.data.contacts.sanitizeUsername
import dev.samal.app.data.session.SessionStore
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Danger
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.launch

@Composable
fun ProfileOnboardingScreen(session: SessionStore) {
    var name by remember { mutableStateOf("") }
    var nick by remember { mutableStateOf("") }
    var sync by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun submit(doSync: Boolean) {
        scope.launch {
            try {
                session.patchProfile(name.trim(), sanitizeUsername(nick)?.ifBlank { null })
                if (doSync) {
                    session.syncContacts(true, readBookContacts(context))
                }
            } catch (e: Exception) {
                error = e.message ?: context.getString(R.string.err_name)
                busy = false
            }
        }
    }

    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        submit(granted)
        if (!granted) busy = false
    }

    fun go() {
        if (busy) return
        if (name.trim().length < 2) {
            error = context.getString(R.string.err_name)
            return
        }
        if (nick.isNotBlank() && sanitizeUsername(nick) == null) {
            error = context.getString(R.string.err_nick)
            return
        }
        busy = true
        error = null
        if (sync) {
            val have = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
                PackageManager.PERMISSION_GRANTED
            if (have) submit(true) else perm.launch(Manifest.permission.READ_CONTACTS)
        } else {
            submit(false)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .padding(24.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Text(stringResource(R.string.app_name), color = Text, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.name_title), color = Text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.name_subtitle), color = Muted, fontSize = 14.sp)
        Spacer(Modifier.height(16.dp))
        AuthField(value = name, onValueChange = { name = it; error = null }, keyboard = KeyboardType.Text, onGo = ::go)
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.nick_optional), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(6.dp))
        AuthField(
            value = nick,
            onValueChange = { nick = it.removePrefix("@"); error = null },
            keyboard = KeyboardType.Ascii,
            onGo = ::go,
        )
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.nick_hint), color = Muted, fontSize = 12.sp)
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { sync = !sync }) {
            Checkbox(checked = sync, onCheckedChange = { sync = it }, colors = CheckboxDefaults.colors(checkedColor = Accent))
            Text(stringResource(R.string.sync_contacts), color = Text, fontSize = 14.sp, modifier = Modifier.padding(start = 4.dp))
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = Danger, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        }
        Spacer(Modifier.height(16.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Accent.copy(alpha = if (busy) 0.6f else 1f))
                .clickable(enabled = !busy, onClick = ::go),
            contentAlignment = Alignment.Center,
        ) {
            Text(stringResource(R.string.auth_continue), color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
