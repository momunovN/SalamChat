package dev.samal.app.data.sync

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import dev.samal.app.data.notify.Notifier

/**
 * Keeps the microphone (and camera for video) alive while a call runs with the app in the
 * background. Without a foreground service of these types Android 11+ cuts capture as soon
 * as the user leaves the app, so the peer stops hearing them mid-call.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE).orEmpty()
        val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) == true
        val note = Notifier.inCall(this, title)
        val started = runCatching {
            if (Build.VERSION.SDK_INT >= 30) {
                var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                if (video) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                startForeground(NOTE_ID, note, type)
            } else {
                startForeground(NOTE_ID, note)
            }
        }
        if (started.isFailure) stopSelf()
        return START_NOT_STICKY
    }

    companion object {
        private const val NOTE_ID = 43
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_VIDEO = "video"

        fun start(ctx: Context, title: String, video: Boolean) {
            val app = ctx.applicationContext
            val intent = Intent(app, CallService::class.java)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_VIDEO, video)
            runCatching { ContextCompat.startForegroundService(app, intent) }
        }

        fun stop(ctx: Context) {
            val app = ctx.applicationContext
            runCatching { app.stopService(Intent(app, CallService::class.java)) }
        }
    }
}
