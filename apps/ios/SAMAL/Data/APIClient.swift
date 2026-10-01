import Foundation

enum APIError: LocalizedError {
    case http(Int, String)
    case decode
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .http(_, let body):
            if let data = body.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let err = json["error"] as? [String: Any],
               let message = err["message"] as? String, !message.isEmpty {
                return message
            }
            return body.isEmpty ? "http" : body
        case .decode:
            return "decode"
        case .unauthorized:
            return "unauthorized"
        }
    }
}

final class APIClient {
    var baseURL: URL
    var accessToken: String?
    var refreshToken: String?
    var onSession: ((APISession) -> Void)?
    var onUnauthorized: (() -> Void)?

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { c in
            let s = try c.singleValueContainer().decode(String.self)
            if let date = ISO8601DateFormatter.full.date(from: s) { return date }
            if let date = ISO8601DateFormatter.frac.date(from: s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: s)
        }
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    init(baseURL: URL = URL(string: "https://salam-chat.ru")!) {
        self.baseURL = baseURL
    }

    func requestOTP(email: String, phone: String) async throws -> String? {
        struct Out: Decodable { var dev_code: String? }
        let r: Out = try await post("/v1/auth/otp/request", body: ["email": email, "phone": phone], authed: false)
        return r.dev_code
    }

    func verifyOTP(email: String, phone: String, code: String) async throws -> APISession {
        try await post("/v1/auth/otp/verify", body: [
            "email": email,
            "phone": phone,
            "code": code,
            "device": ["platform": "ios", "device_name": "iPhone"]
        ], authed: false)
    }

    func chats(q: String = "", type: String = "") async throws -> [APIChat] {
        struct Wrap: Decodable { var items: [APIChat] }
        var path = "/v1/chats?"
        if !q.isEmpty { path += "q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)&" }
        if !type.isEmpty { path += "type=\(type)&" }
        let w: Wrap = try await get(path)
        return w.items
    }

    func messages(chatID: UUID, q: String = "", cursor: String = "") async throws -> [APIMessage] {
        struct Wrap: Decodable { var items: [APIMessage] }
        var path = "/v1/chats/\(chatID.uuidString)/messages?limit=50"
        if !q.isEmpty { path += "&q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)" }
        if !cursor.isEmpty { path += "&cursor=\(cursor)" }
        let w: Wrap = try await get(path)
        return w.items
    }

    func messagesPage(chatID: UUID, cursor: String = "") async throws -> (items: [APIMessage], cursor: String?) {
        struct Page: Decodable { var items: [APIMessage]; var cursor: String? }
        var path = "/v1/chats/\(chatID.uuidString)/messages?limit=50"
        if !cursor.isEmpty {
            path += "&cursor=\(cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor)"
        }
        let page: Page = try await get(path)
        return (page.items, page.cursor)
    }

    func send(chatID: UUID, clientID: String, type: String, payloadJSON: String, uploadIDs: [String] = [], replyToID: String? = nil) async throws -> APIMessage {
        let payload = try JSONSerialization.jsonObject(with: Data(payloadJSON.utf8))
        var body: [String: Any] = ["client_id": clientID, "type": type, "payload": payload]
        if !uploadIDs.isEmpty { body["upload_ids"] = uploadIDs }
        if let replyToID, !replyToID.isEmpty { body["reply_to_id"] = replyToID }
        return try await post("/v1/chats/\(chatID.uuidString)/messages", body: body)
    }

    func editMessage(id: UUID, text: String) async throws -> APIMessage {
        try await send("/v1/messages/\(id.uuidString)", method: "PATCH", body: ["text": text], authed: true)
    }

    func deleteMessage(id: UUID) async throws {
        let _: JSONValue = try await send("/v1/messages/\(id.uuidString)", method: "DELETE", body: nil, authed: true)
    }

    func hideChat(id: UUID) async throws {
        let _: JSONValue = try await send("/v1/chats/\(id.uuidString)", method: "DELETE", body: nil, authed: true)
    }

    func chat(id: UUID) async throws -> APIChat {
        try await get("/v1/chats/\(id.uuidString)")
    }

    func renameChat(id: UUID, title: String, username: String? = nil) async throws {
        var body: [String: Any] = ["title": title]
        if let username { body["username"] = username }
        let _: JSONValue = try await send("/v1/chats/\(id.uuidString)", method: "PATCH", body: body, authed: true)
    }

    func group(title: String, memberIDs: [String], username: String? = nil) async throws -> APIChat {
        var body: [String: Any] = ["title": title, "member_ids": memberIDs]
        if let username, !username.isEmpty { body["username"] = username }
        return try await post("/v1/chats/groups", body: body)
    }

    func members(chatID: UUID) async throws -> [APIChatMember] {
        struct Wrap: Decodable { var items: [APIChatMember] }
        let w: Wrap = try await get("/v1/chats/\(chatID.uuidString)/members")
        return w.items
    }

    func addMembers(chatID: UUID, userIDs: [String]) async throws {
        let _: JSONValue = try await post("/v1/chats/\(chatID.uuidString)/members", body: ["user_ids": userIDs])
    }

    func removeMember(chatID: UUID, userID: String) async throws {
        let _: JSONValue = try await send("/v1/chats/\(chatID.uuidString)/members/\(userID)", method: "DELETE", body: nil, authed: true)
    }

    func calls() async throws -> [APICall] {
        struct Wrap: Decodable { var items: [APICall] }
        let w: Wrap = try await get("/v1/calls")
        return w.items
    }

    func answerCall(id: UUID) async throws -> APICall { try await post("/v1/calls/\(id.uuidString)/answer", body: [:]) }
    func rejectCall(id: UUID) async throws -> APICall { try await post("/v1/calls/\(id.uuidString)/reject", body: [:]) }
    func hangupCall(id: UUID) async throws -> APICall { try await post("/v1/calls/\(id.uuidString)/hangup", body: [:]) }
    func call(id: UUID) async throws -> APICall { try await get("/v1/calls/\(id.uuidString)") }

    func callToken(id: UUID) async throws -> APIToken {
        try await get("/v1/calls/\(id.uuidString)/token")
    }

    func typing(chatID: UUID) async throws {
        let _: JSONValue = try await post("/v1/typing", body: ["chat_id": chatID.uuidString])
    }

    func upload(fileURL: URL, mime: String, kind: String) async throws -> String {
        let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0
        struct Intent: Decodable { var id: String; var put_url: String }
        let intent: Intent = try await post("/v1/uploads/intent", body: ["mime": mime, "kind": kind, "size_bytes": size])
        var req = URLRequest(url: URL(string: intent.put_url)!)
        req.httpMethod = "PUT"
        req.setValue(mime, forHTTPHeaderField: "Content-Type")
        if let token = accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await URLSession.shared.upload(for: req, fromFile: fileURL)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw APIError.http(code, String(data: data, encoding: .utf8) ?? "")
        }
        let _: JSONValue = try await post("/v1/uploads/\(intent.id)/complete", body: [:])
        return intent.id
    }

    func receipts(ids: [UUID], status: String) async throws {
        struct Ok: Decodable { var ok: Bool? }
        let _: Ok = try await post("/v1/receipts", body: [
            "message_ids": ids.map(\.uuidString),
            "status": status
        ])
    }

    func startCall(chatID: UUID, kind: String) async throws -> APICall {
        try await post("/v1/chats/\(chatID.uuidString)/calls", body: ["kind": kind])
    }

    func lookup(phones: [String]) async throws -> [APIUser] {
        struct Wrap: Decodable { var items: [APIUser] }
        let w: Wrap = try await post("/v1/users/lookup", body: ["phones": phones])
        return w.items
    }

    func patchMe(
        displayName: String,
        username: String?,
        bio: String? = nil,
        birthDate: String? = nil,
        address: String? = nil,
        usernameHidden: Bool? = nil
    ) async throws -> APIUser {
        var body: [String: Any] = ["display_name": displayName]
        if let username { body["username"] = username }
        if let bio { body["bio"] = bio }
        if let birthDate { body["birth_date"] = birthDate }
        if let address { body["address"] = address }
        if let usernameHidden { body["username_hidden"] = usernameHidden }
        return try await send("/v1/me", method: "PATCH", body: body, authed: true)
    }

    func library(id: String) async throws -> ProfileLibrary {
        try await get("/v1/users/\(id)/library")
    }

    func setNotifications(id: String, enabled: Bool) async throws -> NotifyResult {
        try await send("/v1/users/\(id)/notifications", method: "PATCH", body: ["enabled": enabled], authed: true)
    }

    func syncContacts(enabled: Bool, items: [BookContact]) async throws {
        struct Ok: Decodable { var ok: Bool? }
        let payload: [[String: String]] = items.map { ["phone": $0.phone, "name": $0.name] }
        let _: Ok = try await post("/v1/contacts/sync", body: ["enabled": enabled, "items": payload])
    }

    func user(id: String) async throws -> APIUser {
        try await get("/v1/users/\(id)")
    }

    func users(q: String) async throws -> [APIUser] {
        struct Wrap: Decodable { var items: [APIUser] }
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        let w: Wrap = try await get("/v1/users?q=\(enc)")
        return w.items
    }

    func direct(userID: UUID) async throws -> APIChat {
        try await post("/v1/chats/direct", body: ["user_id": userID.uuidString])
    }

    func contacts() async throws -> [APIUser] {
        struct Wrap: Decodable { var items: [APIUser] }
        let w: Wrap = try await get("/v1/contacts")
        return w.items
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "GET", body: nil as [String: Any]?, authed: true)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any], authed: Bool = true) async throws -> T {
        try await send(path, method: "POST", body: body, authed: authed)
    }

    private func refreshSession() async -> Bool {
        guard let token = refreshToken, !token.isEmpty else { return false }
        do {
            let sess: APISession = try await send("/v1/auth/refresh", method: "POST", body: ["refresh_token": token], authed: false, retry: false)
            accessToken = sess.accessToken
            refreshToken = sess.refreshToken
            onSession?(sess)
            return true
        } catch {
            return false
        }
    }

    private func send<T: Decodable>(_ path: String, method: String, body: [String: Any]?, authed: Bool, retry: Bool = true) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path).absoluteURL)
        // appendingPathComponent drops query; build manually
        req = URLRequest(url: URL(string: baseURL.absoluteString + path)!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if authed, let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401, authed, retry, !path.contains("/auth/refresh"), await refreshSession() {
            return try await send(path, method: method, body: body, authed: authed, retry: false)
        }
        if code == 401 {
            onUnauthorized?()
            throw APIError.unauthorized
        }
        guard (200..<300).contains(code) else {
            throw APIError.http(code, String(data: data, encoding: .utf8) ?? "")
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decode
        }
    }
}

private struct JSONValue: Decodable {
    init(from decoder: Decoder) throws {
        if var single = try? decoder.singleValueContainer() {
            if single.decodeNil() { return }
        }
        _ = try? decoder.container(keyedBy: IgnoreKey.self)
    }

    private struct IgnoreKey: CodingKey {
        var stringValue: String
        var intValue: Int?
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { self.stringValue = "\(intValue)"; self.intValue = intValue }
    }
}

extension ISO8601DateFormatter {
    static let full: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let frac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
