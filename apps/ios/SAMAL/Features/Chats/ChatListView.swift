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
    private var tick: Task<Void, Never>?

    func start(session: SessionStore) {
        tick?.cancel()
        tick = Task {
            await refresh(session: session)
            while !Task.isCancelled {
                reload()
                try? await Task.sleep(nanoseconds: 400_000_000)
            }
        }
    }

    func stop() { tick?.cancel() }

    func reload() {
        let filter = segment == .direct ? "direct" : segment == .group ? "group" : ""
        chats = (try? AppDatabase.shared.fetchChats(filter: filter, query: query)) ?? []
    }

    func refresh(session: SessionStore) async {
        let type = segment == .direct ? "direct" : segment == .group ? "group" : ""
        if let remote = try? await session.api.chats(q: query, type: type) {
            try? AppDatabase.shared.upsertChats(remote)
            reload()
        }
    }
}

struct ChatListView: View {
    @EnvironmentObject var session: SessionStore
    @StateObject private var vm = ChatListViewModel()
    @State private var open: LocalChat?

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
        .onDisappear { vm.stop() }
        .onChange(of: vm.segment) { _, _ in
            vm.reload()
            Task { await vm.refresh(session: session) }
        }
        .onChange(of: vm.query) { _, _ in vm.reload() }
    }

    private var header: some View {
        HStack {
            Text(L10n.appName)
                .font(SamalFont.title())
                .foregroundStyle(SamalColor.text)
            Spacer()
            Image(systemName: "square.and.pencil")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(SamalColor.text)
                .frame(width: 36, height: 36)
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
                    Button { open = chat } label: {
                        ChatRowView(chat: chat)
                    }
                    .buttonStyle(.plain)
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


