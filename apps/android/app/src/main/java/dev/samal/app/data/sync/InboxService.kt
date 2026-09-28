package dev.samal.app.data.sync

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import dev.samal.app.SamalApp
import dev.samal.app.data.notify.Notifier

class InboxService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val note = Notifier.ongoing(this)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(41, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(41, note)
        }
        val app = application as SamalApp
        Hub.ensure(app)
        return START_STICKY
    }

    override fun onDestroy() {
        if (!Hub.keep) Hub.stop()
        super.onDestroy()
    }

    companion object {
        fun start(ctx: Context) {
            val app = ctx.applicationContext
            val intent = Intent(app, InboxService::class.java)
            runCatching { ContextCompat.startForegroundService(app, intent) }
                .onFailure { (app as? SamalApp)?.let { Hub.ensure(it) } }
        }

        fun stop(ctx: Context) {
            Hub.keep = false
            Hub.stop()
            ctx.applicationContext.stopService(Intent(ctx.applicationContext, InboxService::class.java))
        }
    }
}

object Hub {
    var keep: Boolean = true
    private var inbox: Inbox? = null

    fun ensure(app: SamalApp) {
        keep = true
        if (inbox != null) return
        inbox = Inbox(app, app.api, app.db.dao(), app.session).also { it.start() }
    }

    fun stop() {
        inbox?.stop()
        inbox = null
    }
}
