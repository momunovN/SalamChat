package dev.samal.app.ui.calls

import android.Manifest
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import com.twilio.audioswitch.AudioDevice
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import dev.samal.app.data.sync.CallService
import dev.samal.app.data.sync.NavBus
import io.livekit.android.room.track.DataPublishReliability
import io.livekit.android.room.track.Track
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
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

/** Same topic and payload the web client sends, so either side can end the call for both. */
private const val HANGUP_TOPIC = "salam.call"
private const val HANGUP = "hangup"
private val CLOSED = setOf("ended", "missed", "declined")

@Composable
fun CallStage(stage: Stage, api: SamalApi, onHangup: () -> Unit) {
    val ctx = LocalContext.current
    val app = ctx.applicationContext as Application
    val room = remember { LiveKit.create(app) }
    val scope = rememberCoroutineScope()
    var phase by remember { mutableStateOf("link") }
    var peer by remember { mutableStateOf(false) }
    var remote by remember { mutableStateOf<VideoTrack?>(null) }
    var local by remember { mutableStateOf<VideoTrack?>(null) }
    var mic by remember { mutableStateOf(true) }
    var cam by remember { mutableStateOf(stage.video) }
    var speaker by remember { mutableStateOf(true) }
    val micFailed = stringResource(R.string.mic_failed)
    var since by remember { mutableLongStateOf(0L) }
    var tick by remember { mutableLongStateOf(0L) }
    var done by remember { mutableStateOf(false) }
    val failed = stringResource(R.string.call_failed)
    val latestHangup by rememberUpdatedState(onHangup)

    // Leave once, whoever ends it: our button, the peer, the server (missed/declined) or a drop.
    fun finish(notifyPeer: Boolean) {
        if (done) return
        done = true
        scope.launch {
            if (notifyPeer) {
                runCatching {
                    room.localParticipant.publishData(HANGUP.toByteArray(), DataPublishReliability.RELIABLE, HANGUP_TOPIC)
                }
            }
            runCatching { room.disconnect() }
            latestHangup()
        }
    }

    DisposableEffect(room) {
        CallService.start(ctx, stage.title, stage.video)
        onDispose {
            CallService.stop(ctx)
            runCatching { room.disconnect() }
        }
    }

    val ended by NavBus.ended.collectAsState()
    LaunchedEffect(ended) {
        if (ended == stage.id) finish(false)
    }

    // Safety net when a socket event is missed: the server is the source of truth for the call.
    LaunchedEffect(stage.id) {
        while (isActive && !done) {
            delay(4_000)
            val status = withContext(Dispatchers.IO) {
                runCatching { api.call(stage.id).optString("status") }.getOrNull()
            }
            if (status != null && status in CLOSED) finish(false)
        }
    }

    LaunchedEffect(stage.id) {
        if (!stage.url.startsWith("ws") || stage.token.startsWith("stub")) {
            phase = "fail"
            return@LaunchedEffect
        }
        launch {
            var leaveJob: Job? = null
            room.events.collect { event ->
                when (event) {
                    is RoomEvent.TrackSubscribed -> {
                        peer = true
                        if (since == 0L) since = System.currentTimeMillis()
                        val track = event.track
                        if (track is VideoTrack) remote = track
                    }
                    is RoomEvent.TrackUnsubscribed -> if (event.track == remote) remote = null
                    is RoomEvent.ParticipantConnected -> {
                        leaveJob?.cancel()
                        peer = true
                        if (since == 0L) since = System.currentTimeMillis()
                    }
                    is RoomEvent.ParticipantDisconnected -> {
                        // A short grace period: LiveKit reconnects a peer that switched networks.
                        leaveJob?.cancel()
                        leaveJob = launch {
                            delay(1_500)
                            if (room.remoteParticipants.isEmpty()) finish(false)
                        }
                    }
                    is RoomEvent.DataReceived -> {
                        if (event.topic == HANGUP_TOPIC && String(event.data) == HANGUP) finish(false)
                    }
                    is RoomEvent.Disconnected -> if (phase == "live") finish(false)
                    else -> Unit
                }
            }
        }
        // Loudspeaker unless a headset is plugged in. LiveKit's default puts a call on the
        // earpiece, which held in front of you sounds like "connected, but no sound".
        room.audioSwitchHandler?.preferredDeviceList = listOf(
            AudioDevice.BluetoothHeadset::class.java,
            AudioDevice.WiredHeadset::class.java,
            AudioDevice.Speakerphone::class.java,
            AudioDevice.Earpiece::class.java,
        )
        var micOk = true
        var micError: String? = null
        val ok = runCatching {
            room.prepareConnection(stage.url, stage.token)
            room.connect(stage.url, stage.token)
            coroutineScope {
                val micOn = async {
                    try {
                        room.localParticipant.setMicrophoneEnabled(true)
                    } catch (e: Throwable) {
                        micError = e.message ?: e.javaClass.simpleName
                        false
                    }
                }
                val camOn = async { if (stage.video) room.localParticipant.setCameraEnabled(true) else true }
                micOk = micOn.await()
                camOn.await()
            }
        }.isSuccess
        // Before, a mic that failed to start was silently ignored: the call "worked" and the
        // other side heard nothing.
        if (ok && !micOk) Toast.makeText(ctx, micFailed + (micError?.let { " ($it)" } ?: ""), Toast.LENGTH_LONG).show()
        if (!ok) {
            phase = "fail"
            return@LaunchedEffect
        }
        phase = "live"
        if (room.remoteParticipants.isNotEmpty()) {
            peer = true
            if (since == 0L) since = System.currentTimeMillis()
        }
        if (stage.video) local = room.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack
    }

    LaunchedEffect(phase, peer) {
        while (isActive && phase == "live" && peer) {
            tick = System.currentTimeMillis()
            delay(500)
        }
    }


    Box(Modifier.fillMaxSize().background(Bg)) {
        val track = remote
        if (track != null) {
            key(track) {
                AndroidView(
                    factory = { viewCtx ->
                        SurfaceViewRenderer(viewCtx).also { renderer ->
                            room.initVideoRenderer(renderer)
                            track.addRenderer(renderer)
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                    onRelease = { renderer ->
                        track.removeRenderer(renderer)
                        renderer.release()
                    },
                )
            }
        }
        val self = local
        if (self != null && cam) {
            key(self) {
                AndroidView(
                    factory = { viewCtx ->
                        SurfaceViewRenderer(viewCtx).also { renderer ->
                            room.initVideoRenderer(renderer)
                            renderer.setMirror(true)
                            renderer.setZOrderMediaOverlay(true)
                            self.addRenderer(renderer)
                        }
                    },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(16.dp)
                        .size(width = 110.dp, height = 160.dp)
                        .clip(RoundedCornerShape(14.dp)),
                    onRelease = { renderer ->
                        self.removeRenderer(renderer)
                        renderer.release()
                    },
                )
            }
        }
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stage.title, color = Text, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                when {
                    phase == "fail" -> failed
                    phase == "live" && peer -> clock(since, tick)
                    phase == "live" -> stringResource(R.string.dialing)
                    else -> stringResource(R.string.connecting)
                },
                color = Muted,
                fontSize = 16.sp,
            )
        }
        Row(
            Modifier.align(Alignment.BottomCenter).padding(bottom = 48.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ToggleButton(
                label = stringResource(R.string.speaker),
                on = speaker,
                iconOn = Icons.AutoMirrored.Filled.VolumeUp,
                iconOff = Icons.AutoMirrored.Filled.VolumeOff,
            ) {
                val next = !speaker
                speaker = next
                val handler = room.audioSwitchHandler
                val device = handler?.availableAudioDevices?.firstOrNull {
                    if (next) it is AudioDevice.Speakerphone else it is AudioDevice.Earpiece
                }
                if (handler != null && device != null) handler.selectDevice(device)
            }
            Spacer(Modifier.width(20.dp))
            ToggleButton(
                label = stringResource(R.string.mic),
                on = mic,
                iconOn = Icons.Default.Mic,
                iconOff = Icons.Default.MicOff,
            ) {
                val next = !mic
                mic = next
                scope.launch { runCatching { room.localParticipant.setMicrophoneEnabled(next) } }
            }
            if (stage.video) {
                Spacer(Modifier.width(20.dp))
                ToggleButton(
                    label = stringResource(R.string.camera),
                    on = cam,
                    iconOn = Icons.Default.Videocam,
                    iconOff = Icons.Default.VideocamOff,
                ) {
                    val next = !cam
                    cam = next
                    scope.launch {
                        runCatching { room.localParticipant.setCameraEnabled(next) }
                        if (next) local = room.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack
                    }
                }
            }
            Spacer(Modifier.width(20.dp))
            CallButton(stringResource(R.string.hangup), Danger) { finish(true) }
        }
    }
}

@Composable
private fun ToggleButton(
    label: String,
    on: Boolean,
    iconOn: ImageVector,
    iconOff: ImageVector,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick)) {
        Box(
            Modifier.clip(CircleShape)
                .background(if (on) Color.White.copy(alpha = 0.15f) else Color.White)
                .padding(22.dp),
        ) {
            Icon(if (on) iconOn else iconOff, label, tint = if (on) Color.White else Color.Black)
        }
        Text(label, color = Muted, modifier = Modifier.padding(top = 8.dp))
    }
}

private fun clock(since: Long, now: Long): String {
    if (since == 0L) return "00:00"
    val s = ((now - since) / 1000).coerceAtLeast(0)
    return "%02d:%02d".format(s / 60, s % 60)
}

private fun missingCallPermissions(ctx: Context, video: Boolean): List<String> {
    val need = buildList {
        add(Manifest.permission.RECORD_AUDIO)
        if (video) add(Manifest.permission.CAMERA)
    }
    return need.filter {
        androidx.core.content.ContextCompat.checkSelfPermission(ctx, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
    }
}

private fun granted(result: Map<String, Boolean>, video: Boolean): Boolean {
    val needed = buildList {
        add(Manifest.permission.RECORD_AUDIO)
        if (video) add(Manifest.permission.CAMERA)
    }
    // Only what was just asked comes back in the result; the rest was granted before.
    return needed.all { result[it] ?: true }
}

@Composable
fun rememberCallStarter(api: SamalApi, onStage: (Stage) -> Unit): (String, String, String) -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.call_failed)
    var pending by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    val go: (Triple<String, String, String>) -> Unit = { ask ->
        scope.launch {
            if (!openCall(api, ask.first, ask.second, ask.third, onStage)) {
                Toast.makeText(ctx, failed, Toast.LENGTH_SHORT).show()
            }
        }
    }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val ask = pending ?: return@rememberLauncherForActivityResult
        pending = null
        if (granted(result, ask.third == "video")) go(ask)
    }
    return { chatId, title, kind ->
        val ask = Triple(chatId, title, kind)
        val missing = missingCallPermissions(ctx, kind == "video")
        if (missing.isEmpty()) {
            go(ask)
        } else {
            pending = ask
            perm.launch(missing.toTypedArray())
        }
    }
}

/** Answering needs the mic (and camera) too; before, a callee without them joined and failed. */
@Composable
fun rememberCallAnswerer(api: SamalApi, onStage: (Stage) -> Unit): (JSONObject, String) -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.call_failed)
    var pending by remember { mutableStateOf<Pair<JSONObject, String>?>(null) }
    val go: (Pair<JSONObject, String>) -> Unit = { ask ->
        scope.launch {
            if (!answerCall(api, ask.first, ask.second, onStage)) {
                Toast.makeText(ctx, failed, Toast.LENGTH_SHORT).show()
            }
        }
    }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val ask = pending ?: return@rememberLauncherForActivityResult
        pending = null
        if (granted(result, ask.first.optString("kind") == "video")) {
            go(ask)
        } else {
            scope.launch(Dispatchers.IO) { runCatching { api.rejectCall(ask.first.getString("id")) } }
        }
    }
    return { call, title ->
        val ask = call to title
        val missing = missingCallPermissions(ctx, call.optString("kind") == "video")
        if (missing.isEmpty()) {
            go(ask)
        } else {
            pending = ask
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

/** False when the call could not be placed; the caller shows an error instead of nothing. */
suspend fun openCall(api: SamalApi, chatId: String, title: String, kind: String, onStage: (Stage) -> Unit): Boolean {
    val call = withContext(Dispatchers.IO) { runCatching { api.startCall(chatId, kind) }.getOrNull() } ?: return false
    val token = joinCreds(call)
        ?: withContext(Dispatchers.IO) { runCatching { api.callToken(call.getString("id")) }.getOrNull() }
        ?: return false
    onStage(Stage(call.getString("id"), title, kind == "video", token.optString("url"), token.optString("token")))
    return true
}

suspend fun answerCall(api: SamalApi, call: JSONObject, title: String, onStage: (Stage) -> Unit): Boolean {
    val id = call.getString("id")
    val answered = withContext(Dispatchers.IO) { runCatching { api.answerCall(id) }.getOrNull() } ?: return false
    // Too late: it already timed out or the caller hung up.
    if (answered.optString("status") in CLOSED) return false
    val token = joinCreds(answered)
        ?: withContext(Dispatchers.IO) { runCatching { api.callToken(id) }.getOrNull() }
        ?: return false
    onStage(Stage(id, title, call.optString("kind") == "video", token.optString("url"), token.optString("token")))
    return true
}
