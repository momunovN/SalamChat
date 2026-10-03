import AVFoundation
import CoreLocation
import GRDB
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [LocalMessage] = []
    @Published var text = ""
    @Published var query = ""
    @Published var attachOpen = false
    @Published var recording = false
    @Published var reply: LocalMessage?
    @Published var editing: LocalMessage?
    @Published var menu: LocalMessage?
    @Published var membersOpen = false
    @Published var hasOlder = true
    @Published var voiceNote: String?
    let chat: LocalChat
    private var rowsWatch: AnyDatabaseCancellable?
    private var olderCursor: String?
    private var typedAt = Date.distantPast

    init(chat: LocalChat) { self.chat = chat }

    func start(session: SessionStore) {
        session.openChatID = chat.id
        rowsWatch?.cancel()
        let chatID = chat.id
        rowsWatch = ValueObservation
            .tracking { db in
                try LocalMessage
                    .filter(Column("chatID") == chatID)
                    .order(Column("createdAt").desc)
                    .fetchAll(db)
            }
            .start(in: AppDatabase.shared.dbQueue) { _ in
            } onChange: { [weak self] rows in
                guard let self else { return }
                let q = self.query.trimmingCharacters(in: .whitespacesAndNewlines)
                if q.isEmpty {
                    self.messages = rows
                } else {
                    self.messages = rows.filter { $0.text.localizedCaseInsensitiveContains(q) }
                }
            }
        Task { await sync(session: session) }
    }

    func stop(session: SessionStore) {
        if session.openChatID == chat.id { session.openChatID = nil }
        rowsWatch?.cancel()
        rowsWatch = nil
    }

    func reload() {
        messages = (try? AppDatabase.shared.fetchMessages(chatID: chat.id, query: query)) ?? []
    }

    func sync(session: SessionStore) async {
        guard let id = UUID(uuidString: chat.id), let me = session.user else { return }
        if let page = try? await session.api.messagesPage(chatID: id) {
            try? AppDatabase.shared.upsertMessages(page.items, me: me.id)
            reload()
            if olderCursor == nil {
                olderCursor = page.cursor
                if page.cursor == nil { hasOlder = false }
            }
            let incoming = page.items.filter { $0.authorID != me.id }.map(\.id)
            if !incoming.isEmpty { try? await session.api.receipts(ids: incoming, status: "read") }
        }
    }

    func loadOlder(session: SessionStore) async {
        guard let id = UUID(uuidString: chat.id), let cursor = olderCursor, let me = session.user else { return }
        guard let page = try? await session.api.messagesPage(chatID: id, cursor: cursor) else { return }
        try? AppDatabase.shared.upsertMessages(page.items, me: me.id)
        olderCursor = page.cursor
        if page.cursor == nil || page.items.isEmpty { hasOlder = false }
        reload()
    }

    func noteTyping(session: SessionStore) {
        guard Date().timeIntervalSince(typedAt) > 2, let id = UUID(uuidString: chat.id) else { return }
        typedAt = Date()
        Task { try? await session.api.typing(chatID: id) }
    }

    func send(session: SessionStore) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let me = session.user, let id = UUID(uuidString: chat.id) else { return }
        if let editing {
            text = ""
            self.editing = nil
            Task {
                if let uuid = UUID(uuidString: editing.id), let msg = try? await session.api.editMessage(id: uuid, text: trimmed) {
                    try? AppDatabase.shared.upsertMessages([msg], me: me.id)
                } else {
                    try? AppDatabase.shared.editLocal(id: editing.id, text: trimmed)
                }
                reload()
            }
            return
        }
        guard !trimmed.isEmpty else { return }
        text = ""
        let quoted = reply
        reply = nil
        _ = try? AppDatabase.shared.insertOutgoing(
            chatID: id,
            me: me.id,
            text: trimmed,
            replyTo: quoted?.id ?? "",
            replyText: quoted?.text ?? ""
        )
        reload()
    }

    func sendVoice(session: SessionStore, url: URL, ms: Int, wave: [Double]) {
        guard let me = session.user, let id = UUID(uuidString: chat.id) else { return }
        let quoted = reply
        reply = nil
        let waveText = wave.map { String($0) }.joined(separator: ",")
        _ = try? AppDatabase.shared.insertOutgoing(
            chatID: id,
            me: me.id,
            text: "",
            type: "voice",
            payload: ["duration_ms": ms, "waveform": wave],
            uploadPath: url.path,
            mime: "audio/mp4",
            kind: "voice",
            replyTo: quoted?.id ?? "",
            replyText: quoted?.text ?? "",
            durationMs: ms,
            waveform: waveText
        )
        reload()
    }

    func sendFile(session: SessionStore, url: URL, mime: String, name: String) {
        guard let me = session.user, let id = UUID(uuidString: chat.id) else { return }
        let kind = mime.hasPrefix("image/") ? "photo" : (mime.hasPrefix("video/") ? "video" : "file")
        let type = kind == "photo" ? "photo" : "file"
        let showName = kind != "photo"
        _ = try? AppDatabase.shared.insertOutgoing(
            chatID: id,
            me: me.id,
            text: showName ? name : "",
            type: type,
            payload: showName ? ["caption": name] as [String: Any] : [String: Any](),
            uploadPath: url.path,
            mime: mime,
            kind: kind,
            replyTo: reply?.id ?? "",
            replyText: reply?.text ?? "",
            mediaURL: url.path
        )
        reply = nil
        reload()
    }

    func sendLocation(session: SessionStore, lat: Double, lon: Double) {
        guard let me = session.user, let id = UUID(uuidString: chat.id) else { return }
        _ = try? AppDatabase.shared.insertOutgoing(
            chatID: id,
            me: me.id,
            text: String(format: "%.5f, %.5f", lat, lon),
            type: "location",
            payload: ["lat": lat, "lon": lon]
        )
        reload()
    }
}

struct ChatView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) var dismiss
    @StateObject var vm: ChatViewModel
    @State private var pickPhoto = false
    @State private var photoMatch: PHPickerFilter = .images
    @State private var photoItem: PhotosPickerItem?
    @State private var pickFile = false
    @State private var viewer: ChatMedia?
    @State private var flashID: String?
    @State private var openingFile = false
    @State private var openFailed = false
    @State private var profile: ProfileTarget?
    @State private var nextChat: LocalChat?
    @State private var pendingProfile: String?
    @State private var pendingChat: LocalChat?
    @StateObject private var locator = Locator()

    init(chat: LocalChat) {
        _vm = StateObject(wrappedValue: ChatViewModel(chat: chat))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            messageList
            if let quote = vm.editing ?? vm.reply {
                HStack {
                    VStack(alignment: .leading) {
                        Text(vm.editing == nil ? L10n.reply : L10n.edit).font(SamalFont.caption()).foregroundStyle(SamalColor.accent)
                        Text(quote.text).lineLimit(1).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    }
                    Spacer()
                    Button { vm.reply = nil; vm.editing = nil; if vm.editing != nil { vm.text = "" } } label: {
                        Image(systemName: "xmark").foregroundStyle(SamalColor.muted)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }
            if let note = vm.voiceNote {
                Text(note).font(SamalFont.caption()).foregroundStyle(SamalColor.danger).padding(.horizontal, 16)
            }
            ComposerView(
                text: $vm.text,
                recording: $vm.recording,
                onAttach: { _ in vm.attachOpen = true },
                onSend: { vm.send(session: session) },
                onVoice: { url, ms, wave in
                    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
                    if ms < 500 || size < 80 {
                        vm.voiceNote = L10n.voiceShort
                        return
                    }
                    vm.voiceNote = nil
                    vm.sendVoice(session: session, url: url, ms: ms, wave: wave)
                }
            )
            .onChange(of: vm.text) { _, _ in vm.noteTyping(session: session) }
        }
        .background(SamalColor.bg.ignoresSafeArea())
        .navigationBarHidden(true)
        .fullScreenCover(item: $viewer) { item in
            MediaCover(item: item) { viewer = nil }
        }
        .alert(L10n.mediaFail, isPresented: $openFailed) {
            Button(L10n.cancel, role: .cancel) {}
        }
        .overlay {
            if openingFile {
                ProgressView()
                    .tint(.white)
                    .padding(16)
                    .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .onAppear { vm.start(session: session) }
        .onDisappear { vm.stop(session: session) }
        .sheet(isPresented: $vm.attachOpen) {
            AttachSheet { kind in
                vm.attachOpen = false
                switch kind {
                case "photo":
                    photoMatch = .images
                    pickPhoto = true
                case "video":
                    photoMatch = .videos
                    pickPhoto = true
                case "file":
                    pickFile = true
                case "location":
                    locator.request { loc in
                        guard let loc else { return }
                        vm.sendLocation(session: session, lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
                    }
                default:
                    break
                }
            }
            .presentationDetents([.height(220)])
            .presentationBackground(SamalColor.elevated)
        }
        .photosPicker(isPresented: $pickPhoto, selection: $photoItem, matching: photoMatch)
        .fileImporter(isPresented: $pickFile, allowedContentTypes: [.item]) { result in
            guard let url = try? result.get() else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent(url.lastPathComponent)
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.copyItem(at: url, to: dest)
            vm.sendFile(session: session, url: dest, mime: "application/octet-stream", name: url.lastPathComponent)
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    let name = UUID().uuidString + (photoMatch == .videos ? ".mp4" : ".jpg")
                    let dest = FileManager.default.temporaryDirectory.appendingPathComponent(name)
                    try? data.write(to: dest)
                    vm.sendFile(session: session, url: dest, mime: photoMatch == .videos ? "video/mp4" : "image/jpeg", name: name)
                }
                photoItem = nil
            }
        }
        .confirmationDialog(vm.menu?.text ?? "", isPresented: Binding(get: { vm.menu != nil }, set: { if !$0 { vm.menu = nil } })) {
            if let msg = vm.menu {
                if msg.status == "failed" {
                    Button(L10n.retry) { try? AppDatabase.shared.retryOutbox(clientID: msg.clientID); vm.reload() }
                }
                Button(L10n.reply) { vm.reply = msg; vm.editing = nil }
                if !msg.text.isEmpty { Button(L10n.copy) { UIPasteboard.general.string = msg.text } }
                if msg.isOutgoing, msg.type == "text", !msg.deleted, msg.status != "failed" {
                    Button(L10n.edit) { vm.editing = msg; vm.reply = nil; vm.text = msg.text }
                }
                if msg.isOutgoing, !msg.deleted, msg.status != "sending" {
                    Button(L10n.delete, role: .destructive) {
                        try? AppDatabase.shared.deleteLocal(id: msg.id)
                        if let id = UUID(uuidString: msg.id) { Task { try? await session.api.deleteMessage(id: id) } }
                        vm.reload()
                    }
                }
            }
        }
        .sheet(isPresented: $vm.membersOpen, onDismiss: {
            if let id = pendingProfile {
                pendingProfile = nil
                showProfile(id)
            }
        }) {
            MembersSheet(chatID: vm.chat.id, onSelect: { user in
                pendingProfile = user.id.uuidString
                vm.membersOpen = false
            }) { dismiss() }
                .environmentObject(session)
        }
        .sheet(item: $profile, onDismiss: {
            if let chat = pendingChat {
                pendingChat = nil
                nextChat = chat
            }
        }) { target in
            ProfileSheet(userID: target.id, canWrite: target.canWrite, onWrite: { user in
                Task { await openProfileChat(user) }
            }, onOpenGroup: { id in
                Task { await openGroupChat(id) }
            })
            .environmentObject(session)
        }
        .navigationDestination(item: $nextChat) { chat in
            ChatView(chat: chat)
        }
    }

    private func showProfile(_ id: String) {
        let mine = session.user?.id.uuidString.lowercased() == id.lowercased()
        let currentPeer = vm.chat.type == "direct" && vm.chat.peerID?.lowercased() == id.lowercased()
        profile = ProfileTarget(id: id, canWrite: !mine && !currentPeer)
    }

    private func openProfileChat(_ user: APIUser) async {
        guard let chat = try? await session.api.direct(userID: user.id) else { return }
        try? AppDatabase.shared.upsertChats([chat])
        let local = LocalChat(
            id: chat.id.uuidString,
            type: chat.type,
            title: chat.title.isEmpty ? user.displayName : chat.title,
            avatarURL: chat.avatarURL ?? user.avatarURL,
            peerID: chat.peer?.id.uuidString ?? user.id.uuidString,
            lastText: "",
            lastAt: chat.updatedAt,
            unread: chat.unreadCount,
            memberCount: chat.memberCount
        )
        pendingChat = local
        profile = nil
    }

    private func openGroupChat(_ id: String) async {
        guard let uuid = UUID(uuidString: id), let chat = try? await session.api.chat(id: uuid) else { return }
        try? AppDatabase.shared.upsertChats([chat])
        let local = LocalChat(
            id: chat.id.uuidString,
            type: chat.type,
            title: chat.title,
            avatarURL: chat.avatarURL,
            peerID: chat.peer?.id.uuidString,
            lastText: "",
            lastAt: chat.updatedAt,
            unread: chat.unreadCount,
            memberCount: chat.memberCount
        )
        pendingChat = local
        profile = nil
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button(action: dismiss.callAsFunction) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(SamalColor.text)
                    .frame(width: 36, height: 36)
            }
            Button {
                if vm.chat.type == "group" {
                    vm.membersOpen = true
                } else if let id = vm.chat.peerID, !id.isEmpty {
                    showProfile(id)
                }
            } label: {
                HStack(spacing: 8) {
                    headerAvatar
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(SamalColor.muted)
                                .accessibilityLabel(L10n.sealed)
                            Text(vm.chat.title).font(SamalFont.headline()).foregroundStyle(SamalColor.text).lineLimit(1)
                        }
                        if session.typingChatID?.lowercased() == vm.chat.id.lowercased() {
                            Text(L10n.typing).font(SamalFont.caption()).foregroundStyle(SamalColor.success)
                        } else if vm.chat.type == "direct",
                                  let peer = vm.chat.peerID?.lowercased(),
                                  session.onlineIDs.contains(peer) {
                            Text(L10n.online).font(SamalFont.caption()).foregroundStyle(SamalColor.success)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
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
    }

    private var headerAvatar: some View {
        let raw = vm.chat.avatarURL ?? ""
        return Group {
            if let url = resolveMedia(raw), raw.hasPrefix("http") {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    headerLetter
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())
            } else {
                headerLetter
            }
        }
    }

    private var headerLetter: some View {
        LetterAvatar(name: vm.chat.title, size: 36)
    }

    private var messageList: some View {
        let ordered = Array(vm.messages.reversed())
        return ScrollViewReader { proxy in
        ScrollView {
            LazyVStack(spacing: 4) {
                if vm.hasOlder {
                    Button(L10n.earlier) { Task { await vm.loadOlder(session: session) } }
                        .font(SamalFont.caption())
                        .foregroundStyle(SamalColor.accent)
                }
                ForEach(Array(ordered.enumerated()), id: \.element.id) { index, msg in
                    let older = index > 0 ? ordered[index - 1] : nil
                    if older == nil || !Calendar.current.isDate(older!.createdAt, inSameDayAs: msg.createdAt) {
                        Text(dayText(msg.createdAt)).font(SamalFont.caption()).foregroundStyle(SamalColor.muted).padding(.top, 8)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        if vm.chat.type == "group", !msg.isOutgoing, !msg.authorName.isEmpty,
                           older == nil || older?.authorID != msg.authorID {
                            Button {
                                if let id = msg.authorID { showProfile(id) }
                            } label: {
                                Text(msg.authorName)
                                    .font(SamalFont.caption())
                                    .foregroundStyle(SamalColor.accent)
                            }
                            .buttonStyle(.plain)
                        }
                        BubbleView(message: msg, onQuote: {
                            jump(to: msg.replyToID, ordered: ordered, proxy: proxy)
                        })
                            .onLongPressGesture { vm.menu = msg }
                            .onTapGesture {
                                if chatMediaKind(msg) != nil {
                                    openMedia(msg)
                                } else if msg.status == "failed" {
                                    vm.menu = msg
                                }
                            }
                    }
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(SamalColor.accent.opacity(flashID == msg.id ? 0.25 : 0))
                    )
                    .animation(.easeOut(duration: 0.3), value: flashID)
                    .id(msg.id)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .onChange(of: ordered.count) { _, _ in
            if let last = ordered.last?.id { proxy.scrollTo(last, anchor: .bottom) }
        }
        }
    }

    /// Tapping a reply's quote scrolls to the message it answers and lights it up.
    private func jump(to id: String, ordered: [LocalMessage], proxy: ScrollViewProxy) {
        guard !id.isEmpty,
              let target = ordered.first(where: { $0.id.caseInsensitiveCompare(id) == .orderedSame || $0.clientID.caseInsensitiveCompare(id) == .orderedSame })
        else { return }
        withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(target.id, anchor: .center) }
        flashID = target.id
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            if flashID == target.id { flashID = nil }
        }
    }

    private func dayText(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return L10n.today }
        if Calendar.current.isDateInYesterday(date) { return L10n.yesterday }
        let f = DateFormatter()
        f.dateFormat = "d MMMM"
        return f.string(from: date)
    }

    private func openMedia(_ message: LocalMessage) {
        guard let kind = chatMediaKind(message) else { return }
        let raw = message.mediaURL.isEmpty ? message.localPath : message.mediaURL
        guard let url = resolveMedia(raw) else { return }
        let name = message.text.isEmpty ? (kind == "image" ? L10n.photo : L10n.file) : message.text
        if kind == "image" || kind == "video" {
            viewer = ChatMedia(url: url, name: name, kind: kind)
            return
        }
        openingFile = true
        Task {
            let local = await materializeMedia(url, name: name)
            openingFile = false
            if let local {
                viewer = ChatMedia(url: local, name: name, kind: "doc")
            } else {
                openFailed = true
            }
        }
    }

    private func startCall(_ kind: String) {
        guard let id = UUID(uuidString: vm.chat.id) else { return }
        Task {
            guard let call = try? await session.api.startCall(chatID: id, kind: kind),
                  let token = try? await session.api.liveKitToken(for: call) else { return }
            session.activeCall = ActiveCall(id: call.id, title: vm.chat.title, kind: kind, url: token.url, token: token.token)
        }
    }
}

struct BubbleView: View {
    let message: LocalMessage
    var onQuote: () -> Void = {}
    @State private var playing = false

    private var metaColor: Color { message.isOutgoing ? Color.white.opacity(0.7) : SamalColor.muted }

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }
            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 4) {
                    if !message.replyText.isEmpty {
                        Button(action: onQuote) {
                            HStack(spacing: 6) {
                                RoundedRectangle(cornerRadius: 1.5)
                                    .fill(message.isOutgoing ? Color.white : SamalColor.accent)
                                    .frame(width: 3)
                                Text(message.replyText)
                                    .font(SamalFont.caption())
                                    .foregroundStyle(message.isOutgoing ? Color.white : SamalColor.text)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                            }
                            .padding(.vertical, 4)
                            .padding(.trailing, 8)
                            .background(
                                (message.isOutgoing ? Color.white : SamalColor.accent).opacity(0.12),
                                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(message.replyToID.isEmpty)
                    }
                    content
                    HStack(spacing: 4) {
                        if message.edited { Text(L10n.editedMark).font(.system(size: 11, weight: .medium)).foregroundStyle(metaColor) }
                        Text(time).font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundStyle(metaColor)
                        if message.isOutgoing {
                            Image(systemName: statusIcon)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(message.status == "read" ? Color.white : metaColor)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(message.isOutgoing ? SamalColor.outgoing : SamalColor.incoming, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            if !message.isOutgoing { Spacer(minLength: 48) }
        }
    }

    @ViewBuilder private var content: some View {
        if message.deleted {
            Text(L10n.deleted).foregroundStyle(SamalColor.muted)
        } else if chatMediaKind(message) == "image" {
            AsyncImage(url: resolveMedia(message.mediaURL.isEmpty ? message.localPath : message.mediaURL)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.gray.opacity(0.2)
            }
            .frame(width: 220, height: 160)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        } else if message.type == "voice" {
            Button {
                VoicePlayback.toggle(url: message.mediaURL, ms: message.durationMs) { playing = $0 }
            } label: {
                HStack {
                    Image(systemName: playing ? "stop.fill" : "play.fill").foregroundStyle(SamalColor.accent)
                    Text(clock(message.durationMs)).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                }
            }
            .buttonStyle(.plain)
        } else if let kind = chatMediaKind(message) {
            HStack(spacing: 8) {
                Image(systemName: kind == "video" ? "play.rectangle.fill" : "doc.fill")
                    .foregroundStyle(SamalColor.accent)
                Text(message.text.isEmpty ? L10n.file : message.text)
                    .font(SamalFont.body())
                    .foregroundStyle(SamalColor.text)
                    .lineLimit(2)
            }
        } else {
            Text(message.text.isEmpty ? fallback : message.text)
                .font(SamalFont.body())
                .foregroundStyle(SamalColor.text)
        }
    }

    private var fallback: String {
        switch message.type {
        case "photo": return L10n.photo
        case "voice": return L10n.voice
        case "file": return L10n.file
        case "location": return L10n.geo
        default: return ""
        }
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
        case "failed": return "exclamationmark.circle"
        default: return "checkmark"
        }
    }

    private func clock(_ ms: Int) -> String {
        let s = max(0, ms / 1000)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

enum VoicePlayback {
    static var player: AVAudioPlayer?
    static func toggle(url: String, ms: Int, playing: @escaping (Bool) -> Void) {
        if player?.isPlaying == true {
            player?.stop()
            playing(false)
            return
        }
        let audioURL = url.hasPrefix("http") ? URL(string: url) : URL(fileURLWithPath: url)
        if let audioURL, audioURL.isFileURL {
            player = try? AVAudioPlayer(contentsOf: audioURL)
        } else if let remote = audioURL, let data = try? Data(contentsOf: remote) {
            player = try? AVAudioPlayer(data: data)
        }
        player?.play()
        playing(true)
        let limit = ms > 0 ? Double(ms) / 1000 : (player?.duration ?? 0)
        DispatchQueue.main.asyncAfter(deadline: .now() + limit) {
            player?.stop()
            playing(false)
        }
    }
}

final class Locator: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var done: ((CLLocation?) -> Void)?

    func request(_ callback: @escaping (CLLocation?) -> Void) {
        done = callback
        manager.delegate = self
        manager.requestWhenInUseAuthorization()
        manager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        done?(locations.last)
        done = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        done?(manager.location)
        done = nil
    }
}

struct ProfileTarget: Identifiable, Hashable {
    let id: String
    var canWrite: Bool
}

struct ProfileSheet: View {
    @EnvironmentObject var session: SessionStore
    let userID: String
    var canWrite: Bool
    var onWrite: (APIUser) -> Void
    var onOpenGroup: (String) -> Void = { _ in }
    @State private var user: APIUser?
    @State private var library = ProfileLibrary(media: [], links: [], voice: [], groups: [])
    @State private var libraryReady = false
    @State private var failed = false
    @State private var tab = 0
    @State private var notes = true
    @State private var noteBusy = false
    @State private var player: AVPlayer?

    private var isSelf: Bool {
        session.user?.id.uuidString.lowercased() == userID.lowercased()
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Capsule().fill(SamalColor.muted.opacity(0.4)).frame(width: 36, height: 4).padding(.top, 8)
                profileAvatar
                if let name = user?.displayName, !name.isEmpty {
                    Text(name).font(SamalFont.title()).foregroundStyle(SamalColor.text).multilineTextAlignment(.center)
                }
                if let nick = user?.username, !nick.isEmpty {
                    Text("@\(nick)").font(SamalFont.body()).foregroundStyle(SamalColor.accent)
                }
                if user?.online == true {
                    Text(L10n.online).font(SamalFont.caption()).foregroundStyle(SamalColor.success)
                } else if user?.lastSeenAt != nil {
                    Text(L10n.lastSeen).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                }
                VStack(alignment: .leading, spacing: 10) {
                    if let phone = user?.phone, !phone.isEmpty {
                        profileRow(L10n.phoneLabel, phone)
                    }
                    if let bio = user?.bio, !bio.isEmpty {
                        profileRow(L10n.fieldBio, bio)
                    }
                    if let birth = user?.birthDate, !birth.isEmpty {
                        profileRow(L10n.fieldBirth, String(birth.prefix(10)))
                    }
                    if let address = user?.address, !address.isEmpty {
                        profileRow(L10n.fieldAddress, address)
                    }
                    if !isSelf, user != nil {
                        Toggle(L10n.notifications, isOn: Binding(
                            get: { notes },
                            set: { next in
                                notes = next
                                noteBusy = true
                                Task {
                                    do {
                                        let saved = try await session.api.setNotifications(id: userID, enabled: next)
                                        Mutes.set(saved.chatID, muted: !saved.enabled)
                                    } catch {
                                        notes = !next
                                    }
                                    noteBusy = false
                                }
                            }
                        ))
                        .disabled(noteBusy)
                        .tint(SamalColor.accent)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
                if failed && user == nil {
                    Text(L10n.mediaFail).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                }
                if user == nil && !failed {
                    ProgressView().padding(.top, 12)
                }
                if canWrite, let loaded = user {
                    Button(L10n.writeUser) { onWrite(loaded) }
                        .font(SamalFont.headline())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(SamalColor.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .foregroundStyle(.white)
                        .padding(.top, 12)
                }
                HStack {
                    tabButton(0, L10n.tabMedia)
                    tabButton(1, L10n.tabLinks)
                    tabButton(2, L10n.tabVoice)
                    tabButton(3, L10n.tabGroups)
                }
                .padding(.top, 8)
                libraryBody
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SamalColor.bg)
        .presentationDetents([.medium, .large])
        .task(id: userID) {
            async let person = session.api.user(id: userID)
            async let shelf = session.api.library(id: userID)
            do {
                let loaded = try await person
                user = loaded
                if let flag = loaded.notifications { notes = flag }
            } catch {
                failed = true
            }
            if let loaded = try? await shelf {
                library = loaded
            }
            libraryReady = true
        }
    }

    private func profileRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
            Text(value).font(SamalFont.body()).foregroundStyle(SamalColor.text)
        }
    }

    private func tabButton(_ index: Int, _ title: String) -> some View {
        Button(title) { tab = index }
            .font(SamalFont.caption().weight(.semibold))
            .foregroundStyle(tab == index ? SamalColor.accent : SamalColor.muted)
            .buttonStyle(.plain)
    }

    @ViewBuilder private var libraryBody: some View {
        if !libraryReady {
            ProgressView().padding(.top, 12)
        } else if currentItemsEmpty {
            Text(emptyTitle).font(SamalFont.body()).foregroundStyle(SamalColor.muted).padding(.top, 12)
        } else if tab == 0 {
            ForEach(library.media) { item in
                if item.kind == "video" {
                    Text(L10n.attachVideo).frame(maxWidth: .infinity, alignment: .leading)
                } else if let url = URL(string: item.url) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.clear.frame(height: 80)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 160)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        } else if tab == 1 {
            ForEach(library.links) { item in
                if let url = URL(string: item.url) {
                    Link(item.url, destination: url)
                        .font(SamalFont.body())
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else if tab == 2 {
            ForEach(library.voice) { item in
                Button(L10n.tabVoice) {
                    if let url = URL(string: item.url) {
                        let next = AVPlayer(url: url)
                        player = next
                        next.play()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            ForEach(library.groups) { item in
                Button {
                    onOpenGroup(item.id)
                } label: {
                    VStack(alignment: .leading) {
                        Text(item.title).foregroundStyle(SamalColor.text)
                        if let nick = item.username, !nick.isEmpty {
                            Text("@\(nick)").font(SamalFont.caption()).foregroundStyle(SamalColor.accent)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var currentItemsEmpty: Bool {
        switch tab {
        case 1: return library.links.isEmpty
        case 2: return library.voice.isEmpty
        case 3: return library.groups.isEmpty
        default: return library.media.isEmpty
        }
    }

    private var emptyTitle: String {
        switch tab {
        case 1: return L10n.emptyLinks
        case 2: return L10n.emptyVoice
        case 3: return L10n.emptyGroups
        default: return L10n.emptyMedia
        }
    }

    @ViewBuilder private var profileAvatar: some View {
        let name = user?.displayName ?? ""
        if let raw = user?.avatarURL, let url = resolveMedia(raw), raw.hasPrefix("http") {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                profileLetter(name)
            }
            .frame(width: 96, height: 96)
            .clipShape(Circle())
            .padding(.top, 12)
        } else {
            profileLetter(name).padding(.top, 12)
        }
    }

    private func profileLetter(_ name: String) -> some View {
        LetterAvatar(name: name, size: 96)
    }
}

struct MembersSheet: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    let chatID: String
    var onSelect: (APIUser) -> Void = { _ in }
    var onLeave: () -> Void
    @State private var members: [APIChatMember] = []
    @State private var query = ""
    @State private var found: [APIUser] = []

    var body: some View {
        NavigationStack {
            List {
                ForEach(members) { member in
                    HStack {
                        Button {
                            onSelect(member.user)
                        } label: {
                            Text(member.user.displayName).foregroundStyle(SamalColor.text)
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        if member.user.id != session.user?.id {
                            Button(L10n.kick) {
                                Task {
                                    try? await session.api.removeMember(chatID: UUID(uuidString: chatID) ?? member.user.id, userID: member.user.id.uuidString)
                                    members.removeAll { $0.user.id == member.user.id }
                                }
                            }
                            .foregroundStyle(SamalColor.danger)
                        }
                    }
                }
                TextField(L10n.addMember, text: $query)
                ForEach(found) { user in
                    Button(user.displayName) {
                        Task {
                            if let id = UUID(uuidString: chatID) {
                                try? await session.api.addMembers(chatID: id, userIDs: [user.id.uuidString])
                            }
                            query = ""
                        }
                    }
                }
            }
            .navigationTitle(L10n.members)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L10n.cancel) { dismiss() } }
                ToolbarItem(placement: .destructiveAction) {
                    Button(L10n.leave) {
                        Task {
                            if let id = UUID(uuidString: chatID), let me = session.user?.id.uuidString {
                                try? await session.api.removeMember(chatID: id, userID: me)
                            }
                            onLeave()
                        }
                    }
                }
            }
        }
        .task {
            if let id = UUID(uuidString: chatID) {
                members = (try? await session.api.members(chatID: id)) ?? []
            }
        }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if q.isEmpty { found = []; return }
            try? await Task.sleep(nanoseconds: 250_000_000)
            found = (try? await session.api.users(q: q)) ?? []
        }
    }
}
