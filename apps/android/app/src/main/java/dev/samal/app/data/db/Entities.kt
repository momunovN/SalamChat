package dev.samal.app.data.db

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "chats")
data class ChatEntity(
    @PrimaryKey val id: String,
    val type: String,
    val title: String,
    val lastText: String,
    val lastAt: Long,
    val unread: Int,
)

@Entity(tableName = "messages")
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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertChats(items: List<ChatEntity>)

    @Query("SELECT * FROM messages WHERE chatId = :chatId AND (:q = '' OR text LIKE '%'||:q||'%') ORDER BY createdAt DESC")
    fun messages(chatId: String, q: String): Flow<List<MessageEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMessages(items: List<MessageEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutbox(row: OutboxEntity)

    @Query("SELECT * FROM outbox WHERE nextRetry <= :now")
    suspend fun pendingOutbox(now: Long): List<OutboxEntity>

    @Query("DELETE FROM outbox WHERE clientId = :id")
    suspend fun deleteOutbox(id: String)

    @Query("UPDATE messages SET status = :status WHERE id = :id")
    suspend fun setStatus(id: String, status: String)
}

@Database(entities = [ChatEntity::class, MessageEntity::class, OutboxEntity::class], version = 1)
abstract class SamalDb : RoomDatabase() {
    abstract fun dao(): SamalDao
}
