import SwiftUI

struct SalamLogo: View {
    var size: CGFloat = 72

    var body: some View {
        Image("Logo")
            .resizable()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
