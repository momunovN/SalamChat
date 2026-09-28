import SwiftUI
import UIKit

@main
struct SAMALApp: App {
    @StateObject private var session = SessionStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .id(session.language)
                .environmentObject(session)
                .preferredColorScheme(.dark)
                .tint(SamalColor.accent)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background {
                        var token: UIBackgroundTaskIdentifier = .invalid
                        token = UIApplication.shared.beginBackgroundTask {
                            if token != .invalid { UIApplication.shared.endBackgroundTask(token) }
                        }
                    }
                }
        }
    }
}
