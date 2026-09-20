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
