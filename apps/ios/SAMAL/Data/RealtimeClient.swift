import Foundation

final class RealtimeClient: NSObject, URLSessionWebSocketDelegate {
    var onEvent: ((String, Data) -> Void)?
    var onOpen: (() -> Void)?
    private let url: URL
    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    private var ping: Timer?

    init(url: URL) {
        self.url = url
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    }

    func start() {
        ping?.invalidate()
        task = session.webSocketTask(with: url)
        task?.resume()
        listen()
        ping = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            self?.send(dict: ["type": "ping"])
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        onOpen?()
    }

    func stop() {
        ping?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
    }

    func typing(chatID: UUID) {
        send(dict: ["type": "typing", "chat_id": chatID.uuidString])
    }

    private func send(dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let s = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.start() }
            case .success(let msg):
                if case .string(let s) = msg, let data = s.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let type = obj["type"] as? String {
                    let body = (try? JSONSerialization.data(withJSONObject: obj["body"] ?? [:])) ?? Data()
                    self.onEvent?(type, body)
                }
                self.listen()
            }
        }
    }
}
