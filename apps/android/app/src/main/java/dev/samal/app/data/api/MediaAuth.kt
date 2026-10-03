package dev.samal.app.data.api

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import coil.ImageLoader
import okhttp3.OkHttpClient
import java.net.URLConnection

/**
 * The server only serves /media to signed-in users, so every image, voice note and file we
 * fetch from our own host carries the session's bearer token.
 */
object MediaAuth {
    @Volatile
    private var api: SamalApi? = null
    @Volatile
    private var app: Context? = null

    fun init(context: Context, api: SamalApi) {
        this.app = context.applicationContext
        this.api = api
    }

    private fun ours(url: String): Boolean {
        val base = api?.base ?: return false
        val host = runCatching { Uri.parse(base).host }.getOrNull() ?: return false
        return runCatching { Uri.parse(url).host }.getOrNull().equals(host, ignoreCase = true)
    }

    fun headers(url: String): Map<String, String> {
        val token = api?.token
        if (token.isNullOrBlank() || !ours(url)) return emptyMap()
        return mapOf("Authorization" to "Bearer $token")
    }

    fun setSource(player: MediaPlayer, url: String) {
        val ctx = app
        val headers = headers(url)
        if (ctx == null || headers.isEmpty()) player.setDataSource(url)
        else player.setDataSource(ctx, Uri.parse(url), headers)
    }

    fun authorize(conn: URLConnection) {
        headers(conn.url.toString()).forEach { (k, v) -> conn.setRequestProperty(k, v) }
    }

    /** Coil's loader: adds the token, and on 401 refreshes the session once and retries. */
    fun imageLoader(context: Context): ImageLoader {
        val http = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val req = chain.request()
                val used = api?.token
                val headers = headers(req.url.toString())
                if (headers.isEmpty()) return@addInterceptor chain.proceed(req)
                val authed = req.newBuilder().apply { headers.forEach { (k, v) -> header(k, v) } }.build()
                val resp = chain.proceed(authed)
                if (resp.code != 401 || api?.refresh(used) != true) return@addInterceptor resp
                resp.close()
                val again = req.newBuilder().apply { headers(req.url.toString()).forEach { (k, v) -> header(k, v) } }.build()
                chain.proceed(again)
            }
            .build()
        return ImageLoader.Builder(context).okHttpClient(http).build()
    }
}
