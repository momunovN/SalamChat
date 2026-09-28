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
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                SalamLogo(size: 36)
                Text(L10n.tabMore).font(SamalFont.title()).foregroundStyle(SamalColor.text)
                Spacer()
            }
            Text(session.user?.displayName ?? "")
                .font(SamalFont.headline())
                .foregroundStyle(SamalColor.text)
            Text(session.user?.phone ?? "")
                .font(SamalFont.subhead())
                .foregroundStyle(SamalColor.muted)
            Button("Выйти") { session.logout() }
                .foregroundStyle(SamalColor.danger)
            Spacer()
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(SamalColor.bg)
    }
}
