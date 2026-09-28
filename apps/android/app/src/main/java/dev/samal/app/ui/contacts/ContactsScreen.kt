package dev.samal.app.ui.contacts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.R
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.ChatEntity
import dev.samal.app.data.db.SamalDao
import dev.samal.app.data.sync.chatEntity
import dev.samal.app.ui.theme.Accent
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.SalamLogo
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class ContactRow(val id: String, val title: String, val sub: String)

private fun people(arr: JSONArray, me: String): List<ContactRow> =
    (0 until arr.length()).mapNotNull { i ->
        val o = arr.getJSONObject(i)
        if (o.optString("id") == me) return@mapNotNull null
        person(o)
    }

private fun person(o: JSONObject): ContactRow {
    val nick = o.optString("username")
    val name = o.optString("book_name").ifBlank { o.optString("display_name") }
    val sub = listOfNotNull(
        nick.takeIf { it.isNotBlank() }?.let { "@$it" },
        o.optString("phone").takeIf { it.isNotBlank() },
    ).joinToString(" · ")
    return ContactRow(o.getString("id"), name.ifBlank { sub }, sub)
}

@Composable
fun ContactsScreen(api: SamalApi, dao: SamalDao, me: String, onOpen: (ChatEntity) -> Unit) {
    var book by remember { mutableStateOf(listOf<ContactRow>()) }
    var found by remember { mutableStateOf(listOf<ContactRow>()) }
    var q by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        book = withContext(Dispatchers.IO) {
            runCatching { people(api.contacts(), me) }.getOrDefault(emptyList())
        }
    }
    LaunchedEffect(q) {
        val query = q.trim()
        if (query.isEmpty()) {
            found = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        found = withContext(Dispatchers.IO) {
            runCatching { people(api.users(query), me) }.getOrDefault(emptyList())
        }
    }
    val rows = if (q.isBlank()) book else found
    Column(Modifier.fillMaxSize().background(Bg).padding(top = 8.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            SalamLogo(36.dp)
            Text(
                stringResource(R.string.tab_contacts),
                color = Text,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 10.dp),
            )
        }
        TextField(
            value = q,
            onValueChange = { q = it },
            placeholder = { Text(stringResource(R.string.search_people), color = Muted) },
            singleLine = true,
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp)),
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
        when {
            rows.isEmpty() && q.isBlank() -> Text(
                stringResource(R.string.sync_hint),
                color = Muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(16.dp),
            )
            rows.isEmpty() -> Text(
                stringResource(R.string.people_empty),
                color = Muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(16.dp),
            )
            else -> LazyColumn(Modifier.padding(top = 8.dp)) {
                items(rows, key = { it.id }) { row ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(64.dp)
                            .clickable {
                                scope.launch {
                                    val chat = withContext(Dispatchers.IO) {
                                        runCatching { chatEntity(api.direct(row.id)) }.getOrNull()
                                    } ?: return@launch
                                    dao.upsertChats(listOf(chat))
                                    onOpen(chat)
                                }
                            }
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .clip(CircleShape)
                                .background(Elevated)
                                .padding(12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(row.title.take(1).uppercase(), color = Text, fontWeight = FontWeight.SemiBold)
                        }
                        Column(Modifier.padding(start = 12.dp)) {
                            Text(row.title, color = Text, fontWeight = FontWeight.SemiBold)
                            Text(row.sub, color = Muted, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}
