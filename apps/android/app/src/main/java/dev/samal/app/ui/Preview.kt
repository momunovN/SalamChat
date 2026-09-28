package dev.samal.app.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import dev.samal.app.R

fun previewLabel(ctx: Context, raw: String): String {
    if (!raw.startsWith("\u001F")) return raw
    val key = raw.removePrefix("\u001F")
    val id = when (key) {
        "photo" -> R.string.photo
        "video" -> R.string.video
        "file" -> R.string.file
        "voice" -> R.string.voice
        "location" -> R.string.geo
        "deleted" -> R.string.deleted
        else -> 0
    }
    return if (id == 0) key else ctx.getString(id)
}

@Composable
fun previewLabel(raw: String): String {
    if (!raw.startsWith("\u001F")) return raw
    val key = raw.removePrefix("\u001F")
    val id = when (key) {
        "photo" -> R.string.photo
        "video" -> R.string.video
        "file" -> R.string.file
        "voice" -> R.string.voice
        "location" -> R.string.geo
        "deleted" -> R.string.deleted
        else -> 0
    }
    return if (id == 0) key else stringResource(id)
}
