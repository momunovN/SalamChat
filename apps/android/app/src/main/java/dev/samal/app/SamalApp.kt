package dev.samal.app

import android.app.Application
import androidx.room.Room
import coil.ImageLoader
import coil.ImageLoaderFactory
import dev.samal.app.data.api.MediaAuth
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.MIGRATION_1_2
import dev.samal.app.data.db.MIGRATION_2_3
import dev.samal.app.data.db.MIGRATION_3_4
import dev.samal.app.data.db.MIGRATION_4_5
import dev.samal.app.data.db.SamalDb
import dev.samal.app.data.notify.Push
import dev.samal.app.data.session.SessionStore
import dev.samal.app.data.sync.InboxService

class SamalApp : Application(), ImageLoaderFactory {
    lateinit var db: SamalDb
        private set
    val api = SamalApi()
    lateinit var session: SessionStore
        private set

    override fun onCreate() {
        super.onCreate()
        db = Room.databaseBuilder(this, SamalDb::class.java, "samal.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
            .build()
        session = SessionStore(this, api)
        MediaAuth.init(this, api)
        if (BuildConfig.DEBUG) {
            // Full LiveKit/WebRTC logs in logcat for test builds (adb logcat -s LiveKit).
            io.livekit.android.LiveKit.loggingLevel = io.livekit.android.util.LoggingLevel.DEBUG
        }
        Push.init(this)
        if (session.isLoggedIn) InboxService.start(this)
        Push.sync(this)
    }

    override fun newImageLoader(): ImageLoader = MediaAuth.imageLoader(this)
}
