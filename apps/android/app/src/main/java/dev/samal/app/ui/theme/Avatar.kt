package dev.samal.app.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Same palette and hash as the website, so a person has one color on every device. */
private val FILLS = listOf(
    Color(0xFF3B82F6) to Color(0xFF1D4ED8),
    Color(0xFF22C55E) to Color(0xFF15803D),
    Color(0xFFF59E0B) to Color(0xFFC2410C),
    Color(0xFFEC4899) to Color(0xFFBE185D),
    Color(0xFF8B5CF6) to Color(0xFF6D28D9),
    Color(0xFF06B6D4) to Color(0xFF0E7490),
    Color(0xFFEF4444) to Color(0xFFB91C1C),
    Color(0xFF14B8A6) to Color(0xFF0F766E),
)

private fun fillFor(name: String): Pair<Color, Color> {
    var h = 0
    var i = 0
    val s = name.ifBlank { "?" }
    while (i < s.length) {
        val cp = s.codePointAt(i)
        h = h * 31 + cp
        i += Character.charCount(cp)
    }
    return FILLS[Math.floorMod(kotlin.math.abs(h), FILLS.size)]
}

/** Author name color in group chats, matching that person's avatar. */
fun nameColor(name: String): Color = fillFor(name).first

private fun initial(name: String): String {
    val s = name.trim()
    var i = 0
    while (i < s.length) {
        val cp = s.codePointAt(i)
        if (Character.isLetterOrDigit(cp)) return String(Character.toChars(cp)).uppercase()
        i += Character.charCount(cp)
    }
    return "?"
}

@Composable
fun LetterAvatar(name: String, size: Dp, modifier: Modifier = Modifier) {
    val (from, to) = fillFor(name)
    Box(
        modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(from, to))),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial(name), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size.value * 0.4f).sp)
    }
}
