import SwiftUI

enum SamalColor {
    static let bg = Color(hex: 0x0B0D10)
    static let elevated = Color(hex: 0x14181E)
    static let accent = Color(hex: 0x2B6BFF)
    static let incoming = Color(hex: 0x1B212B)
    static let outgoing = Color(hex: 0x2B6BFF)
    static let text = Color(hex: 0xF4F6F8)
    static let muted = Color(hex: 0x8B95A5)
    static let success = Color(hex: 0x3DDC97)
    static let danger = Color(hex: 0xFF4D6A)
    static let separator = Color.white.opacity(0.06)
    static let hairline = Color.white.opacity(0.08)
}

enum SamalSpace {
    static let grid: CGFloat = 4
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
}

enum SamalMotion {
    static let fast: Double = 0.12
    static let normal: Double = 0.16
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

struct SamalFont {
    static func title() -> Font { .system(size: 28, weight: .bold, design: .default) }
    static func headline() -> Font { .system(size: 17, weight: .semibold) }
    static func body() -> Font { .system(size: 16, weight: .regular) }
    static func subhead() -> Font { .system(size: 14, weight: .regular) }
    static func caption() -> Font { .system(size: 12, weight: .medium) }
    static func tab() -> Font { .system(size: 10, weight: .medium) }
}

/// Same palette and hash as the website and Android, so a person has one color everywhere.
enum SamalAvatar {
    private static let fills: [(UInt, UInt)] = [
        (0x3B82F6, 0x1D4ED8), (0x22C55E, 0x15803D), (0xF59E0B, 0xC2410C), (0xEC4899, 0xBE185D),
        (0x8B5CF6, 0x6D28D9), (0x06B6D4, 0x0E7490), (0xEF4444, 0xB91C1C), (0x14B8A6, 0x0F766E),
    ]

    static func fill(_ name: String) -> (Color, Color) {
        var h: Int32 = 0
        for scalar in (name.isEmpty ? "?" : name).unicodeScalars {
            h = h &* 31 &+ Int32(bitPattern: scalar.value)
        }
        let idx = Int(h == Int32.min ? 0 : abs(h)) % fills.count
        return (Color(hex: fills[idx].0), Color(hex: fills[idx].1))
    }

    /// Author name color in group chats, matching that person's avatar.
    static func nameColor(_ name: String) -> Color { fill(name).0 }

    static func initial(_ name: String) -> String {
        let ch = name.first(where: { $0.isLetter || $0.isNumber })
        return ch.map { String($0).uppercased() } ?? "?"
    }
}

struct LetterAvatar: View {
    let name: String
    var size: CGFloat = 44

    var body: some View {
        let (from, to) = SamalAvatar.fill(name)
        Text(SamalAvatar.initial(name))
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(LinearGradient(colors: [from, to], startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
    }
}
