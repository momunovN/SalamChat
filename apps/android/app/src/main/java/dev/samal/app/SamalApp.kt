package dev.samal.app

import android.app.Application
import androidx.room.Room
import dev.samal.app.data.api.SamalApi
import dev.samal.app.data.db.SamalDb
import dev.samal.app.data.session.SessionStore
import dev.samal.app.data.sync.Inbox

class SamalApp : Application() {
    lateinit var db: SamalDb
        private set
    val api = SamalApi()
    lateinit var session: SessionStore
        private set

    override fun onCreate() {
        super.onCreate()
        db = Room.databaseBuilder(this, SamalDb::class.java, "samal.db").build()
        session = SessionStore(this, api)
        Inbox(api, db.dao(), session).start()
    }
}
