import AVFoundation
import Foundation
import SwiftUI
import UserNotifications

struct ActiveCall: Identifiable, Equatable {
    var id: UUID
    var title: String
    var kind: String
    var url: String
    var token: String
}

@MainActor
final class SessionStore: ObservableObject {
    @Published var user: APIUser?
    @Published var incomingCall: APICall?
    @Published var activeCall: ActiveCall?
    @Published var liveCall: APICall?
    @Published var openChatID: String?
    @Published var pendingChatID: String?
    @Published var typingChatID: String?
    @Published var onlineIDs = Set<String>()
    @Published var language: String = UserDefaults.standard.string(forKey: "samal.lang")
        ?? (Locale.current.language.languageCode?.identifier == "ky" ? "ky" : "ru")

    let api = APIClient()
    let db = AppDatabase.shared
    private var outboxTask: Task<Void, Never>?
    private var ws: RealtimeClient?
    private var seenMessages = Set<String>()

    var isLoggedIn: Bool { user != nil }

    init() {
        api.onSession = { [weak self] sess in
            Task { @MainActor in self?.store(sess) }
        }
        api.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.logout() }
        }
        if let data = Self.loadSessionData(),
           let sess = try? JSONDecoder().decode(APISession.self, from: data) {
            apply(sess)
        }
        NotificationCenter.default.addObserver(forName: .salamOpenChat, object: nil, queue: .main) { [weak self] note in
            guard let id = note.object as? String else { return }
            Task { @MainActor in self?.pendingChatID = id }
        }
    }

    private static let sessionKey = "samal.session"

    /// Keychain first; a session saved by an older build in UserDefaults is moved over once.
    private static func loadSessionData() -> Data? {
        if let data = SecureStore.data(sessionKey) { return data }
        guard let legacy = UserDefaults.standard.data(forKey: sessionKey) else { return nil }
        SecureStore.set(legacy, for: sessionKey)
        UserDefaults.standard.removeObject(forKey: sessionKey)
        return legacy
    }

    func setLanguage(_ code: String) {
        UserDefaults.standard.set(code, forKey: "samal.lang")
        language = code
    }

    func apply(_ sess: APISession) {
        store(sess)
        startWorkers()
        askNotify()
    }

    private func store(_ sess: APISession) {
        user = sess.user
        api.accessToken = sess.accessToken
        api.refreshToken = sess.refreshToken
        if let data = try? JSONEncoder().encode(sess) {
            SecureStore.set(data, for: Self.sessionKey)
        }
    }

    private func askNotify() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        }
    }

    func logout() {
        user = nil
        api.accessToken = nil
        api.refreshToken = nil
        SecureStore.remove(Self.sessionKey)
        UserDefaults.standard.removeObject(forKey: Self.sessionKey)
        outboxTask?.cancel()
        ws?.stop()
        ws = nil
    }

    func login(email: String, phone: String, code: String) async throws {
        let sess = try await api.verifyOTP(email: email, phone: phone, code: code)
        apply(sess)
    }

    func updateUser(_ user: APIUser) {
        self.user = user
        if let data = Self.loadSessionData(),
           var sess = try? JSONDecoder().decode(APISession.self, from: data) {
            sess.user = user
            apply(sess)
        }
    }

    func completeProfile(name: String, nick: String, syncContacts: Bool) async throws {
        let nickClean = nick.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingPrefix("@")
            .lowercased()
        let user = try await api.patchMe(displayName: name, username: nickClean.isEmpty ? nil : String(nickClean))
        updateUser(user)
        if syncContacts {
            let book = await ContactSync.load()
            try? await api.syncContacts(enabled: true, items: book)
        }
    }

    private func startWorkers() {
        outboxTask?.cancel()
        outboxTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.flushOutbox()
                try? await Task.sleep(nanoseconds: 800_000_000)
            }
        }
        ws?.stop()
        ws = nil
        if api.accessToken != nil {
            let api = self.api
            let client = RealtimeClient { [weak api] in
                guard let api, let token = api.accessToken else { return nil }
                let root = api.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                let encoded = token.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? token
                return URL(string: "\(root)/v1/stream?token=\(encoded)")
            }
            client.onFailure = { [weak self] failures in
                // The stream answers 401 once the access token expires.
                // Any authed REST call refreshes it; the next reconnect then uses the new one.
                guard failures == 1 || failures % 4 == 0 else { return }
                Task { @MainActor in _ = try? await self?.api.chats() }
            }
            client.onEvent = { [weak self] type, body in
                Task { @MainActor in
                    self?.handle(type: type, body: body)
                }
            }
            client.onOpen = { [weak self] in
                Task { @MainActor in
                    await self?.catchUp()
                }
            }
            client.start()
            ws = client
        }
    }

    private func catchUp() async {
        guard let me = user else { return }
        if let remote = try? await api.chats() {
            try? db.replaceChats(remote)
        }
        if let open = openChatID, let id = UUID(uuidString: open),
           let page = try? await api.messagesPage(chatID: id) {
            try? db.upsertMessages(page.items, me: me.id)
        }
        // A call that started ringing before the stream was (re)connected sent us no event.
        if incomingCall == nil, activeCall == nil, let calls = try? await api.calls(),
           let ringing = calls.first(where: { $0.status == "ringing" && $0.initiatorID != me.id }) {
            incomingCall = ringing
        }
    }

    private func flushOutbox() async {
        guard let me = user else { return }
        let rows = (try? db.pendingOutbox()) ?? []
        for row in rows {
            guard let chatID = UUID(uuidString: row.chatID) else { continue }
            do {
                var uploads: [String] = []
                if !row.uploadPath.isEmpty {
                    let id = try await api.upload(
                        fileURL: URL(fileURLWithPath: row.uploadPath),
                        mime: row.mime.isEmpty ? "application/octet-stream" : row.mime,
                        kind: row.kind.isEmpty ? row.type : row.kind
                    )
                    uploads = [id]
                }
                let msg = try await api.send(
                    chatID: chatID,
                    clientID: row.clientID,
                    type: row.type,
                    payloadJSON: row.payloadJSON,
                    uploadIDs: uploads,
                    replyToID: row.replyTo
                )
                try db.markSent(clientID: row.clientID, server: msg)
                try db.upsertMessages([msg], me: me.id)
                if !row.uploadPath.isEmpty { try? FileManager.default.removeItem(atPath: row.uploadPath) }
            } catch {
                try? db.bumpOutbox(clientID: row.clientID, attempts: row.attempts + 1)
            }
        }
    }

    private func handle(type: String, body: Data) {
        guard let me = user else { return }
        switch type {
        case "message.new", "message.created":
            if let msg = try? JSONDecoder.iso.decode(APIMessage.self, from: body) {
                try? db.upsertMessages([msg], me: me.id)
                let key = msg.id.uuidString
                let fresh = seenMessages.insert(key).inserted
                if seenMessages.count > 400 { seenMessages.removeAll(); seenMessages.insert(key) }
                if !fresh { break }
                Task { [weak self] in
                    if let remote = try? await self?.api.chats() {
                        try? self?.db.replaceChats(remote)
                    }
                }
                if msg.authorID != me.id {
                    let looking = openChatID?.lowercased() == msg.chatID.uuidString.lowercased()
                    Task { try? await api.receipts(ids: [msg.id], status: looking ? "read" : "delivered") }
                    if !Mutes.contains(msg.chatID.uuidString) {
                        if looking {
                            Chime.play()
                        } else {
                            let title = (try? db.chat(id: msg.chatID.uuidString))?.title ?? L10n.appName
                            Chime.notify(id: msg.id.uuidString, title: title, body: noteBody(msg), chatID: msg.chatID.uuidString)
                        }
                    }
                }
            }
        case "message.ack":
            if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let rawID = obj["id"] as? String,
               let clientID = obj["client_id"] as? String,
               let serverID = UUID(uuidString: rawID)?.uuidString {
                try? db.applyAck(clientID: clientID, serverID: serverID)
            }
        case "message.updated":
            if let msg = try? JSONDecoder.iso.decode(APIMessage.self, from: body) {
                try? db.upsertMessages([msg], me: me.id)
            }
        case "message.deleted":
            if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let id = obj["id"] as? String {
                try? db.deleteLocal(id: id)
            }
        case "typing":
            if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let chat = obj["chat_id"] as? String,
               (obj["user_id"] as? String)?.lowercased() != me.id.uuidString.lowercased() {
                typingChatID = chat
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if self?.typingChatID == chat { self?.typingChatID = nil }
                }
            }
        case "chat.updated":
            Task { [weak self] in
                if let remote = try? await self?.api.chats() {
                    try? self?.db.replaceChats(remote)
                }
            }
        case "presence":
            if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let id = (obj["user_id"] as? String)?.lowercased(), !id.isEmpty {
                var next = onlineIDs
                if (obj["online"] as? Bool) == true { next.insert(id) } else { next.remove(id) }
                onlineIDs = next
            }
        case "receipt", "receipt.upserted":
            if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let id = obj["message_id"] as? String,
               let status = obj["status"] as? String {
                try? db.applyReceipt(messageID: id.uppercased(), status: status)
                try? db.applyReceipt(messageID: id, status: status)
            }
        case "call.updated":
            if let call = try? JSONDecoder.iso.decode(APICall.self, from: body) {
                liveCall = call
                let closed = call.status == "ended" || call.status == "missed" || call.status == "declined"
                if closed {
                    if incomingCall?.id == call.id { incomingCall = nil }
                    if activeCall?.id == call.id { activeCall = nil }
                } else if call.status == "ringing", call.initiatorID != me.id {
                    incomingCall = call
                }
            }
        default:
            break
        }
    }
}

private func noteBody(_ msg: APIMessage) -> String {
    if let text = msg.payload.text, !text.isEmpty { return text }
    if msg.type != "photo", let text = msg.payload.caption, !text.isEmpty { return text }
    switch msg.type {
    case "photo": return L10n.photo
    case "voice": return L10n.voice
    case "file": return L10n.file
    case "location": return L10n.geo
    default: return L10n.appName
    }
}

enum Mutes {
    private static let key = "samal.muted"

    static func contains(_ id: String) -> Bool {
        let set = UserDefaults.standard.stringArray(forKey: key) ?? []
        return set.contains(id.lowercased())
    }

    static func set(_ id: String, muted: Bool) {
        let clean = id.lowercased()
        guard !clean.isEmpty else { return }
        var set = Set((UserDefaults.standard.stringArray(forKey: key) ?? []).map { $0.lowercased() })
        if muted { set.insert(clean) } else { set.remove(clean) }
        UserDefaults.standard.set(Array(set), forKey: key)
    }

    static func apply(_ chats: [APIChat]) {
        var set = Set((UserDefaults.standard.stringArray(forKey: key) ?? []).map { $0.lowercased() })
        for chat in chats {
            let id = chat.id.uuidString.lowercased()
            if muted(chat.mutedUntil) { set.insert(id) } else { set.remove(id) }
        }
        UserDefaults.standard.set(Array(set), forKey: key)
    }

    private static func muted(_ raw: String?) -> Bool {
        guard let raw, !raw.isEmpty else { return false }
        let date = ISO8601DateFormatter.full.date(from: raw) ?? ISO8601DateFormatter.frac.date(from: raw)
        return (date ?? .distantPast) > Date()
    }
}

enum Chime {
    static var player: AVAudioPlayer?

    static func play() {
        guard let url = Bundle.main.url(forResource: "alert-tone", withExtension: "mp3") else { return }
        player = try? AVAudioPlayer(contentsOf: url)
        player?.play()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            player?.stop()
        }
    }

    static func notify(id: String, title: String, body: String, chatID: String) {
        let note = UNMutableNotificationContent()
        note.title = title
        note.body = body
        note.sound = .default
        note.userInfo = ["chat_id": chatID]
        let req = UNNotificationRequest(identifier: id, content: note, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}

extension JSONDecoder {
    static let iso: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { c in
            let s = try c.singleValueContainer().decode(String.self)
            if let date = ISO8601DateFormatter.full.date(from: s) { return date }
            if let date = ISO8601DateFormatter.frac.date(from: s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: s)
        }
        return d
    }()
}
