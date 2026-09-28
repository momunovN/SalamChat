import SwiftUI
import UIKit
import UserNotifications

extension Notification.Name {
    static let salamOpenChat = Notification.Name("salam.open.chat")
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let id = response.notification.request.content.userInfo["chat_id"] as? String else { return }
        NotificationCenter.default.post(name: .salamOpenChat, object: id)
    }
}

@main
struct SAMALApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
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
