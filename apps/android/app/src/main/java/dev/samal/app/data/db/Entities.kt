package dev.samal.app.data.db

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "chats")
data class ChatEntity(
    @PrimaryKey val id: String,
    val type: String,
    val title: String,
    val lastText: String,
    val lastAt: Long,
    val unread: Int,
    val peerOnline: Boolean = false,
    val peerId: String = "",
)

// Every chat screen and sync step filters by chatId (ordered by createdAt) or by clientId.
// Without these indexes each of those queries scanned the whole messages table.
@Entity(
    tableName = "messages",
    indices = [Index(value = ["chatId", "createdAt"]), Index(value = ["clientId"])],
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val chatId: String,
    val authorId: String?,
    val type: String,
    val text: String,
    val clientId: String,
    val createdAt: Long,
    val status: String,
    val outgoing: Boolean,
    val replyText: String = "",
    val edited: Boolean = false,
    val deleted: Boolean = false,
    val mediaUrl: String = "",
    val durationMs: Int = 0,
    val waveform: String = "",
    val authorName: String = "",
)

@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey val clientId: String,
    val chatId: String,
    val type: String,
    val payloadJson: String,
    val attempts: Int,
    val nextRetry: Long,
)

@Dao
interface SamalDao {
    @Query("SELECT * FROM chats WHERE (:type = '' OR type = :type) AND (:q = '' OR title LIKE '%'||:q||'%') ORDER BY lastAt DESC")
    fun chats(type: String, q: String): Flow<List<ChatEntity>>

    @Query("SELECT * FROM chats WHERE id = :id")
    suspend fun chat(id: String): ChatEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertChats(items: List<ChatEntity>)

    @Query("DELETE FROM chats WHERE id NOT IN (:ids)")
    suspend fun deleteMissing(ids: List<String>)

    @Query("DELETE FROM chats")
    suspend fun deleteAllChats()

    @Query("DELETE FROM chats WHERE id IN (:ids)")
    suspend fun deleteChats(ids: List<String>)

    @Query("UPDATE chats SET title = :title WHERE id = :id")
    suspend fun renameLocal(id: String, title: String)

    /** Newest [limit] messages of a chat. The screen grows the window when "earlier" is tapped. */
    @Query("SELECT * FROM messages WHERE chatId = :chatId ORDER BY createdAt DESC LIMIT :limit")
    fun recent(chatId: String, limit: Int): Flow<List<MessageEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMessages(items: List<MessageEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutbox(row: OutboxEntity)

    @Query("SELECT * FROM outbox WHERE nextRetry <= :now")
    suspend fun pendingOutbox(now: Long): List<OutboxEntity>

    @Query("DELETE FROM outbox WHERE clientId = :id")
    suspend fun deleteOutbox(id: String)

    @Query("UPDATE outbox SET attempts = attempts + 1, nextRetry = :at WHERE clientId = :id")
    suspend fun bumpOutbox(id: String, at: Long)

    @Query("UPDATE outbox SET attempts = 0, nextRetry = 0 WHERE clientId = :id")
    suspend fun retryOutbox(id: String)

    @Query("UPDATE messages SET status = :status WHERE id = :id OR clientId = :id")
    suspend fun setStatus(id: String, status: String)

    @Query("SELECT COUNT(*) FROM messages WHERE id = :id")
    suspend fun countId(id: String): Int

    @Query("SELECT createdAt FROM messages WHERE chatId = :id AND status NOT IN ('sending', 'failed') ORDER BY createdAt DESC LIMIT 1")
    suspend fun latestServerAt(id: String): Long?

    @Query("UPDATE messages SET status = 'sent' WHERE id = :id AND status IN ('sending', 'failed')")
    suspend fun markSentIfPending(id: String)

    @Query("UPDATE messages SET id = :serverId, status = CASE WHEN status IN ('sending', 'failed') THEN 'sent' ELSE status END WHERE clientId = :clientId")
    suspend fun rekey(clientId: String, serverId: String)

    @Query("UPDATE chats SET peerOnline = :online WHERE lower(peerId) = lower(:userId)")
    suspend fun setPeerOnline(userId: String, online: Boolean)

    @Query("DELETE FROM messages WHERE clientId = :clientId AND id != :keepId")
    suspend fun dropClientCopy(clientId: String, keepId: String)

    @Query("UPDATE chats SET lastText = CASE WHEN :at >= lastAt THEN :text ELSE lastText END, lastAt = CASE WHEN :at >= lastAt THEN :at ELSE lastAt END, unread = unread + :add WHERE id = :id")
    suspend fun noteMessage(id: String, text: String, at: Long, add: Int): Int

    @Query("UPDATE chats SET unread = 0 WHERE id = :id")
    suspend fun clearUnread(id: String)

    @Query("UPDATE messages SET text = :text, edited = 1 WHERE id = :id")
    suspend fun editLocal(id: String, text: String)

    @Query("UPDATE messages SET deleted = 1, text = '' WHERE id = :id")
    suspend fun deleteLocal(id: String)
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE messages ADD COLUMN replyText TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE messages ADD COLUMN edited INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE messages ADD COLUMN mediaUrl TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE messages ADD COLUMN durationMs INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE messages ADD COLUMN waveform TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE chats ADD COLUMN peerOnline INTEGER NOT NULL DEFAULT 0")
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE chats ADD COLUMN peerId TEXT NOT NULL DEFAULT ''")
    }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE messages ADD COLUMN authorName TEXT NOT NULL DEFAULT ''")
    }
}

val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_messages_chatId_createdAt` ON `messages` (`chatId`, `createdAt`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_messages_clientId` ON `messages` (`clientId`)")
    }
}

@Database(entities = [ChatEntity::class, MessageEntity::class, OutboxEntity::class], version = 5)
abstract class SamalDb : RoomDatabase() {
    abstract fun dao(): SamalDao
}
