import SwiftUI

struct CallsView: View {
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
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SamalColor.bg)
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
                    session.incomingCall = nil
                } label: {
                    VStack {
                        Circle().fill(SamalColor.danger).frame(width: 72, height: 72)
                            .overlay(Image(systemName: "phone.down.fill").font(.title).foregroundStyle(.white))
                        Text(L10n.decline).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
                    }
                }
                Button {
                    if var c = session.incomingCall {
                        c.status = "active"
                        session.incomingCall = c
                    }
                } label: {
                    VStack {
                        Circle().fill(SamalColor.success).frame(width: 72, height: 72)
                            .overlay(Image(systemName: "phone.fill").font(.title).foregroundStyle(.white))
                        Text(L10n.answer).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
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
    @State private var items: [APIUser] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                SalamLogo(size: 36)
                Text(L10n.tabContacts)
                    .font(SamalFont.title())
                    .foregroundStyle(SamalColor.text)
                Spacer()
            }
            .padding(16)
            if items.isEmpty {
                Text(L10n.syncHint)
                    .font(SamalFont.subhead())
                    .foregroundStyle(SamalColor.muted)
                    .padding(.horizontal, 16)
                Spacer()
            } else {
                ScrollView {
                    ForEach(items) { u in
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
                                Text(u.username.map { "@\($0)" } ?? u.phone)
                                    .font(SamalFont.caption())
                                    .foregroundStyle(SamalColor.muted)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 64)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SamalColor.bg)
        .task { items = (try? await session.api.contacts()) ?? [] }
    }
}

struct MoreView: View {
    @EnvironmentObject var session: SessionStore
    @State private var name = ""
    @State private var nick = ""
    @State private var bio = ""
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
        }
    }

    private var accountLine: String {
        var parts: [String] = []
        if let nick = session.user?.username, !nick.isEmpty { parts.append("@\(nick)") }
        if let phone = session.user?.phone, !phone.isEmpty { parts.append(phone) }
        return parts.joined(separator: " · ")
    }

    private func field(_ binding: Binding<String>) -> some View {
        TextField("", text: binding)
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
                    username: clean.isEmpty ? nil : String(clean),
                    bio: bio
                )
                session.updateUser(user)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
