import SwiftUI

struct PhoneAuthView: View {
    @EnvironmentObject var session: SessionStore
    @State private var phone = "+996"
    @State private var cc = "996"
    @State private var code = ""
    @State private var step = 0
    @State private var busy = false
    @State private var hint: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Spacer(minLength: 24)
            SalamLogo(size: 72)
            Text(L10n.appName).font(SamalFont.title()).foregroundStyle(SamalColor.text)
            Text(step == 0 ? L10n.phoneTitle : L10n.otpTitle)
                .font(SamalFont.headline())
                .foregroundStyle(SamalColor.text)
            Text(step == 0 ? L10n.phoneSubtitle : L10n.otpSubtitle)
                .font(SamalFont.subhead())
                .foregroundStyle(SamalColor.muted)

            if step == 0 {
                HStack(spacing: 8) {
                    countryChip("996", L10n.countryKg, "+996")
                    countryChip("7", L10n.countryRu, "+7")
                }
                field($phone, keyboard: .phonePad)
            } else {
                field($code, keyboard: .numberPad)
            }
            if let hint {
                Text(hint).font(SamalFont.caption()).foregroundStyle(SamalColor.success)
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

    private func countryChip(_ id: String, _ title: String, _ prefix: String) -> some View {
        Button {
            let rest = phone.replacingOccurrences(of: "^\\+\\d{1,3}", with: "", options: .regularExpression)
            cc = id
            phone = prefix + rest
        } label: {
            Text("\(title) \(prefix)")
                .font(SamalFont.caption())
                .foregroundStyle(SamalColor.text)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(cc == id ? SamalColor.accent : SamalColor.elevated, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func field(_ binding: Binding<String>, keyboard: UIKeyboardType) -> some View {
        TextField("", text: binding)
            .keyboardType(keyboard)
            .font(SamalFont.body())
            .foregroundStyle(SamalColor.text)
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func go() {
        busy = true
        Task {
            defer { busy = false }
            do {
                if step == 0 {
                    hint = try await session.api.requestOTP(phone: phone)
                    step = 1
                } else {
                    try await session.login(phone: phone, code: code)
                }
            } catch {
                hint = error.localizedDescription
            }
        }
    }
}
