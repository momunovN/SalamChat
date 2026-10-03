package dev.samal.app.ui.stories

import android.net.Uri
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import dev.samal.app.R
import dev.samal.app.data.api.MediaAuth
import dev.samal.app.data.api.SamalApi
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.LetterAvatar
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.time.Instant

/** Statuses, as the website shows them: photo, video or a text card that lasts 24 hours. */
data class StoryItem(
    val id: String,
    val kind: String,
    val text: String,
    val bg: String,
    val url: String,
    val createdAt: Long,
    val viewed: Boolean,
    val views: Int,
)

data class StoryGroup(
    val userId: String,
    val name: String,
    val stories: List<StoryItem>,
    val unseen: Boolean,
)

private const val PHOTO_MS = 5000f
private const val TEXT_MS = 6000f
private const val MAX_UPLOAD = 20 * 1024 * 1024
val STORY_BGS = listOf("#2b6bff", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#334155")

private fun parseTime(iso: String): Long = runCatching { Instant.parse(iso).toEpochMilli() }.getOrDefault(System.currentTimeMillis())

private fun color(hex: String): Color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Accent)

fun parseStories(arr: JSONArray): List<StoryGroup> = (0 until arr.length()).mapNotNull { i ->
    val g = arr.optJSONObject(i) ?: return@mapNotNull null
    val user = g.optJSONObject("user") ?: return@mapNotNull null
    val list = g.optJSONArray("stories") ?: JSONArray()
    val stories = (0 until list.length()).mapNotNull { j ->
        val s = list.optJSONObject(j) ?: return@mapNotNull null
        StoryItem(
            id = s.optString("id"),
            kind = s.optString("kind"),
            text = s.optString("text"),
            bg = s.optString("bg"),
            url = if (s.isNull("url")) "" else s.optString("url"),
            createdAt = parseTime(s.optString("created_at")),
            viewed = s.optBoolean("viewed"),
            views = s.optInt("views"),
        )
    }
    if (stories.isEmpty()) null
    else StoryGroup(user.optString("id"), user.optString("display_name"), stories, g.optBoolean("unseen"))
}

@Composable
private fun ago(at: Long): String {
    val min = ((System.currentTimeMillis() - at) / 60000).coerceAtLeast(0)
    return when {
        min < 1 -> stringResource(R.string.status_now)
        min < 60 -> stringResource(R.string.status_minutes, min.toInt())
        else -> stringResource(R.string.status_hours, (min / 60).toInt())
    }
}

/** Avatar with a ring: bright while something is unseen, dim once all are watched. */
@Composable
private fun Ringed(name: String, unseen: Boolean, ring: Boolean) {
    val brush = if (unseen) Brush.sweepGradient(listOf(Color(0xFF2B6BFF), Color(0xFF22D3EE), Color(0xFFA855F7), Color(0xFF2B6BFF)))
    else Brush.linearGradient(listOf(Color.White.copy(alpha = 0.2f), Color.White.copy(alpha = 0.2f)))
    Box(
        Modifier.size(62.dp).then(if (ring) Modifier.border(2.5.dp, brush, CircleShape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        LetterAvatar(name, 52.dp)
    }
}

@Composable
fun StoryStrip(groups: List<StoryGroup>, me: String, meName: String, onOpen: (Int) -> Unit, onAdd: () -> Unit) {
    val ownIndex = groups.indexOfFirst { it.userId == me }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(66.dp)) {
            Box {
                Box(Modifier.clip(CircleShape).clickable { if (ownIndex >= 0) onOpen(ownIndex) else onAdd() }) {
                    Ringed(meName, unseen = false, ring = ownIndex >= 0)
                }
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(Bg)
                        .padding(2.dp)
                        .clip(CircleShape)
                        .background(Accent)
                        .clickable(onClick = onAdd),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Add, stringResource(R.string.add_status), tint = Color.White, modifier = Modifier.size(14.dp))
                }
            }
            Text(stringResource(R.string.my_status), color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        groups.forEachIndexed { i, g ->
            if (g.userId == me) return@forEachIndexed
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.width(66.dp).clip(RoundedCornerShape(12.dp)).clickable { onOpen(i) },
            ) {
                Ringed(g.name, unseen = g.unseen, ring = true)
                Text(
                    g.name.substringBefore(' '),
                    color = if (g.unseen) Text else Muted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun StoryViewer(
    groups: List<StoryGroup>,
    start: Int,
    me: String,
    api: SamalApi,
    onClose: () -> Unit,
    onSeen: (String) -> Unit,
    onChanged: () -> Unit,
) {
    var gi by remember { mutableIntStateOf(start) }
    var si by remember {
        mutableIntStateOf(groups.getOrNull(start)?.stories?.indexOfFirst { !it.viewed }?.takeIf { it >= 0 } ?: 0)
    }
    var progress by remember { mutableFloatStateOf(0f) }
    var paused by remember { mutableStateOf(false) }
    var viewers by remember { mutableStateOf<JSONArray?>(null) }
    val scope = rememberCoroutineScope()
    val group = groups.getOrNull(gi)
    val story = group?.stories?.getOrNull(si)
    val own = group?.userId == me

    fun next() {
        val g = groups.getOrNull(gi) ?: return onClose()
        progress = 0f
        if (si + 1 < g.stories.size) si += 1
        else if (gi + 1 < groups.size) {
            gi += 1
            si = groups[gi].stories.indexOfFirst { !it.viewed }.takeIf { it >= 0 } ?: 0
        } else onClose()
    }

    fun prev() {
        progress = 0f
        if (si > 0) si -= 1
        else if (gi > 0) {
            gi -= 1
            si = (groups[gi].stories.size - 1).coerceAtLeast(0)
        }
    }

    val latestNext by rememberUpdatedState({ next() })

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        if (group == null || story == null) {
            LaunchedEffect(Unit) { onClose() }
            return@Dialog
        }
        LaunchedEffect(story.id) {
            if (!own && !story.viewed) {
                onSeen(story.id)
                withContext(Dispatchers.IO) { runCatching { api.viewStory(story.id) } }
            }
        }
        // Photos and text run on a clock; a video reports its own position.
        LaunchedEffect(story.id, paused, viewers == null) {
            if (story.kind == "video" || paused || viewers != null) return@LaunchedEffect
            val total = if (story.kind == "text") TEXT_MS else PHOTO_MS
            var last = withFrameMillis { it }
            while (isActive) {
                val now = withFrameMillis { it }
                progress = (progress + (now - last) / total).coerceAtMost(1f)
                last = now
                if (progress >= 1f) {
                    latestNext()
                    break
                }
            }
        }
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .background(Color.Black)
                .pointerInput(story.id) {
                    detectTapGestures(
                        onPress = {
                            paused = true
                            tryAwaitRelease()
                            paused = false
                        },
                        onTap = { pos -> if (pos.x < size.width / 3f) prev() else next() },
                    )
                },
        ) {
            when {
                story.kind == "text" -> Box(
                    Modifier.fillMaxSize().background(color(story.bg)).padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(story.text, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                }
                story.kind == "video" && story.url.isNotBlank() -> {
                    var view by remember(story.id) { mutableStateOf<VideoView?>(null) }
                    AndroidView(
                        factory = { ctx ->
                            VideoView(ctx).apply {
                                setVideoURI(Uri.parse(story.url), MediaAuth.headers(story.url))
                                setOnCompletionListener { latestNext() }
                                setOnPreparedListener { start() }
                                view = this
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                        onRelease = { it.stopPlayback() },
                    )
                    LaunchedEffect(story.id, paused) {
                        val v = view ?: return@LaunchedEffect
                        if (paused) v.pause() else if (!v.isPlaying) v.start()
                        while (isActive && !paused) {
                            if (v.duration > 0) progress = v.currentPosition.toFloat() / v.duration
                            delay(100)
                        }
                    }
                }
                story.url.isNotBlank() -> {
                    AsyncImage(
                        model = story.url,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        alpha = 0.35f,
                        modifier = Modifier.fillMaxSize(),
                    )
                    AsyncImage(model = story.url, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                }
            }
            if (story.kind != "text" && story.text.isNotBlank()) {
                Text(
                    story.text,
                    color = Color.White,
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .navigationBarsPadding()
                        .padding(start = 16.dp, end = 16.dp, bottom = 80.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.Black.copy(alpha = 0.5f))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent)))
                    .statusBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    group.stories.forEachIndexed { i, _ ->
                        val fill = when {
                            i < si -> 1f
                            i == si -> progress
                            else -> 0f
                        }
                        Box(Modifier.weight(1f).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.3f))) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(fill).background(Color.White))
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LetterAvatar(group.name, 36.dp)
                    Column(Modifier.padding(start = 10.dp).weight(1f)) {
                        Text(
                            if (own) stringResource(R.string.my_status) else group.name,
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(ago(story.createdAt), color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                    }
                    if (own) {
                        Icon(
                            Icons.Default.Delete,
                            stringResource(R.string.status_delete),
                            tint = Color.White,
                            modifier = Modifier.clip(CircleShape).clickable {
                                scope.launch {
                                    withContext(Dispatchers.IO) { runCatching { api.deleteStory(story.id) } }
                                    onChanged()
                                    onClose()
                                }
                            }.padding(10.dp),
                        )
                    }
                    Icon(
                        Icons.Default.Close,
                        stringResource(R.string.cancel),
                        tint = Color.White,
                        modifier = Modifier.clip(CircleShape).clickable(onClick = onClose).padding(10.dp),
                    )
                }
            }
            if (own) {
                Row(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .navigationBarsPadding()
                        .padding(bottom = 20.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color.Black.copy(alpha = 0.5f))
                        .clickable {
                            viewers = JSONArray()
                            scope.launch {
                                viewers = withContext(Dispatchers.IO) { runCatching { api.storyViews(story.id) }.getOrNull() } ?: JSONArray()
                            }
                        }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Visibility, stringResource(R.string.status_views), tint = Color.White, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("${story.views}", color = Color.White)
                }
            }
            val list = viewers
            if (list != null) {
                Column(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                        .background(Elevated)
                        .pointerInput(Unit) { detectTapGestures { } }
                        .navigationBarsPadding()
                        .padding(16.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${stringResource(R.string.status_views)} · ${list.length()}", color = Text, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Icon(Icons.Default.Close, null, tint = Muted, modifier = Modifier.clip(CircleShape).clickable { viewers = null }.padding(8.dp))
                    }
                    if (list.length() == 0) {
                        Text(stringResource(R.string.status_no_views), color = Muted, modifier = Modifier.padding(vertical = 20.dp).fillMaxWidth(), textAlign = TextAlign.Center)
                    }
                    LazyColumn {
                        items((0 until list.length()).toList()) { i ->
                            val v = list.optJSONObject(i)
                            val name = v?.optString("display_name").orEmpty()
                            Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                LetterAvatar(name, 40.dp)
                                Text(name, color = Text, modifier = Modifier.padding(start = 12.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun StoryComposer(api: SamalApi, onClose: () -> Unit, onPosted: () -> Unit) {
    val ctx = LocalContext.current
    var mode by remember { mutableStateOf("pick") }
    var text by remember { mutableStateOf("") }
    var bg by remember { mutableStateOf(STORY_BGS.first()) }
    var media by remember { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.status_failed)
    val tooBig = stringResource(R.string.status_too_big)
    val mime = media?.let { ctx.contentResolver.getType(it) }.orEmpty()
    val isVideo = mime.startsWith("video/")

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            media = uri
            mode = "media"
        }
    }

    fun publish() {
        busy = true
        error = null
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    if (mode == "text") {
                        api.postStory("text", text.trim(), bg = bg)
                    } else {
                        val uri = media ?: error("no media")
                        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("read")
                        if (bytes.size > MAX_UPLOAD) error("big")
                        val kind = if (isVideo) "video" else "photo"
                        val id = api.upload(bytes, mime.ifBlank { if (isVideo) "video/mp4" else "image/jpeg" }, kind)
                        api.postStory(kind, text.trim(), uploadId = id)
                    }
                }
            }
            busy = false
            if (ok.isSuccess) {
                onPosted()
                onClose()
            } else error = if (ok.exceptionOrNull()?.message == "big") tooBig else failed
        }
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = mode == "pick", decorFitsSystemWindows = false),
    ) {
        if (mode == "pick") {
            Column(Modifier.clip(RoundedCornerShape(20.dp)).background(Elevated).padding(16.dp).fillMaxWidth()) {
                Text(stringResource(R.string.add_status), color = Text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                PickRow(Icons.Default.Image, stringResource(R.string.status_photo)) {
                    pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                }
                PickRow(Icons.Default.TextFields, stringResource(R.string.status_text)) { mode = "text" }
                error?.let { Text(it, color = Color(0xFFFF4D6A), fontSize = 13.sp) }
            }
            return@Dialog
        }
        Box(Modifier.fillMaxSize().background(if (mode == "text") color(bg) else Color.Black)) {
            if (mode == "text") {
                TextField(
                    value = text,
                    onValueChange = { if (it.length <= 700) text = it },
                    placeholder = {
                        Text(stringResource(R.string.status_placeholder), color = Color.White.copy(alpha = 0.6f), fontSize = 26.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    },
                    textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
                    colors = clearField(),
                    modifier = Modifier.align(Alignment.Center).fillMaxWidth().padding(24.dp),
                )
            } else {
                val uri = media
                if (uri != null && isVideo) {
                    AndroidView(
                        factory = { c -> VideoView(c).apply { setVideoURI(uri); setOnPreparedListener { it.isLooping = true; start() } } },
                        modifier = Modifier.fillMaxSize(),
                        onRelease = { it.stopPlayback() },
                    )
                } else if (uri != null) {
                    AsyncImage(model = uri, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                }
            }
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Default.Close,
                    stringResource(R.string.cancel),
                    tint = Color.White,
                    modifier = Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.3f)).clickable(onClick = onClose).padding(10.dp),
                )
                Spacer(Modifier.weight(1f))
                if (mode == "text") {
                    STORY_BGS.forEach { c ->
                        Box(
                            Modifier
                                .padding(start = 6.dp)
                                .size(26.dp)
                                .clip(CircleShape)
                                .background(color(c))
                                .border(2.dp, if (c == bg) Color.White else Color.White.copy(alpha = 0.3f), CircleShape)
                                .clickable { bg = c },
                        )
                    }
                }
            }
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(12.dp)) {
                error?.let { Text(it, color = Color.White, modifier = Modifier.padding(bottom = 8.dp)) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (mode == "media") {
                        TextField(
                            value = text,
                            onValueChange = { if (it.length <= 300) text = it },
                            placeholder = { Text(stringResource(R.string.status_placeholder), color = Color.White.copy(alpha = 0.6f)) },
                            colors = clearField(),
                            singleLine = true,
                            modifier = Modifier.weight(1f).clip(RoundedCornerShape(24.dp)).background(Color.Black.copy(alpha = 0.5f)),
                        )
                        Spacer(Modifier.width(8.dp))
                    } else {
                        Spacer(Modifier.weight(1f))
                    }
                    val ready = !busy && (if (mode == "text") text.isNotBlank() else media != null)
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(24.dp))
                            .background(if (ready) Color.White else Color.White.copy(alpha = 0.5f))
                            .clickable(enabled = ready) { publish() }
                            .padding(horizontal = 20.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (busy) CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                        else Text(stringResource(R.string.status_publish), color = Color.Black, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun PickRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 10.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(Accent.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Accent)
        }
        Text(label, color = Text, modifier = Modifier.padding(start = 12.dp))
    }
}

@Composable
private fun clearField() = TextFieldDefaults.colors(
    focusedContainerColor = Color.Transparent,
    unfocusedContainerColor = Color.Transparent,
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    cursorColor = Color.White,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
)
