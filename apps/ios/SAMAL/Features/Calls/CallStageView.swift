import LiveKit
import SwiftUI

@MainActor
final class CallRoomModel: ObservableObject {
    let room = Room()
    @Published var phase = "link"
    @Published var since: Date?

    func connect(url: String, token: String, video: Bool) async {
        guard url.hasPrefix("ws"), !token.hasPrefix("stub") else {
            phase = "fail"
            return
        }
        do {
            // The microphone opens while the room is still connecting.
            try await room.connect(url: url, token: token, connectOptions: ConnectOptions(enableMicrophone: true))
            if video { try await room.localParticipant.setCamera(enabled: true) }
            since = Date()
            phase = "live"
        } catch {
            phase = "fail"
        }
    }

    func stop() async {
        await room.disconnect()
    }

    var clock: String {
        guard let since else { return "00:00" }
        let s = max(0, Int(Date().timeIntervalSince(since)))
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

struct CallStageView: View {
    @EnvironmentObject var session: SessionStore
    @StateObject private var model = CallRoomModel()

    var body: some View {
        ZStack {
            SamalColor.bg.ignoresSafeArea()
            VStack(spacing: 16) {
                Text(session.activeCall?.title ?? "")
                    .font(SamalFont.title())
                    .foregroundStyle(SamalColor.text)
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    Text(label)
                        .font(SamalFont.body())
                        .foregroundStyle(SamalColor.muted)
                }
                Button {
                    Task { await hangup() }
                } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.title)
                        .foregroundStyle(.white)
                        .frame(width: 72, height: 72)
                        .background(SamalColor.danger, in: Circle())
                }
                .buttonStyle(.plain)
                Text(L10n.hangup).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
            }
        }
        .task(id: session.activeCall?.id) {
            guard let call = session.activeCall else { return }
            await model.connect(url: call.url, token: call.token, video: call.kind == "video")
            let id = call.id
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard let fresh = try? await session.api.call(id: id) else { continue }
                if fresh.status == "ended" || fresh.status == "missed" || fresh.status == "declined" {
                    await model.stop()
                    if session.activeCall?.id == id { session.activeCall = nil }
                    break
                }
            }
        }
    }

    private var label: String {
        if model.phase == "live" { return model.clock }
        if model.phase == "fail" { return L10n.callFailed }
        return L10n.connecting
    }

    private func hangup() async {
        let id = session.activeCall?.id
        await model.stop()
        session.activeCall = nil
        if let id { try? await session.api.hangupCall(id: id) }
    }
}
