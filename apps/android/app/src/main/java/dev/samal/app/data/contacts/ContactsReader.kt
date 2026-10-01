package dev.samal.app.data.contacts

import android.content.Context
import android.provider.ContactsContract

data class BookContact(val phone: String, val name: String)

fun readBookContacts(context: Context): List<BookContact> {
    val out = ArrayList<BookContact>()
    val cr = context.contentResolver
    cr.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        arrayOf(
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
        ),
        null,
        null,
        null,
    )?.use { c ->
        val iPhone = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
        val iName = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
        while (c.moveToNext()) {
            val phone = if (iPhone >= 0) c.getString(iPhone) else null
            if (phone.isNullOrBlank()) continue
            val name = if (iName >= 0) c.getString(iName).orEmpty() else ""
            out.add(BookContact(phone, name))
        }
    }
    return out
}

fun needsDisplayName(name: String): Boolean {
    val n = name.trim()
    if (n.isEmpty() || n == "TooApp" || n == "Salam") return true
    if (Regex("^[•·.\\-\\s]*\\d{2,8}$").matches(n)) return true
    if (n.none { it.isLetter() }) return true
    return false
}

fun sanitizeUsername(raw: String): String? {
    val s = raw.trim().removePrefix("@").lowercase()
    if (s.isEmpty()) return ""
    if (!Regex("^[a-z][a-z0-9_]{2,23}$").matches(s)) return null
    return s
}
