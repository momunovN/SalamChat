import SwiftUI

struct CallsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var rows: [APICall] = []
    @State private var titles: [String: String] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                SalamLogo(size: 36)
                Text(L10n.tabCalls)
                    .font(SamalFont.title())
                    .foregroundStyle(SamalColor.text)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            if rows.isEmpty {
                Text(L10n.callsEmpty)
                    .font(SamalFont.body())
                    .foregroundStyle(SamalColor.muted)
                    .padding(.horizontal, 16)
                Spacer()
            } else {
                ScrollView {
                    ForEach(rows) { call in
                        HStack {
                            Image(systemName: "phone.fill").foregroundStyle(SamalColor.accent)
                            VStack(alignment: .leading) {
                                Text(titles[call.chatID.uuidString] ?? L10n.tabCalls)
                                    .foregroundStyle(SamalColor.text)
                                Text("\(call.kind) · \(call.status)")
                                    .font(SamalFont.caption())
                                    .foregroundStyle(SamalColor.muted)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SamalColor.bg)
        .task {
            rows = (try? await session.api.calls()) ?? []
            let chats = (try? AppDatabase.shared.fetchChats(filter: "", query: "")) ?? []
            titles = Dictionary(uniqueKeysWithValues: chats.map { ($0.id, $0.title) })
        }
    }
}

struct IncomingCallView: View {
    let call: APICall
    @EnvironmentObject var session: SessionStore

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text(call.kind == "video" ? L10n.incomingVideo : L10n.incomingAudio)
                .font(SamalFont.title())
                .foregroundStyle(SamalColor.text)
                .multilineTextAlignment(.center)
            Text(L10n.inCall)
                .font(SamalFont.subhead())
                .foregroundStyle(SamalColor.muted)
            HStack(spacing: 48) {
                Button {
                    let id = session.incomingCall?.id
                    session.incomingCall = nil
                    if let id { session.leftCalls.insert(id) }
                    if let id { Task { try? await session.api.rejectCall(id: id) } }
                } label: {
                    VStack {
                        Circle().fill(SamalColor.danger).frame(width: 72, height: 72)
                            .overlay(Image(systemName: "phone.down.fill").font(.title).foregroundStyle(.white))
                        Text(L10n.decline).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    }
                }
                Button {
                    guard let call = session.incomingCall else { return }
                    session.incomingCall = nil
                    session.leftCalls.insert(call.id)
                    Task {
                        guard let answered = try? await session.api.answerCall(id: call.id),
                              let token = try? await session.api.liveKitToken(for: answered) else { return }
                        let title = (try? AppDatabase.shared.fetchChats(filter: "", query: ""))?.first { $0.id == call.chatID.uuidString }?.title ?? L10n.incomingAudio
                        session.activeCall = ActiveCall(id: call.id, title: title, kind: call.kind, url: token.url, token: token.token)
                    }
                } label: {
                    VStack {
                        Circle().fill(SamalColor.success).frame(width: 72, height: 72)
                            .overlay(Image(systemName: "phone.fill").font(.title).foregroundStyle(.white))
                        Text(call.status == "active" ? L10n.joinCall : L10n.answer).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    }
                }
            }
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SamalColor.bg.opacity(0.96).ignoresSafeArea())
    }
}

struct ContactsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var book: [APIUser] = []
    @State private var found: [APIUser] = []
    @State private var query = ""
    @State private var open: LocalChat?

    private var rows: [APIUser] {
        let me = session.user?.id
        let source = query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? book : found
        return source.filter { $0.id != me }
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    SalamLogo(size: 36)
                    Text(L10n.tabContacts)
                        .font(SamalFont.title())
                        .foregroundStyle(SamalColor.text)
                    Spacer()
                }
                .padding(16)
                TextField(L10n.searchPeople, text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(SamalColor.text)
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 16)
                if rows.isEmpty {
                    Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? L10n.syncHint : L10n.peopleEmpty)
                        .font(SamalFont.subhead())
                        .foregroundStyle(SamalColor.muted)
                        .padding(16)
                    Spacer()
                } else {
                    ScrollView {
                        ForEach(rows) { u in
                            Button { Task { await openDirect(u) } } label: {
                                HStack(spacing: 12) {
                                    Circle().fill(SamalColor.elevated).frame(width: 44, height: 44)
                                        .overlay(
                                            Text(String((u.bookName ?? u.displayName).prefix(1)).uppercased())
                                                .font(.system(size: 18, weight: .semibold))
                                                .foregroundStyle(SamalColor.text)
                                        )
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(u.bookName ?? u.displayName)
                                            .font(SamalFont.headline())
                                            .foregroundStyle(SamalColor.text)
                                        Text(personLine(u))
                                            .font(SamalFont.caption())
                                            .foregroundStyle(SamalColor.muted)
                                    }
                                    Spacer()
                                }
                                .padding(.horizontal, 16)
                                .frame(height: 64)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(SamalColor.bg)
            .navigationBarHidden(true)
            .navigationDestination(item: $open) { chat in
                ChatView(chat: chat)
            }
        }
        .task { book = (try? await session.api.contacts()) ?? [] }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if q.isEmpty {
                found = []
                return
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
            found = (try? await session.api.users(q: q)) ?? []
        }
    }

    private func personLine(_ u: APIUser) -> String {
        var parts: [String] = []
        if let nick = u.username, !nick.isEmpty { parts.append("@\(nick)") }
        if !u.phone.isEmpty { parts.append(u.phone) }
        return parts.joined(separator: " · ")
    }

    private func openDirect(_ u: APIUser) async {
        guard let chat = try? await session.api.direct(userID: u.id) else { return }
        try? AppDatabase.shared.upsertChats([chat])
        open = LocalChat(
            id: chat.id.uuidString,
            type: chat.type,
            title: chat.title.isEmpty ? (u.bookName ?? u.displayName) : chat.title,
            avatarURL: chat.avatarURL,
            peerID: chat.peer?.id.uuidString,
            lastText: "",
            lastAt: chat.updatedAt,
            unread: chat.unreadCount,
            memberCount: chat.memberCount
        )
    }
}

struct MoreView: View {
    @EnvironmentObject var session: SessionStore
    @State private var name = ""
    @State private var nick = ""
    @State private var bio = ""
    @State private var birth = ""
    @State private var address = ""
    @State private var hideNick = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 10) {
                        SalamLogo(size: 36)
                        Text(L10n.tabMore).font(SamalFont.title()).foregroundStyle(SamalColor.text)
                        Spacer()
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.user?.displayName ?? "")
                            .font(SamalFont.headline())
                            .foregroundStyle(SamalColor.text)
                        Text(accountLine)
                            .font(SamalFont.subhead())
                            .foregroundStyle(SamalColor.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                    Text(L10n.fieldName).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    field($name)
                    Text(L10n.fieldNick).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    field($nick)
                    Text(L10n.nickHint).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    Text(L10n.fieldBio).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    field($bio)
                    Toggle(L10n.hideNick, isOn: $hideNick).tint(SamalColor.accent)
                    Text(L10n.hideNickHint).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    Text(L10n.fieldBirth).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    field($birth, prompt: "1990-01-01")
                    Text(L10n.fieldAddress).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    field($address)
                    if let error {
                        Text(error).font(SamalFont.caption()).foregroundStyle(SamalColor.danger)
                    }
                    Button(action: save) {
                        Text(L10n.save)
                            .font(SamalFont.headline())
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(SamalColor.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .opacity(busy ? 0.6 : 1)
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    Text(L10n.language).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    HStack {
                        langChip("ru", "Русский")
                        langChip("ky", "Кыргызча")
                    }
                    Button(L10n.logout) { session.logout() }
                        .foregroundStyle(SamalColor.danger)
                }
                .padding(.horizontal, geo.size.width < 360 ? 16 : 20)
                .padding(.vertical, 12)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(SamalColor.bg)
        .onAppear {
            name = session.user?.displayName ?? ""
            nick = session.user?.username ?? ""
            bio = session.user?.bio ?? ""
            birth = session.user?.birthDate ?? ""
            address = session.user?.address ?? ""
            hideNick = session.user?.usernameHidden ?? false
        }
    }

    private var accountLine: String {
        var parts: [String] = []
        if let nick = session.user?.username, !nick.isEmpty { parts.append("@\(nick)") }
        if let phone = session.user?.phone, !phone.isEmpty { parts.append(phone) }
        if let email = session.user?.email, !email.isEmpty { parts.append(email) }
        return parts.joined(separator: " · ")
    }

    private func langChip(_ code: String, _ title: String) -> some View {
        Button(title) { session.setLanguage(code) }
            .font(SamalFont.subhead().weight(.semibold))
            .foregroundStyle(session.language == code ? SamalColor.text : SamalColor.muted)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(session.language == code ? SamalColor.accent : SamalColor.elevated, in: Capsule())
            .buttonStyle(.plain)
    }

    private func field(_ binding: Binding<String>, prompt: String = "") -> some View {
        TextField(prompt, text: binding)
            .font(SamalFont.body())
            .foregroundStyle(SamalColor.text)
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            error = L10n.errName
            return
        }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let clean = nick.trimmingCharacters(in: .whitespacesAndNewlines).trimmingPrefix("@")
                let user = try await session.api.patchMe(
                    displayName: trimmed,
                    username: clean.isEmpty ? "" : String(clean),
                    bio: bio,
                    birthDate: birth.trimmingCharacters(in: .whitespacesAndNewlines),
                    address: address.trimmingCharacters(in: .whitespacesAndNewlines),
                    usernameHidden: hideNick
                )
                session.updateUser(user)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
