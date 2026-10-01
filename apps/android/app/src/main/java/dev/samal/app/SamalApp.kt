package dev.samal.app

import android.app.Application
import androidx.room.Room
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.MIGRATION_1_2
import dev.samal.app.data.db.MIGRATION_2_3
import dev.samal.app.data.db.MIGRATION_3_4
import dev.samal.app.data.db.SamalDb
import dev.samal.app.data.session.SessionStore
import dev.samal.app.data.sync.InboxService

class SamalApp : Application() {
    lateinit var db: SamalDb
        private set
    val api = SamalApi()
    lateinit var session: SessionStore
        private set

    override fun onCreate() {
        super.onCreate()
        db = Room.databaseBuilder(this, SamalDb::class.java, "samal.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
            .build()
        session = SessionStore(this, api)
        if (session.isLoggedIn) InboxService.start(this)
    }
}
