package dev.samal.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.contacts.needsDisplayName
import dev.samal.app.ui.auth.PhoneAuthScreen
import dev.samal.app.ui.auth.ProfileOnboardingScreen
import dev.samal.app.ui.chat.ChatScreen
import dev.samal.app.ui.chats.ChatListScreen
import dev.samal.app.ui.contacts.ContactsScreen
import dev.samal.app.ui.more.MoreScreen
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.SalamLogo
import dev.samal.app.ui.theme.SamalTheme
import dev.samal.app.ui.theme.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as SamalApp
        setContent {
            SamalTheme {
                val user = app.session.user
                if (user == null) {
                    PhoneAuthScreen(app.session)
                } else if (needsDisplayName(user.displayName)) {
                    ProfileOnboardingScreen(app.session)
                } else {
                    MainShell(app)
                }
            }
        }
    }
}

@Composable
private fun MainShell(app: SamalApp) {
    var tab by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<ChatEntity?>(null) }
    val me = app.session.user?.id.orEmpty()
    Column(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Box(Modifier.weight(1f)) {
            val chat = open
            if (chat != null) {
                ChatScreen(chat, app.db.dao(), me = me, onBack = { open = null })
            } else when (tab) {
                0 -> ChatListScreen(app.db.dao()) { open = it }
                1 -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    SalamLogo(36.dp)
                    Text(
                        stringResource(R.string.tab_calls),
                        color = Text,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(start = 10.dp),
                    )
                }
                2 -> ContactsScreen(app.api) { /* open chat by user id later */ }
                else -> MoreScreen(app.session)
            }
        }
        if (open == null) {
            NavigationBar(containerColor = Elevated) {
                val items = listOf(
                    Triple(Icons.Default.Chat, stringResource(R.string.tab_chats), 0),
                    Triple(Icons.Default.Call, stringResource(R.string.tab_calls), 1),
                    Triple(Icons.Default.People, stringResource(R.string.tab_contacts), 2),
                    Triple(Icons.Default.MoreHoriz, stringResource(R.string.tab_more), 3),
                )
                items.forEach { (icon, label, i) ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i },
                        icon = { Icon(icon, label) },
                        label = { Text(label, maxLines = 1) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Accent,
                            selectedTextColor = Accent,
                            unselectedIconColor = Muted,
                            unselectedTextColor = Muted,
                            indicatorColor = Elevated,
                        ),
                    )
                }
            }
        }
    }
}
