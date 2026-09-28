package dev.samal.app.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.R
import dev.samal.app.data.session.SessionStore
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.SalamLogo
import dev.samal.app.ui.theme.Danger
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Success
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PhoneAuthScreen(session: SessionStore) {
    var cc by remember { mutableStateOf("996") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("+996") }
    var code by remember { mutableStateOf("") }
    var step by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf<String?>(null) }
    var hintError by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val errEmail = stringResource(R.string.auth_err_email)

    fun skippedPhone(value: String): Boolean {
        val digits = value.filter(Char::isDigit)
        return digits.isEmpty() || digits == "996" || digits == "7"
    }

    fun go() {
        if (busy) return
        if (step == 0 && !email.contains("@")) {
            hint = errEmail
            hintError = true
            return
        }
        busy = true
        hint = null
        scope.launch {
            try {
                val sentPhone = if (skippedPhone(phone)) "" else phone
                if (step == 0) {
                    val dev = session.requestOtp(email.trim(), sentPhone)
                    hint = dev ?: email.trim()
                    hintError = false
                    step = 1
                } else {
                    session.login(email.trim(), sentPhone, code)
                }
            } catch (e: Exception) {
                hint = e.message
                hintError = true
            } finally {
                busy = false
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
    Column(
        Modifier
            .align(Alignment.TopCenter)
            .widthIn(max = 480.dp)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        SalamLogo(72.dp)
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(R.string.app_name),
            color = Text,
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            stringResource(if (step == 0) R.string.auth_phone_title else R.string.auth_otp_title),
            color = Text,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(if (step == 0) R.string.auth_phone_subtitle else R.string.auth_otp_subtitle),
            color = Muted,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(16.dp))
        if (step == 0) {
            AuthField(
                value = email,
                onValueChange = { email = it },
                keyboard = KeyboardType.Email,
                onGo = ::go,
                placeholder = stringResource(R.string.auth_email_hint),
            )
            Spacer(Modifier.height(14.dp))
            Text(
                stringResource(R.string.auth_phone_optional),
                color = Muted,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CountryChip(
                    label = stringResource(R.string.auth_country_kg),
                    selected = cc == "996",
                    onClick = {
                        cc = "996"
                        phone = "+996" + phone.removePrefix("+996").removePrefix("+7")
                    },
                )
                CountryChip(
                    label = stringResource(R.string.auth_country_ru),
                    selected = cc == "7",
                    onClick = {
                        cc = "7"
                        phone = "+7" + phone.removePrefix("+996").removePrefix("+7")
                    },
                )
            }
            Spacer(Modifier.height(12.dp))
            AuthField(
                value = phone,
                onValueChange = { phone = it },
                keyboard = KeyboardType.Phone,
                onGo = ::go,
            )
        } else {
            AuthField(
                value = code,
                onValueChange = { code = it.filter(Char::isDigit).take(6) },
                keyboard = KeyboardType.Number,
                onGo = ::go,
            )
        }
        hint?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = if (hintError) Danger else Success, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        }
        Spacer(Modifier.height(16.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Accent.copy(alpha = if (busy) 0.6f else 1f))
                .clickable(enabled = !busy, onClick = ::go),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                stringResource(R.string.auth_continue),
                color = Color.White,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(Modifier.height(24.dp))
    }
    }
}

@Composable
private fun CountryChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) Accent else Elevated)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, color = Text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
internal fun AuthField(
    value: String,
    onValueChange: (String) -> Unit,
    keyboard: KeyboardType,
    onGo: () -> Unit,
    placeholder: String = "",
) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = {
            if (placeholder.isNotEmpty()) Text(placeholder, color = Muted)
        },
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp)),
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onGo() }),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Elevated,
            unfocusedContainerColor = Elevated,
            focusedTextColor = Text,
            unfocusedTextColor = Text,
            cursorColor = Accent,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
        ),
    )
}
