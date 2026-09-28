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
        _ = try? AppDatabase.shared.insertOutgoing(
            chatID: id,
            me: me.id,
            text: name,
            type: type,
            payload: ["caption": name],
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
        .sheet(isPresented: $vm.membersOpen) {
            MembersSheet(chatID: vm.chat.id) { dismiss() }
                .environmentObject(session)
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
            VStack(alignment: .leading, spacing: 2) {
                Text(vm.chat.title).font(SamalFont.headline()).foregroundStyle(SamalColor.text)
                if session.typingChatID?.lowercased() == vm.chat.id.lowercased() {
                    Text(L10n.typing).font(SamalFont.caption()).foregroundStyle(SamalColor.success)
                } else if vm.chat.type == "direct",
                          let peer = vm.chat.peerID?.lowercased(),
                          session.onlineIDs.contains(peer) {
                    Text(L10n.online).font(SamalFont.caption()).foregroundStyle(SamalColor.success)
                }
            }
            .onTapGesture { if vm.chat.type == "group" { vm.membersOpen = true } }
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
                    BubbleView(message: msg)
                        .id(msg.id)
                        .onLongPressGesture { vm.menu = msg }
                        .onTapGesture {
                            if msg.status == "failed" { vm.menu = msg }
                        }
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

    private func dayText(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return L10n.today }
        if Calendar.current.isDateInYesterday(date) { return L10n.yesterday }
        let f = DateFormatter()
        f.dateFormat = "d MMMM"
        return f.string(from: date)
    }

    private func startCall(_ kind: String) {
        guard let id = UUID(uuidString: vm.chat.id) else { return }
        Task {
            guard let call = try? await session.api.startCall(chatID: id, kind: kind),
                  let token = try? await session.api.callToken(id: call.id) else { return }
            session.activeCall = ActiveCall(id: call.id, title: vm.chat.title, kind: kind, url: token.url, token: token.token)
        }
    }
}

struct BubbleView: View {
    let message: LocalMessage
    @State private var playing = false

    var body: some View {
        HStack {
            if message.isOutgoing { Spacer(minLength: 48) }
            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 4) {
                    if !message.replyText.isEmpty {
                        Text(message.replyText).font(SamalFont.caption()).foregroundStyle(SamalColor.accent).lineLimit(2)
                    }
                    content
                    HStack(spacing: 4) {
                        if message.edited { Text(L10n.editedMark).font(SamalFont.caption()).foregroundStyle(SamalColor.muted) }
                        Text(time).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                        if message.isOutgoing {
                            Image(systemName: statusIcon)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(message.status == "read" ? SamalColor.success : SamalColor.muted)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(message.isOutgoing ? SamalColor.outgoing : SamalColor.incoming, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            if !message.isOutgoing { Spacer(minLength: 48) }
        }
    }

    @ViewBuilder private var content: some View {
        if message.deleted {
            Text(L10n.deleted).foregroundStyle(SamalColor.muted)
        } else if message.type == "photo", !message.mediaURL.isEmpty {
            AsyncImage(url: URL(string: message.mediaURL)) { image in
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

struct MembersSheet: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    let chatID: String
    var onLeave: () -> Void
    @State private var members: [APIChatMember] = []
    @State private var query = ""
    @State private var found: [APIUser] = []

    var body: some View {
        NavigationStack {
            List {
                ForEach(members) { member in
                    HStack {
                        Text(member.user.displayName)
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
