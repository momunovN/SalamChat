import SwiftUI

@main
struct SAMALApp: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.dark)
                .tint(SamalColor.accent)
        }
    }
}
