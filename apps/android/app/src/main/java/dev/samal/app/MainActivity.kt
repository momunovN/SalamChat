package dev.samal.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.contacts.needsDisplayName
import dev.samal.app.data.sync.NavBus
import dev.samal.app.ui.auth.PhoneAuthScreen
import dev.samal.app.ui.auth.ProfileOnboardingScreen
import dev.samal.app.ui.calls.CallStage
import dev.samal.app.ui.calls.CallsScreen
import dev.samal.app.ui.calls.IncomingCall
import dev.samal.app.ui.calls.Stage
import dev.samal.app.ui.calls.answerCall
import dev.samal.app.ui.calls.rememberCallStarter
import dev.samal.app.ui.chat.ChatScreen
import dev.samal.app.ui.chats.ChatListScreen
import dev.samal.app.ui.contacts.ContactsScreen
import dev.samal.app.ui.more.MoreScreen
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.AppLang
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.SamalTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLang.wrap(newBase))
    }

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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("chat_id")?.let { NavBus.pendingChat.value = it }
    }
}

@Composable
private fun MainShell(app: SamalApp) {
    var tab by remember { mutableIntStateOf(0) }
    var open by remember { mutableStateOf<ChatEntity?>(null) }
    var stage by remember { mutableStateOf<Stage?>(null) }
    val me = app.session.user?.id.orEmpty()
    val scope = rememberCoroutineScope()
    val incomingRaw by NavBus.incoming.collectAsState()
    val pending by NavBus.pendingChat.collectAsState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val startCall = rememberCallStarter(app.api) { stage = it }
    val notif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val activity = LocalContext.current as MainActivity

    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) NavBus.resumed = true
            if (event == Lifecycle.Event.ON_PAUSE) NavBus.resumed = false
        }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(Unit) {
        activity.intent.getStringExtra("chat_id")?.let { NavBus.pendingChat.value = it }
        if (Build.VERSION.SDK_INT >= 33) notif.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    LaunchedEffect(stage?.id) {
        val id = stage?.id ?: return@LaunchedEffect
        while (isActive) {
            delay(2_000)
            val status = withContext(Dispatchers.IO) { runCatching { app.api.call(id).optString("status") }.getOrNull() }
            if (status == "ended" || status == "missed" || status == "declined") {
                stage = null
                break
            }
        }
    }
    LaunchedEffect(pending) {
        val id = pending ?: return@LaunchedEffect
        val chat = withContext(Dispatchers.IO) { app.db.dao().chat(id) }
        if (chat != null) {
            open = chat
            tab = 0
        }
        NavBus.pendingChat.value = null
    }

    Box(Modifier.fillMaxSize().background(Bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Box(Modifier.weight(1f)) {
                val chat = open
                if (chat != null) {
                    ChatScreen(chat, app.db.dao(), app.api, me, onBack = { open = null }) { kind ->
                        startCall(chat.id, chat.title, kind)
                    }
                } else when (tab) {
                    0 -> ChatListScreen(app.db.dao(), app.api, me) { open = it }
                    1 -> CallsScreen(app.api, app.db.dao())
                    2 -> ContactsScreen(app.api, app.db.dao(), me) { open = it }
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

        val raw = incomingRaw
        val shown = stage == null && raw != null
        if (shown && raw != null) {
            val call = runCatching { JSONObject(raw) }.getOrNull()
            if (call != null && call.optString("status") == "ringing" && call.optString("initiator_id") != me) {
                val fallback = stringResource(R.string.incoming_audio)
                var title by remember(call.optString("id")) { mutableStateOf(fallback) }
                LaunchedEffect(call.optString("chat_id")) {
                    title = withContext(Dispatchers.IO) {
                        app.db.dao().chat(call.optString("chat_id"))?.title
                    } ?: fallback
                }
                IncomingCall(
                    title = title,
                    video = call.optString("kind") == "video",
                    onAnswer = {
                        NavBus.incoming.value = null
                        scope.launch {
                            answerCall(app.api, call, title) { stage = it }
                        }
                    },
                    onDecline = {
                        NavBus.incoming.value = null
                        scope.launch(Dispatchers.IO) { runCatching { app.api.rejectCall(call.getString("id")) } }
                    },
                )
            }
        }
        stage?.let { current ->
            CallStage(current) {
                val id = current.id
                stage = null
                scope.launch(Dispatchers.IO) { runCatching { app.api.hangupCall(id) } }
            }
        }
    }
}

