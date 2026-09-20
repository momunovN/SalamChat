import Foundation

enum L10n {
    static var appName: String { t("app.name") }
    static var tabChats: String { t("tab.chats") }
    static var tabCalls: String { t("tab.calls") }
    static var tabContacts: String { t("tab.contacts") }
    static var tabMore: String { t("tab.more") }
    static var segAll: String { t("seg.all") }
    static var segDirect: String { t("seg.direct") }
    static var segGroups: String { t("seg.groups") }
    static var segCalls: String { t("seg.calls") }
    static var search: String { t("search") }
    static var composerPlaceholder: String { t("composer.placeholder") }
    static var voiceHintCancel: String { t("voice.cancel") }
    static var voiceHintLock: String { t("voice.lock") }
    static var incomingVideo: String { t("call.incoming_video") }
    static var incomingAudio: String { t("call.incoming_audio") }
    static var decline: String { t("call.decline") }
    static var answer: String { t("call.answer") }
    static var inCall: String { t("call.in_progress") }
    static var online: String { t("presence.online") }
    static var typing: String { t("presence.typing") }
    static var attachPhoto: String { t("attach.photo") }
    static var attachVideo: String { t("attach.video") }
    static var attachFile: String { t("attach.file") }
    static var attachGeo: String { t("attach.geo") }
    static var phoneTitle: String { t("auth.phone_title") }
    static var phoneSubtitle: String { t("auth.phone_subtitle") }
    static var countryKg: String { t("auth.country_kg") }
    static var countryRu: String { t("auth.country_ru") }
    static var continueCta: String { t("auth.continue") }
    static var otpTitle: String { t("auth.otp_title") }
    static var otpSubtitle: String { t("auth.otp_subtitle") }
    static var emptyChats: String { t("chats.empty") }

    static func t(_ key: String) -> String {
        NSLocalizedString(key, comment: "")
    }
}
