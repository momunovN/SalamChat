import GRDB
import SwiftUI

enum ChatSegment: String, CaseIterable, Identifiable {
    case all, direct, group, calls
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return L10n.segAll
        case .direct: return L10n.segDirect
        case .group: return L10n.segGroups
        case .calls: return L10n.segCalls
        }
    }
}

@MainActor
final class ChatListViewModel: ObservableObject {
    @Published var query = ""
    @Published var segment: ChatSegment = .all
    @Published var chats: [LocalChat] = []
    private var rowsWatch: AnyDatabaseCancellable?

    func start(session: SessionStore) {
        rowsWatch?.cancel()
        rowsWatch = ValueObservation
            .tracking { db -> String in
                try String.fetchOne(
                    db,
                    sql: """
                    SELECT COALESCE(group_concat(
                        id || '|' || IFNULL(title, '') || '|' || IFNULL(lastText, '') || '|' ||
                        IFNULL(CAST(lastAt AS TEXT), '') || '|' || unread,
                        char(10)
                    ), '') FROM chats
                    """
                ) ?? ""
            }
            .start(in: AppDatabase.shared.dbQueue) { _ in
            } onChange: { [weak self] _ in
                self?.reload()
            }
        Task { await refresh(session: session) }
    }

    func stop() {
        rowsWatch?.cancel()
        rowsWatch = nil
    }

    func reload() {
        let filter = segment == .direct ? "direct" : segment == .group ? "group" : ""
        chats = (try? AppDatabase.shared.fetchChats(filter: filter, query: query)) ?? []
    }

    func refresh(session: SessionStore) async {
        let type = segment == .direct ? "direct" : segment == .group ? "group" : ""
        if let remote = try? await session.api.chats(q: query, type: type) {
            if query.isEmpty && type.isEmpty {
                try? AppDatabase.shared.replaceChats(remote)
            } else {
                try? AppDatabase.shared.upsertChats(remote)
            }
            reload()
        }
    }
}

struct ChatListView: View {
    @EnvironmentObject var session: SessionStore
    @StateObject private var vm = ChatListViewModel()
    @State private var open: LocalChat?
    @State private var creating = false
    @State private var picking = false
    @State private var picked = Set<String>()
    @State private var confirm = false
    @State private var renaming: LocalChat?
    @State private var renameTitle = ""
    @State private var renameNick = ""
    @State private var renameNickReady = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                search
                segments
                if vm.segment == .calls {
                    CallsView().frame(maxHeight: .infinity)
                } else {
                    list
                }
            }
            .background(SamalColor.bg)
            .navigationBarHidden(true)
            .navigationDestination(item: $open) { chat in
                ChatView(chat: chat)
            }
        }
        .onAppear { vm.start(session: session) }
        .onChange(of: session.pendingChatID) { _, id in
            guard let id else { return }
            let rows = (try? AppDatabase.shared.fetchChats(filter: "", query: "")) ?? vm.chats
            if let chat = rows.first(where: { $0.id.caseInsensitiveCompare(id) == .orderedSame }) {
                open = chat
            }
            session.pendingChatID = nil
        }
        .onDisappear { vm.stop() }
        .onChange(of: vm.segment) { _, _ in
            vm.reload()
            Task { await vm.refresh(session: session) }
        }
        .onChange(of: vm.query) { _, _ in vm.reload() }
        .sheet(isPresented: $creating) {
            NewChatSheet { chat in
                creating = false
                open = chat
            }
            .environmentObject(session)
        }
        .alert(picked.count > 1 ? L10n.confirmHideMany : L10n.confirmHide, isPresented: $confirm) {
            Button(L10n.delete, role: .destructive) {
                let ids = Array(picked)
                picked = []
                picking = false
                Task {
                    try? AppDatabase.shared.deleteChats(ids)
                    for id in ids {
                        if let uuid = UUID(uuidString: id) { try? await session.api.hideChat(id: uuid) }
                    }
                    vm.reload()
                }
            }
            Button(L10n.cancel, role: .cancel) {}
        }
        .alert(L10n.rename, isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(L10n.groupTitle, text: $renameTitle)
            TextField(L10n.groupNick, text: $renameNick)
            Button(L10n.save) {
                guard let chat = renaming, let id = UUID(uuidString: chat.id) else { return }
                let title = renameTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                let nick = renameNick.trimmingCharacters(in: .whitespacesAndNewlines).trimmingPrefix("@")
                let ready = renameNickReady
                Task {
                    try? await session.api.renameChat(id: id, title: title, username: ready ? String(nick) : nil)
                    await vm.refresh(session: session)
                }
            }
            Button(L10n.cancel, role: .cancel) {}
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            SalamLogo(size: 36)
            Text(L10n.appName)
                .font(SamalFont.title())
                .foregroundStyle(SamalColor.text)
            Spacer()
            if picking {
                Button(L10n.delete) { if !picked.isEmpty { confirm = true } }
                    .foregroundStyle(SamalColor.danger)
                Button(L10n.cancel) { picking = false; picked = [] }
                    .foregroundStyle(SamalColor.muted)
            } else {
                Button(L10n.select) { picking = true }
                    .font(SamalFont.caption())
                    .foregroundStyle(SamalColor.muted)
                Button { creating = true } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(SamalColor.text)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, SamalSpace.lg)
        .padding(.top, SamalSpace.sm)
        .padding(.bottom, SamalSpace.sm)
    }

    private var search: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(SamalColor.muted)
            TextField(L10n.search, text: $vm.query)
                .foregroundStyle(SamalColor.text)
                .tint(SamalColor.accent)
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, SamalSpace.lg)
        .padding(.bottom, SamalSpace.md)
    }

    private var segments: some View {
        HStack(spacing: 4) {
            ForEach(ChatSegment.allCases) { seg in
                Button {
                    withAnimation(.easeOut(duration: SamalMotion.fast)) { vm.segment = seg }
                } label: {
                    Text(seg.title)
                        .font(SamalFont.subhead().weight(.semibold))
                        .foregroundStyle(vm.segment == seg ? SamalColor.text : SamalColor.muted)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(
                            Capsule().fill(vm.segment == seg ? SamalColor.accent : Color.clear)
                        )
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, SamalSpace.lg)
        .padding(.bottom, SamalSpace.sm)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if vm.chats.isEmpty {
                    Text(L10n.emptyChats)
                        .font(SamalFont.body())
                        .foregroundStyle(SamalColor.muted)
                        .padding(.top, 80)
                }
                ForEach(vm.chats) { chat in
                    Button {
                        if picking {
                            if picked.contains(chat.id) { picked.remove(chat.id) } else { picked.insert(chat.id) }
                        } else {
                            open = chat
                        }
                    } label: {
                        ChatRowView(chat: chat)
                            .background(picked.contains(chat.id) ? SamalColor.accent.opacity(0.16) : Color.clear)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button(L10n.delete, role: .destructive) {
                            picked = [chat.id]
                            confirm = true
                        }
                        if chat.type == "group" {
                            Button(L10n.rename) {
                                renameTitle = chat.title
                                renameNick = ""
                                renameNickReady = false
                                renaming = chat
                                Task {
                                    guard let id = UUID(uuidString: chat.id) else { return }
                                    if let remote = try? await session.api.chat(id: id) {
                                        renameNick = remote.username ?? ""
                                    }
                                    renameNickReady = true
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

struct ChatRowView: View {
    let chat: LocalChat

    var body: some View {
        HStack(spacing: 12) {
            avatar
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(chat.title)
                        .font(SamalFont.headline())
                        .foregroundStyle(SamalColor.text)
                        .lineLimit(1)
                    Spacer()
                    Text(time)
                        .font(SamalFont.caption())
                        .foregroundStyle(SamalColor.muted)
                }
                HStack {
                    Text(chat.lastText)
                        .font(SamalFont.subhead())
                        .foregroundStyle(SamalColor.muted)
                        .lineLimit(1)
                    Spacer()
                    if chat.unread > 0 {
                        Text("\(chat.unread)")
                            .font(SamalFont.caption())
                            .foregroundStyle(SamalColor.text)
                            .padding(.horizontal, 7)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(SamalColor.accent, in: Capsule())
                    }
                }
            }
        }
        .padding(.horizontal, SamalSpace.lg)
        .frame(height: 72)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SamalColor.separator).frame(height: 0.5).padding(.leading, 72)
        }
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(SamalColor.elevated)
            Text(String(chat.title.prefix(1)).uppercased())
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(SamalColor.text)
        }
        .frame(width: 56, height: 56)
    }

    private var time: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = Calendar.current.isDateInToday(chat.lastAt) ? "HH:mm" : "dd.MM"
        return f.string(from: chat.lastAt)
    }
}

struct NewChatSheet: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    var onOpen: (LocalChat) -> Void
    @State private var query = ""
    @State private var found: [APIUser] = []
    @State private var group = false
    @State private var title = ""
    @State private var nick = ""
    @State private var picked = Set<UUID>()

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Button(L10n.newChat) { group = false }.foregroundStyle(group ? SamalColor.muted : SamalColor.text)
                    Button(L10n.newGroup) { group = true }.foregroundStyle(group ? SamalColor.text : SamalColor.muted)
                }
                if group {
                    TextField(L10n.groupTitle, text: $title)
                        .padding(12)
                        .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 12))
                    TextField(L10n.groupNick, text: $nick)
                        .padding(12)
                        .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 12))
                }
                TextField(L10n.searchPeople, text: $query)
                    .padding(12)
                    .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 12))
                ScrollView {
                    ForEach(found) { user in
                        Button {
                            if group {
                                if picked.contains(user.id) { picked.remove(user.id) } else { picked.insert(user.id) }
                            } else {
                                Task { await openDirect(user) }
                            }
                        } label: {
                            HStack {
                                Text(user.displayName).foregroundStyle(picked.contains(user.id) ? SamalColor.accent : SamalColor.text)
                                Spacer()
                            }
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                    }
                }
                if group {
                    Button(L10n.create) { Task { await createGroup() } }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(SamalColor.accent, in: RoundedRectangle(cornerRadius: 14))
                        .foregroundStyle(.white)
                }
            }
            .padding()
            .background(SamalColor.bg)
            .navigationTitle(group ? L10n.newGroup : L10n.newChat)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L10n.cancel) { dismiss() } } }
        }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if q.isEmpty { found = []; return }
            try? await Task.sleep(nanoseconds: 250_000_000)
            found = (try? await session.api.users(q: q)) ?? []
        }
    }

    private func openDirect(_ user: APIUser) async {
        guard let chat = try? await session.api.direct(userID: user.id) else { return }
        try? AppDatabase.shared.upsertChats([chat])
        onOpen(local(chat, fallback: user.displayName))
    }

    private func createGroup() async {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count >= 2, !picked.isEmpty else { return }
        let clean = nick.trimmingCharacters(in: .whitespacesAndNewlines).trimmingPrefix("@")
        guard let chat = try? await session.api.group(title: name, memberIDs: picked.map(\.uuidString), username: clean.isEmpty ? nil : String(clean)) else { return }
        try? AppDatabase.shared.upsertChats([chat])
        onOpen(local(chat, fallback: name))
    }

    private func local(_ chat: APIChat, fallback: String) -> LocalChat {
        LocalChat(
            id: chat.id.uuidString,
            type: chat.type,
            title: chat.title.isEmpty ? fallback : chat.title,
            avatarURL: chat.avatarURL,
            peerID: chat.peer?.id.uuidString,
            lastText: "",
            lastAt: chat.updatedAt,
            unread: chat.unreadCount,
            memberCount: chat.memberCount
        )
    }
}


