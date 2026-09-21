import Foundation
import SwiftUI

@MainActor
final class SessionStore: ObservableObject {
    @Published var user: APIUser?
    @Published var incomingCall: APICall?

    let api = APIClient()
    let db = AppDatabase.shared
    private var outboxTask: Task<Void, Never>?
    private var ws: RealtimeClient?

    var isLoggedIn: Bool { user != nil }

    init() {
        if let data = UserDefaults.standard.data(forKey: "samal.session"),
           let sess = try? JSONDecoder().decode(APISession.self, from: data) {
            apply(sess)
        }
    }

    func apply(_ sess: APISession) {
        user = sess.user
        api.accessToken = sess.accessToken
        api.refreshToken = sess.refreshToken
        if let data = try? JSONEncoder().encode(sess) {
            UserDefaults.standard.set(data, forKey: "samal.session")
        }
        startWorkers()
    }

    func logout() {
        user = nil
        api.accessToken = nil
        UserDefaults.standard.removeObject(forKey: "samal.session")
        outboxTask?.cancel()
        ws?.stop()
    }

    func login(phone: String, code: String) async throws {
        let sess = try await api.verifyOTP(phone: phone, code: code)
        apply(sess)
    }

    func updateUser(_ user: APIUser) {
        self.user = user
        if let data = UserDefaults.standard.data(forKey: "samal.session"),
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
        if let token = api.accessToken {
            let root = api.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let wsRoot = root
                .replacingOccurrences(of: "https://", with: "wss://")
                .replacingOccurrences(of: "http://", with: "ws://")
            let client = RealtimeClient(url: URL(string: "\(wsRoot)/v1/ws?token=\(token)")!)
            client.onEvent = { [weak self] type, body in
                Task { @MainActor in
                    self?.handle(type: type, body: body)
                }
            }
            client.start()
            ws = client
        }
    }

    private func flushOutbox() async {
        guard let me = user else { return }
        let rows = (try? db.pendingOutbox()) ?? []
        for row in rows {
            guard let chatID = UUID(uuidString: row.chatID) else { continue }
            do {
                let msg = try await api.send(chatID: chatID, clientID: row.clientID, type: row.type, payloadJSON: row.payloadJSON)
                try db.markSent(clientID: row.clientID, server: msg)
                try db.upsertMessages([msg], me: me.id)
            } catch {
                try? db.bumpOutbox(clientID: row.clientID, attempts: row.attempts + 1)
            }
        }
    }

    private func handle(type: String, body: Data) {
        guard let me = user else { return }
        switch type {
        case "message.created":
            if let msg = try? JSONDecoder.iso.decode(APIMessage.self, from: body) {
                try? db.upsertMessages([msg], me: me.id)
                if msg.authorID != me.id {
                    Task { try? await api.receipts(ids: [msg.id], status: "delivered") }
                }
            }
        case "receipt.upserted":
            if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let id = obj["message_id"] as? String,
               let status = obj["status"] as? String {
                try? db.applyReceipt(messageID: id.uppercased(), status: status)
                try? db.applyReceipt(messageID: id, status: status)
            }
        case "call.updated":
            incomingCall = try? JSONDecoder.iso.decode(APICall.self, from: body)
        default:
            break
        }
    }
}

extension JSONDecoder {
    static let iso: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
