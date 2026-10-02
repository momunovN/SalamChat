package dev.samal.app.ui.calls

import android.Manifest
import android.app.Application
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import dev.samal.app.R
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.SamalDao
import dev.samal.app.data.sync.parseIso
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Danger
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.SalamLogo
import dev.samal.app.ui.theme.Success
import dev.samal.app.ui.theme.Text
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.SurfaceViewRenderer
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class Stage(
    val id: String,
    val title: String,
    val video: Boolean,
    val url: String,
    val token: String,
)

@Composable
fun CallsScreen(api: SamalApi, dao: SamalDao) {
    var rows by remember { mutableStateOf(listOf<JSONObject>()) }
    val chats by remember(dao) { dao.chats("", "") }.collectAsState(initial = emptyList())
    LaunchedEffect(Unit) {
        while (isActive) {
            rows = kotlinx.coroutines.withContext(Dispatchers.IO) {
                runCatching {
                    val arr = api.calls()
                    (0 until arr.length()).map { arr.getJSONObject(it) }
                }.getOrDefault(emptyList())
            }
            delay(4_000)
        }
    }
    Column(Modifier.fillMaxSize().background(Bg).padding(top = 8.dp)) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            SalamLogo(36.dp)
            Text(
                stringResource(R.string.tab_calls),
                color = Text,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
        if (rows.isEmpty()) {
            Text(stringResource(R.string.calls_empty), color = Muted, modifier = Modifier.padding(16.dp))
        } else {
            LazyColumn {
                items(rows, key = { it.getString("id") }) { call ->
                    val chat = chats.find { it.id == call.optString("chat_id") }
                    val whenAt = parseIso(call.optString("started_at"))
                    val time = SimpleDateFormat("dd.MM HH:mm", Locale.getDefault()).format(Date(whenAt))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Call, null, tint = Accent)
                        Column(Modifier.padding(start = 12.dp)) {
                            Text(chat?.title ?: stringResource(R.string.tab_calls), color = Text, fontWeight = FontWeight.SemiBold)
                            Text(
                                "${if (call.optString("kind") == "video") stringResource(R.string.video) else stringResource(R.string.voice)} · ${call.optString("status")} · $time",
                                color = Muted,
                                fontSize = 13.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun IncomingCall(
    title: String,
    video: Boolean,
    onAnswer: () -> Unit,
    onDecline: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Bg.copy(alpha = 0.96f)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                stringResource(if (video) R.string.incoming_video else R.string.incoming_audio),
                color = Text,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(title, color = Muted, fontSize = 18.sp)
            Spacer(Modifier.height(36.dp))
            Row {
                CallButton(stringResource(R.string.decline), Danger, onDecline)
                Spacer(Modifier.padding(24.dp))
                CallButton(stringResource(R.string.answer), Success, onAnswer)
            }
        }
    }
}

@Composable
private fun CallButton(label: String, color: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick)) {
        Box(Modifier.clip(CircleShape).background(color).padding(22.dp)) {
            Icon(if (label == stringResource(R.string.decline)) Icons.Default.CallEnd else Icons.Default.Call, null, tint = androidx.compose.ui.graphics.Color.White)
        }
        Text(label, color = Muted, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
fun CallStage(stage: Stage, onHangup: () -> Unit) {
    val ctx = LocalContext.current
    val app = ctx.applicationContext as Application
    val room = remember { LiveKit.create(app) }
    var phase by remember { mutableStateOf("link") }
    var remote by remember { mutableStateOf<VideoTrack?>(null) }
    var since by remember { mutableLongStateOf(0L) }
    var tick by remember { mutableLongStateOf(0L) }
    val failed = stringResource(R.string.call_failed)
    DisposableEffect(room) {
        onDispose {
            runCatching { room.disconnect() }
        }
    }
    LaunchedEffect(stage.id) {
        if (!stage.url.startsWith("ws") || stage.token.startsWith("stub")) {
            phase = "fail"
            return@LaunchedEffect
        }
        launch {
            room.events.collect { event ->
                if (event is RoomEvent.TrackSubscribed && event.track is VideoTrack) {
                    remote = event.track as VideoTrack
                }
            }
        }
        val ok = runCatching {
            room.prepareConnection(stage.url, stage.token)
            room.connect(stage.url, stage.token)
            coroutineScope {
                val mic = async { room.localParticipant.setMicrophoneEnabled(true) }
                val cam = async { if (stage.video) room.localParticipant.setCameraEnabled(true) else true }
                mic.await()
                cam.await()
            }
        }.isSuccess
        if (!ok) phase = "fail" else {
            since = System.currentTimeMillis()
            phase = "live"
        }
    }
    LaunchedEffect(phase) {
        while (isActive && phase == "live") {
            tick = System.currentTimeMillis()
            delay(500)
        }
    }
    Box(Modifier.fillMaxSize().background(Bg)) {
        val track = remote
        if (track != null) {
            AndroidView(
                factory = { viewCtx ->
                    SurfaceViewRenderer(viewCtx).also { renderer ->
                        room.initVideoRenderer(renderer)
                        track.addRenderer(renderer)
                    }
                },
                modifier = Modifier.fillMaxSize(),
                onRelease = { it.release() },
            )
        }
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stage.title, color = Text, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                when (phase) {
                    "live" -> clock(since, tick)
                    "fail" -> failed
                    else -> stringResource(R.string.connecting)
                },
                color = Muted,
                fontSize = 16.sp,
            )
            Spacer(Modifier.height(28.dp))
            CallButton(stringResource(R.string.hangup), Danger, onHangup)
        }
    }
}

private fun clock(since: Long, now: Long): String {
    if (since == 0L) return "00:00"
    val s = ((now - since) / 1000).coerceAtLeast(0)
    return "%02d:%02d".format(s / 60, s % 60)
}

@Composable
fun rememberCallStarter(api: SamalApi, onStage: (Stage) -> Unit): (String, String, String) -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val ask = pending ?: return@rememberLauncherForActivityResult
        pending = null
        if (granted[Manifest.permission.RECORD_AUDIO] != true) return@rememberLauncherForActivityResult
        if (ask.third == "video" && granted[Manifest.permission.CAMERA] != true) return@rememberLauncherForActivityResult
        scope.launch { openCall(api, ask.first, ask.second, ask.third, onStage) }
    }
    return { chatId, title, kind ->
        val need = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (kind == "video") add(Manifest.permission.CAMERA)
        }
        val missing = need.filter {
            androidx.core.content.ContextCompat.checkSelfPermission(ctx, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) scope.launch { openCall(api, chatId, title, kind, onStage) }
        else {
            pending = Triple(chatId, title, kind)
            perm.launch(missing.toTypedArray())
        }
    }
}

private fun joinCreds(call: JSONObject): JSONObject? {
    val url = call.optString("url")
    val token = call.optString("token")
    if (url.startsWith("ws") && token.isNotEmpty() && !token.startsWith("stub")) return call
    return null
}

suspend fun openCall(api: SamalApi, chatId: String, title: String, kind: String, onStage: (Stage) -> Unit) {
    val call = kotlinx.coroutines.withContext(Dispatchers.IO) { runCatching { api.startCall(chatId, kind) }.getOrNull() } ?: return
    val token = joinCreds(call) ?: kotlinx.coroutines.withContext(Dispatchers.IO) { runCatching { api.callToken(call.getString("id")) }.getOrNull() } ?: return
    onStage(Stage(call.getString("id"), title, kind == "video", token.optString("url"), token.optString("token")))
}

suspend fun answerCall(api: SamalApi, call: JSONObject, title: String, onStage: (Stage) -> Unit) {
    val id = call.getString("id")
    val answered = kotlinx.coroutines.withContext(Dispatchers.IO) { runCatching { api.answerCall(id) }.getOrNull() } ?: return
    val token = joinCreds(answered) ?: kotlinx.coroutines.withContext(Dispatchers.IO) { runCatching { api.callToken(id) }.getOrNull() } ?: return
    onStage(Stage(id, title, call.optString("kind") == "video", token.optString("url"), token.optString("token")))
}
