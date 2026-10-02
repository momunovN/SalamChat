import Foundation

/// Server events over SSE (`GET /v1/stream`), the stream the website uses.
/// The host runs the plain Next.js server, which has no WebSocket endpoint (`/v1/ws` answers
/// 502), so the old WebSocket client never received calls or messages.
final class RealtimeClient: NSObject, URLSessionDataDelegate {
    var onEvent: ((String, Data) -> Void)?
    var onOpen: (() -> Void)?
    /// Called after a failed connect or a dropped stream, before the next retry.
    /// SessionStore uses it to refresh an expired access token.
    var onFailure: ((Int) -> Void)?

    /// Built on every (re)connect so a refreshed access token is picked up.
    private let makeURL: () -> URL?
    private var task: URLSessionDataTask?
    private var session: URLSession!
    private var stopped = false
    private var failures = 0
    private var buffer = Data()

    init(makeURL: @escaping () -> URL?) {
        self.makeURL = makeURL
        super.init()
        let config = URLSessionConfiguration.default
        // Idle timeout between bytes: the server sends a pong every 20s, so a silent minute
        // means the stream is dead and we reconnect.
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 7 * 24 * 3600
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }

    func start() {
        guard !stopped, let url = makeURL() else { return }
        var req = URLRequest(url: url)
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        buffer.removeAll()
        let next = session.dataTask(with: req)
        task = next
        next.resume()
    }

    func stop() {
        stopped = true
        task?.cancel()
        task = nil
        session.invalidateAndCancel()
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard dataTask === task else { return completionHandler(.cancel) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 200 {
            failures = 0
            completionHandler(.allow)
            onOpen?()
        } else {
            // 401 when the access token expired; didCompleteWithError schedules the retry.
            completionHandler(.cancel)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask === task else { return }
        buffer.append(data)
        let separator = Data("\n\n".utf8)
        while let range = buffer.range(of: separator) {
            let chunk = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            let text = String(decoding: chunk, as: UTF8.self)
            let payload = text
                .split(separator: "\n")
                .filter { $0.hasPrefix("data:") }
                .map { $0.dropFirst(5).trimmingCharacters(in: .whitespaces) }
                .joined()
            dispatch(payload)
        }
    }

    func urlSession(_ session: URLSession, task finished: URLSessionTask, didCompleteWithError error: Error?) {
        guard finished === task, !stopped else { return }
        failures += 1
        onFailure?(failures)
        // 1.2s, 2.4s, 4.8s … up to 30s, so a dead server does not drain the battery.
        let delay = min(30, 1.2 * pow(2, Double(min(failures - 1, 5))))
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.start()
        }
    }

    private func dispatch(_ payload: String) {
        guard !payload.isEmpty,
              let data = payload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }
        let body = (try? JSONSerialization.data(withJSONObject: obj["body"] ?? [:])) ?? Data()
        onEvent?(type, body)
    }
}
