import SwiftUI

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [LocalMessage] = []
    @Published var text = ""
    @Published var query = ""
    @Published var attachOpen = false
    @Published var recording = false
    let chat: LocalChat
    private var tick: Task<Void, Never>?

    init(chat: LocalChat) { self.chat = chat }

    func start(session: SessionStore) {
        tick?.cancel()
        tick = Task {
            await sync(session: session)
            while !Task.isCancelled {
                reload()
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
    }

    func stop() { tick?.cancel() }

    func reload() {
        messages = (try? AppDatabase.shared.fetchMessages(chatID: chat.id, query: query)) ?? []
    }

    func sync(session: SessionStore) async {
        guard let id = UUID(uuidString: chat.id), let me = session.user else { return }
        if let remote = try? await session.api.messages(chatID: id, q: query) {
            try? AppDatabase.shared.upsertMessages(remote, me: me.id)
            reload()
            let incoming = remote.filter { $0.authorID != me.id }.map(\.id)
            if !incoming.isEmpty {
                try? await session.api.receipts(ids: incoming, status: "read")
            }
        }
    }

    func send(session: SessionStore) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let me = session.user, let id = UUID(uuidString: chat.id) else { return }
        text = ""
        _ = try? AppDatabase.shared.insertOutgoing(chatID: id, me: me.id, text: trimmed)
        reload()
    }
}

struct ChatView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) var dismiss
    @StateObject var vm: ChatViewModel

    init(chat: LocalChat) {
        _vm = StateObject(wrappedValue: ChatViewModel(chat: chat))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            messageList
            ComposerView(
                text: $vm.text,
                recording: $vm.recording,
                onAttach: { vm.attachOpen = true },
                onSend: { vm.send(session: session) }
            )
        }
        .background(SamalColor.bg.ignoresSafeArea())
        .navigationBarHidden(true)
        .onAppear { vm.start(session: session) }
        .onDisappear { vm.stop() }
        .sheet(isPresented: $vm.attachOpen) {
            AttachSheet { _ in vm.attachOpen = false }
                .presentationDetents([.height(280)])
                .presentationDragIndicator(.visible)
                .presentationBackground(SamalColor.elevated)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button(action: dismiss.callAsFunction) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(SamalColor.text)
                    .frame(width: 36, height: 36)
            }
            ZStack {
                Circle().fill(SamalColor.elevated)
                Text(String(vm.chat.title.prefix(1)).uppercased())
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(SamalColor.text)
            }
            .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(vm.chat.title).font(SamalFont.headline()).foregroundStyle(SamalColor.text)
                Text(L10n.online).font(SamalFont.caption()).foregroundStyle(SamalColor.success)
            }
            Spacer()
            Button { startCall("audio") } label: {
                Image(systemName: "phone.fill").foregroundStyle(SamalColor.text).frame(width: 36, height: 36)
            }
            Button { startCall("video") } label: {
                Image(systemName: "video.fill").foregroundStyle(SamalColor.text).frame(width: 36, height: 36)
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 56)
        .background(SamalColor.bg)
    }

    private var messageList: some View {
        ScrollViewReader { _ in
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(vm.messages) { msg in
                        BubbleView(message: msg)
                            .scaleEffect(x: 1, y: -1)
                            .id(msg.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .scaleEffect(x: 1, y: -1)
        }
    }

    private func startCall(_ kind: String) {
        guard let id = UUID(uuidString: vm.chat.id) else { return }
        Task { _ = try? await session.api.startCall(chatID: id, kind: kind) }
    }
}

struct BubbleView: View {
    let message: LocalMessage

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }
            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 4) {
                Text(message.text)
                    .font(SamalFont.body())
                    .foregroundStyle(SamalColor.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(bubbleColor, in: bubbleShape)
                HStack(spacing: 4) {
                    Text(time).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    if message.isOutgoing {
                        Image(systemName: statusIcon)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(message.status == "read" ? SamalColor.success : SamalColor.muted)
                    }
                }
                .padding(.horizontal, 4)
            }
            if !message.isOutgoing { Spacer(minLength: 48) }
        }
    }

    private var bubbleColor: Color {
        message.isOutgoing ? SamalColor.outgoing : SamalColor.incoming
    }

    private var bubbleShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 16,
            bottomLeadingRadius: message.isOutgoing ? 16 : 4,
            bottomTrailingRadius: message.isOutgoing ? 4 : 16,
            topTrailingRadius: 16,
            style: .continuous
        )
    }

    private var time: String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: message.createdAt)
    }

    private var statusIcon: String {
        switch message.status {
        case "sending": return "clock"
        case "sent": return "checkmark"
        case "delivered": return "checkmark.circle"
        case "read": return "checkmark.circle.fill"
        default: return "checkmark"
        }
    }
}
