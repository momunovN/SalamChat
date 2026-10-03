import Foundation

struct APIUser: Codable, Hashable, Identifiable {
    var id: UUID
    var phone: String
    var email: String?
    var displayName: String
    var username: String?
    var avatarURL: String?
    var bio: String
    var birthDate: String?
    var address: String?
    var usernameHidden: Bool?
    var publicId: String?
    var notifications: Bool?
    var lastSeenAt: Date?
    var online: Bool?
    var bookName: String?

    enum CodingKeys: String, CodingKey {
        case id, phone, email, username, bio, online, address, notifications
        case displayName = "display_name"
        case avatarURL = "avatar_url"
        case birthDate = "birth_date"
        case usernameHidden = "username_hidden"
        case publicId = "public_id"
        case lastSeenAt = "last_seen_at"
        case bookName = "book_name"
    }
}

struct APISession: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var user: APIUser
    var deviceID: UUID

    enum CodingKeys: String, CodingKey {
        case user
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
        case deviceID = "device_id"
    }
}

struct APIChat: Codable, Identifiable, Hashable {
    var id: UUID
    var type: String
    var title: String
    var username: String?
    var avatarURL: String?
    var peer: APIUser?
    var lastMessage: APIMessage?
    var unreadCount: Int
    var memberCount: Int
    var updatedAt: Date
    var mutedUntil: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, type, title, username, peer
        case avatarURL = "avatar_url"
        case lastMessage = "last_message"
        case unreadCount = "unread_count"
        case memberCount = "member_count"
        case updatedAt = "updated_at"
        case mutedUntil = "muted_until"
    }
}

struct APIMessage: Codable, Identifiable, Hashable {
    var id: UUID
    var chatID: UUID
    var authorID: UUID?
    var type: String
    var payload: Payload
    var clientID: String
    var replyToID: UUID?
    var createdAt: Date
    var editedAt: Date?
    var deletedAt: Date?
    var attachments: [APIAttachment]
    var status: String?
    var replyTo: ReplyPreview?
    var authorName: String?

    struct Payload: Codable, Hashable {
        var text: String?
        var lat: Double?
        var lon: Double?
        var caption: String?
        var durationMS: Int?
        var waveform: [Double]?

        enum CodingKeys: String, CodingKey {
            case text, lat, lon, caption, waveform
            case durationMS = "duration_ms"
        }
    }

    struct ReplyPreview: Codable, Hashable {
        var id: UUID?
        var text: String?
    }

    enum CodingKeys: String, CodingKey {
        case id, type, payload, attachments, status
        case chatID = "chat_id"
        case authorID = "author_id"
        case clientID = "client_id"
        case replyToID = "reply_to_id"
        case replyTo = "reply_to"
        case createdAt = "created_at"
        case editedAt = "edited_at"
        case deletedAt = "deleted_at"
        case authorName = "author_name"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        chatID = try c.decode(UUID.self, forKey: .chatID)
        authorID = try c.decodeIfPresent(UUID.self, forKey: .authorID)
        type = try c.decode(String.self, forKey: .type)
        payload = (try? c.decode(Payload.self, forKey: .payload)) ?? Payload()
        clientID = try c.decode(String.self, forKey: .clientID)
        replyToID = try c.decodeIfPresent(UUID.self, forKey: .replyToID)
        replyTo = try c.decodeIfPresent(ReplyPreview.self, forKey: .replyTo)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        editedAt = try c.decodeIfPresent(Date.self, forKey: .editedAt)
        deletedAt = try c.decodeIfPresent(Date.self, forKey: .deletedAt)
        attachments = (try? c.decode([APIAttachment].self, forKey: .attachments)) ?? []
        status = try c.decodeIfPresent(String.self, forKey: .status)
        authorName = try c.decodeIfPresent(String.self, forKey: .authorName)
    }

    init(id: UUID, chatID: UUID, authorID: UUID?, type: String, payload: Payload, clientID: String, createdAt: Date, status: String?) {
        self.id = id
        self.chatID = chatID
        self.authorID = authorID
        self.type = type
        self.payload = payload
        self.clientID = clientID
        self.createdAt = createdAt
        self.replyToID = nil
        self.editedAt = nil
        self.deletedAt = nil
        self.attachments = []
        self.status = status
        self.replyTo = nil
        self.authorName = nil
    }
}

struct APIAttachment: Codable, Hashable, Identifiable {
    var id: UUID
    var kind: String
    var url: String
    var mime: String
    var sizeBytes: Int64
    var width: Int?
    var height: Int?
    var durationMS: Int?
    var filename: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, url, mime, width, height, filename
        case sizeBytes = "size_bytes"
        case durationMS = "duration_ms"
    }
}

struct APICall: Codable, Identifiable {
    var id: UUID
    var chatID: UUID
    var initiatorID: UUID
    var kind: String
    var status: String
    var startedAt: Date
    var answeredAt: Date?
    var endedAt: Date?
    /// Group chat: members not in the call yet may still join it.
    var group: Bool?
    var url: String?
    var token: String?
    var room: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, status, url, token, room, group
        case chatID = "chat_id"
        case initiatorID = "initiator_id"
        case startedAt = "started_at"
        case answeredAt = "answered_at"
        case endedAt = "ended_at"
    }
}

struct APIChatMember: Codable, Identifiable, Hashable {
    var user: APIUser
    var role: String
    var id: UUID { user.id }
}

struct APIToken: Codable {
    var url: String
    var token: String
    var room: String?
}

struct Envelope: Codable {
    var type: String
    var ts: Date
    var body: Data?

    enum CodingKeys: String, CodingKey { case type, ts, body }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        ts = (try? c.decode(Date.self, forKey: .ts)) ?? Date()
        if let obj = try? c.decode([String: AnyCodable].self, forKey: .body) {
            body = try JSONEncoder().encode(obj)
        } else {
            body = nil
        }
    }
}

struct AnyCodable: Codable {
    init(from decoder: Decoder) throws { _ = decoder }
    func encode(to encoder: Encoder) throws {}
}

struct ProfileLibrary: Decodable {
    var media: [ProfileItem]
    var links: [ProfileItem]
    var voice: [ProfileItem]
    var groups: [ProfileGroup]
}

struct ProfileItem: Decodable, Identifiable {
    var id: String
    var url: String
    var kind: String?
    var durationMs: Int?

    enum CodingKeys: String, CodingKey {
        case id, url, kind
        case durationMs = "duration_ms"
    }
}

struct ProfileGroup: Decodable, Identifiable {
    var id: String
    var title: String
    var username: String?
    var avatarURL: String?
    var memberCount: Int

    enum CodingKeys: String, CodingKey {
        case id, title, username
        case avatarURL = "avatar_url"
        case memberCount = "member_count"
    }
}

struct NotifyResult: Decodable {
    var enabled: Bool
    var chatID: String
    var mutedUntil: String?

    enum CodingKeys: String, CodingKey {
        case enabled
        case chatID = "chat_id"
        case mutedUntil = "muted_until"
    }
}

/// A status: photo, video or a text card that lasts 24 hours.
struct APIStory: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var text: String
    var bg: String
    var url: String?
    var mime: String?
    var createdAt: Date
    var viewed: Bool
    var views: Int?

    enum CodingKeys: String, CodingKey {
        case id, kind, text, bg, url, mime, viewed, views
        case createdAt = "created_at"
    }
}

struct APIStoryGroup: Codable, Hashable, Identifiable {
    struct Author: Codable, Hashable {
        var id: String
        var displayName: String
        var avatarURL: String?

        enum CodingKeys: String, CodingKey {
            case id
            case displayName = "display_name"
            case avatarURL = "avatar_url"
        }
    }

    var user: Author
    var stories: [APIStory]
    var unseen: Bool
    var id: String { user.id }
}

struct APIStoryViewer: Codable, Hashable, Identifiable {
    var id: String
    var displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}
