package dev.samal.app.ui.chat

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import dev.samal.app.R
import dev.samal.app.ui.theme.Accent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL
import java.util.UUID

private val imageExt = setOf("jpg", "jpeg", "png", "gif", "webp", "heic", "bmp")
private val videoExt = setOf("mp4", "mov", "m4v", "webm", "mkv")
private val textExt = setOf("txt", "md", "csv", "json", "log", "xml")

internal fun openKind(type: String, text: String, url: String, deleted: Boolean): String? {
    if (deleted || url.isBlank()) return null
    if (type == "photo") return "image"
    if (type == "voice" || type == "location" || type == "text") return null
    val ext = extOf(text).ifBlank { extOf(url.substringBefore('?')) }
    return when (ext) {
        in imageExt -> "image"
        in videoExt -> "video"
        "pdf" -> "pdf"
        in textExt -> "text"
        else -> if (type == "file" || type == "video") "file" else null
    }
}

internal fun coilModel(url: String): Any {
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("content:") || url.startsWith("file:")) {
        return url
    }
    val file = File(url)
    return if (file.exists()) file else url
}

@Composable
internal fun MediaStage(url: String, name: String, kind: String, onClose: () -> Unit) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            when (kind) {
                "image" -> ZoomImage(url)
                "video" -> VideoStage(url)
                "pdf" -> PagedDoc(url, name, pdf = true)
                "text" -> PagedDoc(url, name, pdf = false)
                else -> ExternalFile(name.ifBlank { stringResource(R.string.file) }, url)
            }
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopStart).padding(8.dp)) {
                Icon(Icons.Default.Close, stringResource(R.string.cancel), tint = Color.White)
            }
        }
    }
}

@Composable
private fun ZoomImage(url: String) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    AsyncImage(
        model = coilModel(url),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(url) {
                detectTransformGestures { _, pan, zoom, _ ->
                    val next = (scale * zoom).coerceIn(1f, 5f)
                    scale = next
                    offset = if (next == 1f) Offset.Zero else offset + pan
                }
            }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
    )
}

@Composable
private fun VideoStage(url: String) {
    val ctx = LocalContext.current
    val uri = remember(url) { mediaUri(ctx, url) }
    AndroidView(
        factory = { context ->
            VideoView(context).apply {
                setVideoURI(uri)
                setOnPreparedListener { player ->
                    player.isLooping = false
                    start()
                }
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun PagedDoc(url: String, name: String, pdf: Boolean) {
    val ctx = LocalContext.current
    var pages by remember(url) { mutableStateOf<List<ImageBitmap>>(emptyList()) }
    var body by remember(url) { mutableStateOf("") }
    var fail by remember(url) { mutableStateOf(false) }
    var busy by remember(url) { mutableStateOf(true) }
    LaunchedEffect(url, pdf) {
        val file = withContext(Dispatchers.IO) { runCatching { materialize(ctx, url, name) }.getOrNull() }
        if (file == null) {
            fail = true
            busy = false
            return@LaunchedEffect
        }
        if (pdf) {
            val rendered = withContext(Dispatchers.IO) { runCatching { renderPdf(file) }.getOrDefault(emptyList()) }
            pages = rendered
            fail = rendered.isEmpty()
        } else {
            body = withContext(Dispatchers.IO) { runCatching { readText(file) }.getOrDefault("") }
            fail = body.isBlank()
        }
        busy = false
    }
    when {
        busy -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Accent)
        }
        fail -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.preview_fail), color = Color.White)
        }
        pdf -> LazyColumn(Modifier.fillMaxSize().padding(top = 56.dp)) {
            items(pages) { page ->
                Image(
                    page,
                    contentDescription = null,
                    modifier = Modifier.fillMaxWidth().padding(8.dp),
                    contentScale = ContentScale.FillWidth,
                )
            }
        }
        else -> Text(
            body,
            color = Color.White,
            fontSize = 15.sp,
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 56.dp, bottom = 24.dp),
        )
    }
}

@Composable
private fun ExternalFile(name: String, url: String) {
    val ctx = LocalContext.current
    var fail by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Default.Description, null, tint = Color.White, modifier = Modifier.size(48.dp))
        Text(name, color = Color.White, modifier = Modifier.padding(top = 16.dp, bottom = 20.dp))
        Text(
            stringResource(R.string.open_file),
            color = Color.White,
            modifier = Modifier
                .clip(RoundedCornerShape(20.dp))
                .background(Accent)
                .clickable {
                    fail = !runCatching { openOutside(ctx, url, name) }.isSuccess
                }
                .padding(horizontal = 20.dp, vertical = 10.dp),
        )
        if (fail) Text(stringResource(R.string.preview_fail), color = Color.White, modifier = Modifier.padding(top = 12.dp))
    }
}

private fun extOf(raw: String): String {
    val clean = raw.substringAfterLast('/', raw).substringBefore('?').substringBefore('#')
    val dot = clean.lastIndexOf('.')
    if (dot < 0 || dot == clean.length - 1) return ""
    return clean.substring(dot + 1).lowercase()
}

private fun materialize(ctx: Context, url: String, name: String): File? {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        val path = if (url.startsWith("file:")) Uri.parse(url).path ?: return null else url
        val file = File(path)
        return file.takeIf { it.exists() && it.isFile }
    }
    val ext = extOf(name).ifBlank { extOf(url) }
    val dest = File(ctx.cacheDir, "view/${UUID.randomUUID()}${if (ext.isEmpty()) "" else ".$ext"}")
    dest.parentFile?.mkdirs()
    val conn = URL(url).openConnection()
    conn.connectTimeout = 20_000
    conn.readTimeout = 20_000
    conn.getInputStream().use { input -> dest.outputStream().use { input.copyTo(it) } }
    return dest.takeIf { it.length() > 0 }
}

private fun renderPdf(file: File): List<ImageBitmap> {
    val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    val renderer = PdfRenderer(pfd)
    try {
        val count = renderer.pageCount.coerceAtMost(40)
        val out = ArrayList<ImageBitmap>(count)
        for (i in 0 until count) {
            renderer.openPage(i).use { page ->
                val w = page.width.coerceAtLeast(1)
                val h = page.height.coerceAtLeast(1)
                val scale = (1080f / w).coerceAtMost(2f)
                val bw = (w * scale).toInt().coerceAtLeast(1)
                val bh = (h * scale).toInt().coerceAtLeast(1)
                val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
                bmp.eraseColor(android.graphics.Color.WHITE)
                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                out.add(bmp.asImageBitmap())
            }
        }
        return out
    } finally {
        renderer.close()
        pfd.close()
    }
}

private fun readText(file: File): String {
    return file.inputStream().bufferedReader(Charsets.UTF_8).use { it.readText() }.take(200_000)
}

internal fun mediaUri(ctx: Context, url: String): Uri {
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("content:")) {
        return Uri.parse(url)
    }
    val path = if (url.startsWith("file:")) Uri.parse(url).path ?: url else url
    val file = File(path)
    return runCatching {
        FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", file)
    }.getOrElse { Uri.fromFile(file) }
}

private fun mimeFor(name: String, url: String): String {
    return when (extOf(name).ifBlank { extOf(url) }) {
        "pdf" -> "application/pdf"
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "mp4" -> "video/mp4"
        "mov" -> "video/quicktime"
        "webm" -> "video/webm"
        "txt", "md", "log", "csv" -> "text/plain"
        "json" -> "application/json"
        "xml" -> "text/xml"
        else -> "*/*"
    }
}

private fun openOutside(ctx: Context, url: String, name: String) {
    val uri = mediaUri(ctx, url)
    val mime = mimeFor(name, url)
    val intent = Intent(Intent.ACTION_VIEW).apply {
        if (mime == "*/*") setData(uri) else setDataAndType(uri, mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
        ctx.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        throw ActivityNotFoundException()
    }
}
