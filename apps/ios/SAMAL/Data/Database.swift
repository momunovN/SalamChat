import Foundation
import GRDB

struct LocalChat: Codable, FetchableRecord, PersistableRecord, Identifiable, Hashable {
    static let databaseTableName = "chats"
    var id: String
    var type: String
    var title: String
    var avatarURL: String?
    var peerID: String?
    var lastText: String
    var lastAt: Date
    var unread: Int
    var memberCount: Int
}

struct LocalMessage: Codable, FetchableRecord, PersistableRecord, Identifiable, Hashable {
    static let databaseTableName = "messages"
    var id: String
    var chatID: String
    var authorID: String?
    var type: String
    var text: String
    var clientID: String
    var createdAt: Date
    var status: String
    var isOutgoing: Bool
}

struct OutboxRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "outbox"
    var clientID: String
    var chatID: String
    var type: String
    var payloadJSON: String
    var attempts: Int
    var nextRetry: Date
}

final class AppDatabase {
    static let shared = AppDatabase()
    let dbQueue: DatabaseQueue

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("samal.sqlite")
        dbQueue = try! DatabaseQueue(path: url.path)
        try! migrator.migrate(dbQueue)
    }

    private var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1") { db in
            try db.create(table: "chats") { t in
                t.column("id", .text).primaryKey()
                t.column("type", .text).notNull()
                t.column("title", .text).notNull()
                t.column("avatarURL", .text)
                t.column("peerID", .text)
                t.column("lastText", .text).notNull().defaults(to: "")
                t.column("lastAt", .datetime).notNull()
                t.column("unread", .integer).notNull().defaults(to: 0)
                t.column("memberCount", .integer).notNull().defaults(to: 0)
            }
            try db.create(table: "messages") { t in
                t.column("id", .text).primaryKey()
                t.column("chatID", .text).notNull()
                t.column("authorID", .text)
                t.column("type", .text).notNull()
                t.column("text", .text).notNull().defaults(to: "")
                t.column("clientID", .text).notNull().unique()
                t.column("createdAt", .datetime).notNull()
                t.column("status", .text).notNull()
                t.column("isOutgoing", .boolean).notNull()
            }
            try db.create(index: "messages_chat_created", on: "messages", columns: ["chatID", "createdAt"])
            try db.create(table: "outbox") { t in
                t.column("clientID", .text).primaryKey()
                t.column("chatID", .text).notNull()
                t.column("type", .text).notNull()
                t.column("payloadJSON", .text).notNull()
                t.column("attempts", .integer).notNull().defaults(to: 0)
                t.column("nextRetry", .datetime).notNull()
            }
        }
        return m
    }

    func fetchChats(filter: String, query: String) throws -> [LocalChat] {
        try dbQueue.read { db in
            var sql = "SELECT * FROM chats WHERE 1=1"
            var args: [any DatabaseValueConvertible] = []
            if filter == "direct" || filter == "group" {
                sql += " AND type = ?"
                args.append(filter)
            }
            if !query.isEmpty {
                sql += " AND (title LIKE ? OR lastText LIKE ?)"
                args.append("%\(query)%")
                args.append("%\(query)%")
            }
            sql += " ORDER BY lastAt DESC"
            return try LocalChat.fetchAll(db, sql: sql, arguments: StatementArguments(args))
        }
    }

    func fetchMessages(chatID: String, query: String = "") throws -> [LocalMessage] {
        try dbQueue.read { db in
            if query.isEmpty {
                return try LocalMessage
                    .filter(Column("chatID") == chatID)
                    .order(Column("createdAt").desc)
                    .fetchAll(db)
            }
            return try LocalMessage
                .filter(Column("chatID") == chatID && Column("text").like("%\(query)%"))
                .order(Column("createdAt").desc)
                .fetchAll(db)
        }
    }

    func upsertChats(_ chats: [APIChat]) throws {
        try dbQueue.write { db in
            for c in chats {
                try LocalChat(
                    id: c.id.uuidString,
                    type: c.type,
                    title: c.title,
                    avatarURL: c.avatarURL,
                    peerID: c.peer?.id.uuidString,
                    lastText: preview(c.lastMessage),
                    lastAt: c.lastMessage?.createdAt ?? c.updatedAt,
                    unread: c.unreadCount,
                    memberCount: c.memberCount
                ).save(db)
            }
        }
    }

    func upsertMessages(_ msgs: [APIMessage], me: UUID) throws {
        try dbQueue.write { db in
            for m in msgs {
                try LocalMessage(
                    id: m.id.uuidString,
                    chatID: m.chatID.uuidString,
                    authorID: m.authorID?.uuidString,
                    type: m.type,
                    text: m.payload.text ?? m.payload.caption ?? mediaLabel(m.type),
                    clientID: m.clientID,
                    createdAt: m.createdAt,
                    status: m.status ?? "sent",
                    isOutgoing: m.authorID == me
                ).save(db)
            }
        }
    }

    @discardableResult
    func insertOutgoing(chatID: UUID, me: UUID, text: String, type: String = "text") throws -> LocalMessage {
        let clientID = UUID().uuidString.lowercased()
        let now = Date()
        let row = LocalMessage(
            id: clientID,
            chatID: chatID.uuidString,
            authorID: me.uuidString,
            type: type,
            text: text,
            clientID: clientID,
            createdAt: now,
            status: "sending",
            isOutgoing: true
        )
        let payloadData = try JSONSerialization.data(withJSONObject: ["text": text])
        let payload = String(data: payloadData, encoding: .utf8) ?? "{}"
        try dbQueue.write { db in
            try row.insert(db)
            try OutboxRow(
                clientID: clientID,
                chatID: chatID.uuidString,
                type: type,
                payloadJSON: payload,
                attempts: 0,
                nextRetry: now
            ).insert(db)
            if var chat = try LocalChat.fetchOne(db, key: chatID.uuidString) {
                chat.lastText = text
                chat.lastAt = now
                try chat.update(db)
            }
        }
        return row
    }

    func pendingOutbox() throws -> [OutboxRow] {
        try dbQueue.read { db in
            try OutboxRow.filter(Column("nextRetry") <= Date()).fetchAll(db)
        }
    }

    func markSent(clientID: String, server: APIMessage) throws {
        try dbQueue.write { db in
            try db.execute(sql: "UPDATE messages SET id=?, status=?, createdAt=? WHERE clientID=?",
                           arguments: [server.id.uuidString, server.status ?? "sent", server.createdAt, clientID])
            try db.execute(sql: "DELETE FROM outbox WHERE clientID=?", arguments: [clientID])
        }
    }

    func bumpOutbox(clientID: String, attempts: Int) throws {
        let delay = min(30.0, pow(2.0, Double(attempts)))
        try dbQueue.write { db in
            try db.execute(sql: "UPDATE outbox SET attempts=?, nextRetry=? WHERE clientID=?",
                           arguments: [attempts, Date().addingTimeInterval(delay), clientID])
        }
    }

    func applyReceipt(messageID: String, status: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: "UPDATE messages SET status=? WHERE id=?", arguments: [status, messageID])
        }
    }

    private func preview(_ m: APIMessage?) -> String {
        guard let m else { return "" }
        if let t = m.payload.text, !t.isEmpty { return t }
        return mediaLabel(m.type)
    }

    private func mediaLabel(_ type: String) -> String {
        switch type {
        case "photo": return "Фото"
        case "voice": return "Голос"
        case "file": return "Файл"
        case "location": return "Гео"
        default: return ""
        }
    }
}
