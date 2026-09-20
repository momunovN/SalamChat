package dev.samal.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Bg = Color(0xFF0B0D10)
val Elevated = Color(0xFF14181E)
val Accent = Color(0xFF2B6BFF)
val Incoming = Color(0xFF1B212B)
val Outgoing = Color(0xFF2B6BFF)
val Text = Color(0xFFF4F6F8)
val Muted = Color(0xFF8B95A5)
val Success = Color(0xFF3DDC97)
val Danger = Color(0xFFFF4D6A)

private val scheme = darkColorScheme(
    primary = Accent,
    background = Bg,
    surface = Elevated,
    onPrimary = Color.White,
    onBackground = Text,
    onSurface = Text,
    error = Danger,
)

@Composable
fun SamalTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}
