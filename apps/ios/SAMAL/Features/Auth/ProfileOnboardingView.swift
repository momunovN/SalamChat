import SwiftUI

struct ProfileOnboardingView: View {
    @EnvironmentObject var session: SessionStore
    @State private var name = ""
    @State private var nick = ""
    @State private var sync = true
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Spacer(minLength: 24)
            SalamLogo(size: 72)
            Text(L10n.appName).font(SamalFont.title()).foregroundStyle(SamalColor.text)
            Text(L10n.nameTitle).font(SamalFont.headline()).foregroundStyle(SamalColor.text)
            Text(L10n.nameSubtitle).font(SamalFont.subhead()).foregroundStyle(SamalColor.muted)
            field($name)
            Text(L10n.nickOptional).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
            HStack(spacing: 0) {
                Text("@").font(SamalFont.body()).foregroundStyle(SamalColor.muted)
                TextField("nickname", text: $nick)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(SamalFont.body())
                    .foregroundStyle(SamalColor.text)
            }
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Text(L10n.nickHint).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
            Toggle(isOn: $sync) {
                Text(L10n.syncContacts).font(SamalFont.subhead()).foregroundStyle(SamalColor.text)
            }
            .tint(SamalColor.accent)
            if let error {
                Text(error).font(SamalFont.caption()).foregroundStyle(SamalColor.danger)
            }
            Button(action: go) {
                Text(L10n.continueCta)
                    .font(SamalFont.headline())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(SamalColor.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .opacity(busy ? 0.6 : 1)
            }
            .disabled(busy)
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(24)
        .background(SamalColor.bg.ignoresSafeArea())
    }

    private func field(_ binding: Binding<String>) -> some View {
        TextField(L10n.namePlaceholder, text: binding)
            .font(SamalFont.body())
            .foregroundStyle(SamalColor.text)
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func go() {
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
                try await session.completeProfile(name: trimmed, nick: nick, syncContacts: sync)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
