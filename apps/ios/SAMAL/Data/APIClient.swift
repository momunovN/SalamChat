import Foundation

enum APIError: Error {
    case http(Int, String)
    case decode
    case unauthorized
}

final class APIClient {
    var baseURL: URL
    var accessToken: String?
    var refreshToken: String?
    var onSession: ((APISession) -> Void)?

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

    func requestOTP(phone: String) async throws -> String? {
        struct Out: Decodable { var dev_code: String? }
        let r: Out = try await post("/v1/auth/otp/request", body: ["phone": phone], authed: false)
        return r.dev_code
    }

    func verifyOTP(phone: String, code: String) async throws -> APISession {
        try await post("/v1/auth/otp/verify", body: [
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

    func send(chatID: UUID, clientID: String, type: String, payloadJSON: String) async throws -> APIMessage {
        let payload = try JSONSerialization.jsonObject(with: Data(payloadJSON.utf8))
        return try await post("/v1/chats/\(chatID.uuidString)/messages", body: [
            "client_id": clientID,
            "type": type,
            "payload": payload
        ])
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

    func patchMe(displayName: String, username: String?, bio: String? = nil) async throws -> APIUser {
        var body: [String: Any] = ["display_name": displayName]
        if let username, !username.isEmpty { body["username"] = username }
        if let bio { body["bio"] = bio }
        return try await send("/v1/me", method: "PATCH", body: body, authed: true)
    }

    func syncContacts(enabled: Bool, items: [BookContact]) async throws {
        struct Ok: Decodable { var ok: Bool? }
        let payload: [[String: String]] = items.map { ["phone": $0.phone, "name": $0.name] }
        let _: Ok = try await post("/v1/contacts/sync", body: ["enabled": enabled, "items": payload])
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

    private func send<T: Decodable>(_ path: String, method: String, body: [String: Any]?, authed: Bool) async throws -> T {
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
        if code == 401 { throw APIError.unauthorized }
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
