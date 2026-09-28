import SwiftUI

struct PhoneAuthView: View {
    @EnvironmentObject var session: SessionStore
    @State private var email = ""
    @State private var phone = "+996"
    @State private var cc = "996"
    @State private var code = ""
    @State private var step = 0
    @State private var busy = false
    @State private var hint: String?
    @State private var failed = false

    var body: some View {
        GeometryReader { geo in
        ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            SalamLogo(size: geo.size.height < 700 ? 56 : 72)
            Text(L10n.appName).font(SamalFont.title()).foregroundStyle(SamalColor.text)
            Text(step == 0 ? L10n.phoneTitle : L10n.otpTitle)
                .font(SamalFont.headline())
                .foregroundStyle(SamalColor.text)
            Text(step == 0 ? L10n.phoneSubtitle : L10n.otpSubtitle)
                .font(SamalFont.subhead())
                .foregroundStyle(SamalColor.muted)

            if step == 0 {
                field($email, keyboard: .emailAddress, prompt: L10n.emailPlaceholder)
                Text(L10n.phoneOptional)
                    .font(SamalFont.caption())
                    .foregroundStyle(SamalColor.muted)
                HStack(spacing: 8) {
                    countryChip("996", L10n.countryKg, "+996")
                    countryChip("7", L10n.countryRu, "+7")
                }
                field($phone, keyboard: .phonePad, prompt: "")
            } else {
                field($code, keyboard: .numberPad, prompt: "000000")
            }
            if let hint {
                Text(hint)
                    .font(SamalFont.caption())
                    .foregroundStyle(failed ? SamalColor.danger : SamalColor.success)
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
        }
        .padding(.horizontal, geo.size.width < 360 ? 16 : 24)
        .padding(.vertical, 16)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity)
        .frame(minHeight: geo.size.height, alignment: .top)
        }
        }
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

    private func field(_ binding: Binding<String>, keyboard: UIKeyboardType, prompt: String) -> some View {
        TextField("", text: binding, prompt: Text(prompt).foregroundStyle(SamalColor.muted))
            .keyboardType(keyboard)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(SamalFont.body())
            .foregroundStyle(SamalColor.text)
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func skippedPhone(_ value: String) -> Bool {
        let digits = value.filter(\.isNumber)
        return digits.isEmpty || digits == "996" || digits == "7"
    }

    private func go() {
        if step == 0 && !email.contains("@") {
            hint = L10n.errEmail
            failed = true
            return
        }
        busy = true
        failed = false
        let sentPhone = skippedPhone(phone) ? "" : phone
        Task {
            defer { busy = false }
            do {
                if step == 0 {
                    _ = try await session.api.requestOTP(email: email.trimmingCharacters(in: .whitespaces), phone: sentPhone)
                    hint = email.trimmingCharacters(in: .whitespaces)
                    step = 1
                } else {
                    try await session.login(email: email.trimmingCharacters(in: .whitespaces), phone: sentPhone, code: code)
                }
            } catch {
                hint = error.localizedDescription
                failed = true
            }
        }
    }
}
