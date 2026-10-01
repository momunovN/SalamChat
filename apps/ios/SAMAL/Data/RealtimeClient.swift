import Foundation

final class RealtimeClient: NSObject, URLSessionWebSocketDelegate {
    var onEvent: ((String, Data) -> Void)?
    var onOpen: (() -> Void)?
    /// Called after a failed connect or a dropped socket, before the next retry.
    /// SessionStore uses it to refresh an expired access token.
    var onFailure: ((Int) -> Void)?

    /// Built on every (re)connect so a refreshed access token is picked up.
    private let makeURL: () -> URL?
    private var task: URLSessionWebSocketTask?
    private var session: URLSession!
    private var ping: Timer?
    private var stopped = false
    private var failures = 0

    init(makeURL: @escaping () -> URL?) {
        self.makeURL = makeURL
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    }

    func start() {
        guard !stopped else { return }
        ping?.invalidate()
        guard let url = makeURL() else { return }
        task = session.webSocketTask(with: url)
        task?.resume()
        listen(task)
        ping = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            self?.send(dict: ["type": "ping"])
        }
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        failures = 0
        onOpen?()
    }

    func stop() {
        stopped = true
        ping?.invalidate()
        ping = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session.invalidateAndCancel()
    }

    func typing(chatID: UUID) {
        send(dict: ["type": "typing", "chat_id": chatID.uuidString])
    }

    private func send(dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let s = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }

    private func listen(_ current: URLSessionWebSocketTask?) {
        current?.receive { [weak self] result in
            guard let self, !self.stopped, current === self.task else { return }
            switch result {
            case .failure:
                self.ping?.invalidate()
                self.failures += 1
                self.onFailure?(self.failures)
                // 1.2s, 2.4s, 4.8s … up to 30s, so a dead server does not drain the battery.
                let delay = min(30, 1.2 * pow(2, Double(min(self.failures - 1, 5))))
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.start()
                }
            case .success(let msg):
                if case .string(let s) = msg, let data = s.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let type = obj["type"] as? String {
                    let body = (try? JSONSerialization.data(withJSONObject: obj["body"] ?? [:])) ?? Data()
                    self.onEvent?(type, body)
                }
                self.listen(current)
            }
        }
    }
}
