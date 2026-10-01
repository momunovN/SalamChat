package dev.samal.app.ui.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.media.MediaPlayer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URL
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipInputStream

private val imageExt = setOf("jpg", "jpeg", "png", "gif", "webp", "heic", "bmp")
private val videoExt = setOf("mp4", "mov", "m4v", "webm", "mkv")
private val textExt = setOf("txt", "md", "csv", "json", "log", "xml")
private val audioExt = setOf("mp3", "m4a", "aac", "ogg", "opus", "wav", "flac", "oga")
private val zipExt = setOf("docx", "xlsx", "pptx", "zip", "odt", "ods", "odp")

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
                else -> AnyFile(name.ifBlank { stringResource(R.string.file) }, url)
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
private fun ZoomBitmap(bitmap: ImageBitmap) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Image(
        bitmap,
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(bitmap) {
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
private fun AudioStage(path: String, name: String) {
    var fail by remember(path) { mutableStateOf(false) }
    var ready by remember(path) { mutableStateOf(false) }
    var playing by remember(path) { mutableStateOf(false) }
    val player = remember(path) { MediaPlayer() }
    DisposableEffect(path) {
        val alive = AtomicBoolean(true)
        player.setOnPreparedListener {
            if (!alive.get()) return@setOnPreparedListener
            ready = true
            playing = true
            it.start()
        }
        player.setOnCompletionListener {
            if (alive.get()) playing = false
        }
        player.setOnErrorListener { _, _, _ ->
            if (alive.get()) fail = true
            true
        }
        if (runCatching {
                player.setDataSource(path)
                player.prepareAsync()
            }.isFailure
        ) {
            fail = true
        }
        onDispose {
            alive.set(false)
            runCatching { player.reset() }
            player.release()
        }
    }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(name, color = Color.White, modifier = Modifier.padding(bottom = 20.dp))
        when {
            fail -> Text(stringResource(R.string.preview_fail), color = Color.White)
            !ready -> CircularProgressIndicator(color = Accent)
            else -> IconButton(
                onClick = {
                    runCatching {
                        if (player.isPlaying) {
                            player.pause()
                            playing = false
                        } else {
                            player.start()
                            playing = true
                        }
                    }
                },
                modifier = Modifier.size(72.dp),
            ) {
                Icon(
                    if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    null,
                    tint = Color.White,
                    modifier = Modifier.size(48.dp),
                )
            }
        }
    }
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
        busy -> StageWait()
        fail -> StageFail()
        pdf -> PdfList(pages)
        else -> DocText(body)
    }
}

@Composable
private fun AnyFile(name: String, url: String) {
    val ctx = LocalContext.current
    var view by remember(url) { mutableStateOf<Peek?>(null) }
    var fail by remember(url) { mutableStateOf(false) }
    LaunchedEffect(url, name) {
        val peeked = withContext(Dispatchers.IO) {
            runCatching {
                val file = materialize(ctx, url, name) ?: return@runCatching null
                sniff(file, name)
            }.getOrNull()
        }
        if (peeked == null) fail = true else view = peeked
    }
    val peeked = view
    when {
        peeked == null && !fail -> StageWait()
        peeked == null -> StageFail()
        peeked is Peek.Pdf -> PdfList(peeked.pages)
        peeked is Peek.Image -> ZoomBitmap(peeked.bitmap)
        peeked is Peek.Video -> VideoStage(peeked.path)
        peeked is Peek.Audio -> AudioStage(peeked.path, name)
        peeked is Peek.Text -> DocText(peeked.body)
        peeked is Peek.Bare -> BareFile(peeked.name)
    }
}

@Composable
private fun StageWait() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Accent)
    }
}

@Composable
private fun StageFail() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.preview_fail), color = Color.White)
    }
}

@Composable
private fun PdfList(pages: List<ImageBitmap>) {
    LazyColumn(Modifier.fillMaxSize().padding(top = 56.dp)) {
        items(pages) { page ->
            Image(
                page,
                contentDescription = null,
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                contentScale = ContentScale.FillWidth,
            )
        }
    }
}

@Composable
private fun DocText(body: String) {
    Text(
        body,
        color = Color.White,
        fontSize = 15.sp,
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 56.dp, bottom = 24.dp),
    )
}

@Composable
private fun BareFile(name: String) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Default.Description, null, tint = Color.White, modifier = Modifier.size(48.dp))
        Text(name, color = Color.White, modifier = Modifier.padding(top = 16.dp))
    }
}

private sealed interface Peek {
    data class Pdf(val pages: List<ImageBitmap>) : Peek
    data class Image(val bitmap: ImageBitmap) : Peek
    data class Video(val path: String) : Peek
    data class Audio(val path: String) : Peek
    data class Text(val body: String) : Peek
    data class Bare(val name: String) : Peek
}

private fun sniff(file: File, name: String): Peek {
    val head = headOf(file)
    val ext = extOf(name).ifBlank { extOf(file.name) }
    if (hasAscii(head, "%PDF") || ext == "pdf") {
        val pages = runCatching { renderPdf(file) }.getOrDefault(emptyList())
        if (pages.isNotEmpty()) return Peek.Pdf(pages)
    }
    if (imageMagic(head, ext)) {
        val bmp = runCatching { decodeImage(file) }.getOrNull()
        if (bmp != null) return Peek.Image(bmp.asImageBitmap())
    }
    if (audioMagic(head, ext)) return Peek.Audio(file.absolutePath)
    if (videoMagic(head, ext)) return Peek.Video(file.absolutePath)
    if (zipMagic(head) || ext in zipExt) {
        val body = zipPreview(file)
        if (body.isNotBlank()) return Peek.Text(body)
    }
    if (ext == "rtf" || hasAscii(head, "{\\rtf") || looksText(file)) {
        val body = textPreview(file, ext)
        if (body.isNotBlank()) return Peek.Text(body)
    }
    return Peek.Bare(name.ifBlank { file.name })
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

private fun decodeImage(file: File): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / sample > 2000 || bounds.outHeight / sample > 2000) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeFile(file.absolutePath, opts)
}

private fun readText(file: File): String {
    return file.inputStream().bufferedReader(Charsets.UTF_8).use { it.readText() }.take(200_000)
}

private fun textPreview(file: File, ext: String): String {
    val raw = runCatching { readText(file) }.getOrDefault("")
    if (raw.isBlank()) return ""
    if (ext == "rtf" || raw.trimStart().startsWith("{\\rtf")) return rtfToText(raw)
    return raw
}

private fun headOf(file: File, n: Int = 64): ByteArray {
    return file.inputStream().use { input ->
        val buf = ByteArray(n)
        val got = input.read(buf)
        if (got <= 0) ByteArray(0) else buf.copyOf(got)
    }
}

private fun hasAscii(head: ByteArray, text: String, offset: Int = 0): Boolean {
    val raw = text.toByteArray(Charsets.US_ASCII)
    if (offset < 0 || head.size < offset + raw.size) return false
    for (i in raw.indices) if (head[offset + i] != raw[i]) return false
    return true
}

private fun brand(head: ByteArray): String {
    if (head.size < 12) return ""
    return String(head, 8, 4, Charsets.US_ASCII).lowercase()
}

private fun heifMagic(head: ByteArray): Boolean {
    if (!hasAscii(head, "ftyp", 4)) return false
    val mark = brand(head)
    return mark.startsWith("hei") || mark == "mif1" || mark == "msf1"
}

private fun imageMagic(head: ByteArray, ext: String): Boolean {
    if (head.size >= 3 && head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() && head[2] == 0xFF.toByte()) return true
    if (head.size >= 4 && head[0] == 0x89.toByte() && head[1] == 0x50.toByte() && head[2] == 0x4E.toByte() && head[3] == 0x47.toByte()) return true
    if (hasAscii(head, "GIF8") || hasAscii(head, "BM")) return true
    if (hasAscii(head, "RIFF") && hasAscii(head, "WEBP", 8)) return true
    if (heifMagic(head)) return true
    return ext in imageExt
}

private fun audioMagic(head: ByteArray, ext: String): Boolean {
    if (heifMagic(head) || zipMagic(head)) return false
    if (hasAscii(head, "ID3") || hasAscii(head, "fLaC") || hasAscii(head, "OggS")) return true
    if (hasAscii(head, "RIFF") && hasAscii(head, "WAVE", 8)) return true
    if (hasAscii(head, "ftyp", 4) && (brand(head).startsWith("m4a") || ext == "m4a" || ext == "aac")) return true
    if (head.size >= 2 && head[0] == 0xFF.toByte() && (head[1].toInt() and 0xFF and 0xE0) == 0xE0 && ext == "mp3") return true
    return ext in audioExt
}

private fun videoMagic(head: ByteArray, ext: String): Boolean {
    if (heifMagic(head) || audioMagic(head, ext)) return false
    if (hasAscii(head, "ftyp", 4)) return true
    if (head.size >= 4 && head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() && head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte()) return true
    return ext in videoExt
}

private fun zipMagic(head: ByteArray): Boolean {
    return head.size >= 4 && head[0] == 0x50.toByte() && head[1] == 0x4B.toByte() &&
        (head[2] == 0x03.toByte() || head[2] == 0x05.toByte() || head[2] == 0x07.toByte())
}

private fun looksText(file: File): Boolean {
    val buf = ByteArray(4096)
    val n = file.inputStream().use { it.read(buf) }
    if (n <= 0) return false
    var controls = 0
    for (i in 0 until n) {
        val b = buf[i].toInt() and 0xFF
        if (b == 0) return false
        if (b < 9 || b in 14..31) controls++
    }
    return controls * 20 < n
}

private fun rtfToText(raw: String): String {
    val hex = Regex("""\\'([0-9a-fA-F]{2})""")
    val unicode = Regex("""\\u(-?\d+)\??""")
    var text = raw.replace(Regex("""\\par[d]?"""), "\n")
    text = hex.replace(text) { it.groupValues[1].toInt(16).toChar().toString() }
    text = unicode.replace(text) { match ->
        var code = match.groupValues[1].toInt()
        if (code < 0) code += 65536
        code.toChar().toString()
    }
    return text
        .replace(Regex("""\\[a-zA-Z]+-?\d* ?"""), "")
        .replace("{", "")
        .replace("}", "")
        .replace(Regex("""\n{3,}"""), "\n\n")
        .trim()
}

private fun xmlToText(xml: String): String {
    return xml
        .replace(Regex("""(?i)</w:p>|<w:br\s*/?>|</a:p>|<a:br\s*/?>|</si>|<br\s*/?>"""), "\n")
        .replace(Regex("<[^>]+>"), "")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#10;", "\n")
        .replace(Regex("""[ \t]*\n"""), "\n")
        .replace(Regex("""\n{3,}"""), "\n\n")
        .trim()
}

private fun slideNumber(path: String): Int? {
    if (!path.startsWith("ppt/slides/slide") || !path.endsWith(".xml")) return null
    return path.removePrefix("ppt/slides/slide").removeSuffix(".xml").toIntOrNull()
}

private fun readCapped(input: java.io.InputStream, cap: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    var total = 0
    while (total < cap) {
        val n = input.read(buf, 0, minOf(buf.size, cap - total))
        if (n < 0) break
        out.write(buf, 0, n)
        total += n
    }
    return out.toByteArray()
}

private fun zipPreview(file: File): String {
    val parts = ArrayList<String>()
    val slides = ArrayList<Pair<Int, String>>()
    val names = ArrayList<String>()
    try {
        ZipInputStream(file.inputStream().buffered()).use { zip ->
            var seen = 0
            while (seen < 500) {
                val entry = zip.nextEntry ?: break
                seen++
                val path = entry.name.replace('\\', '/').lowercase()
                val display = entry.name.replace('\\', '/')
                if (!entry.isDirectory && names.size < 200 && !display.contains("__MACOSX/") && !display.endsWith(".DS_Store")) {
                    names.add(display)
                }
                val slide = slideNumber(path)
                val wanted = path == "word/document.xml" || path == "xl/sharedstrings.xml" || path == "content.xml" || slide != null
                if (wanted) {
                    val plain = xmlToText(readCapped(zip, 1_500_000).toString(Charsets.UTF_8))
                    if (plain.isNotBlank()) {
                        if (slide != null) slides.add(slide to plain) else parts.add(plain)
                    }
                }
                zip.closeEntry()
            }
        }
    } catch (_: Exception) {
        return names.joinToString("\n")
    }
    slides.sortBy { it.first }
    val body = (parts + slides.map { it.second }).joinToString("\n\n").trim()
    if (body.isNotEmpty()) return body.take(200_000)
    return names.joinToString("\n")
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
