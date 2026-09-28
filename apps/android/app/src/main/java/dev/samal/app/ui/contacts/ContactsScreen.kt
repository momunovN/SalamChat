package dev.samal.app.ui.contacts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.samal.app.R
import dev.samal.app.data.api.SamalApi
import dev.samal.app.ui.theme.Bg
import dev.samal.app.ui.theme.Elevated
import dev.samal.app.ui.theme.SalamLogo
import dev.samal.app.ui.theme.Muted
import dev.samal.app.ui.theme.Text
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ContactRow(val id: String, val title: String, val sub: String)

@Composable
fun ContactsScreen(api: SamalApi, onOpen: (String) -> Unit) {
    var rows by remember { mutableStateOf(listOf<ContactRow>()) }
    LaunchedEffect(Unit) {
        rows = withContext(Dispatchers.IO) {
            val arr = api.contacts()
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val nick = o.optString("username")
                val book = o.optString("book_name")
                val name = book.ifBlank { o.optString("display_name") }
                val sub = buildString {
                    if (nick.isNotBlank()) append("@$nick")
                    if (isNotEmpty()) append(" · ")
                    append(o.optString("phone"))
                }
                ContactRow(o.getString("id"), name, sub)
            }
        }
    }
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
        if (rows.isEmpty()) {
            Text(
                stringResource(R.string.sync_hint),
                color = Muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(16.dp),
            )
        } else {
            LazyColumn {
                items(rows, key = { it.id }) { row ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(64.dp)
                            .clickable { onOpen(row.id) }
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        androidx.compose.foundation.layout.Box(
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
