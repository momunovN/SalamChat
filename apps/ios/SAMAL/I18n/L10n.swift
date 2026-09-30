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
    static var searchPeople: String { t("search.people") }
    static var peopleEmpty: String { t("people.empty") }
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
    static var emailPlaceholder: String { t("auth.email_placeholder") }
    static var phoneOptional: String { t("auth.phone_optional") }
    static var errEmail: String { t("auth.err_email") }
    static var countryKg: String { t("auth.country_kg") }
    static var countryRu: String { t("auth.country_ru") }
    static var continueCta: String { t("auth.continue") }
    static var otpTitle: String { t("auth.otp_title") }
    static var otpSubtitle: String { t("auth.otp_subtitle") }
    static var resend: String { t("auth.resend") }
    static func resendIn(_ time: String) -> String {
        t("auth.resend_in").replacingOccurrences(of: "%s", with: time)
    }
    static var emptyChats: String { t("chats.empty") }
    static var nameTitle: String { t("auth.name_title") }
    static var nameSubtitle: String { t("auth.name_subtitle") }
    static var namePlaceholder: String { t("auth.name_placeholder") }
    static var nickOptional: String { t("auth.nick_optional") }
    static var nickHint: String { t("auth.nick_hint") }
    static var syncContacts: String { t("auth.sync_contacts") }
    static var syncHint: String { t("contacts.sync_hint") }
    static var errName: String { t("auth.err_name") }
    static var fieldName: String { t("more.name") }
    static var fieldNick: String { t("more.nick") }
    static var fieldBio: String { t("more.bio") }
    static var save: String { t("more.save") }
    static var logout: String { t("more.logout") }
    static var reply: String { t("msg.reply") }
    static var copy: String { t("msg.copy") }
    static var edit: String { t("msg.edit") }
    static var delete: String { t("msg.delete") }
    static var deleted: String { t("msg.deleted") }
    static var editedMark: String { t("msg.edited") }
    static var retry: String { t("msg.retry") }
    static var today: String { t("day.today") }
    static var yesterday: String { t("day.yesterday") }
    static var earlier: String { t("day.earlier") }
    static var newChat: String { t("chat.new") }
    static var newGroup: String { t("chat.group") }
    static var groupTitle: String { t("chat.group_title") }
    static var create: String { t("chat.create") }
    static var cancel: String { t("chat.cancel") }
    static var confirmHide: String { t("chat.confirm_hide") }
    static var confirmHideMany: String { t("chat.confirm_hide_many") }
    static var rename: String { t("chat.rename") }
    static var select: String { t("chat.select") }
    static var members: String { t("group.members") }
    static var addMember: String { t("group.add") }
    static var leave: String { t("group.leave") }
    static var kick: String { t("group.kick") }
    static var callFailed: String { t("call.failed") }
    static var connecting: String { t("call.connecting") }
    static var hangup: String { t("call.hangup") }
    static var callsEmpty: String { t("calls.empty") }
    static var voiceShort: String { t("voice.short") }
    static var language: String { t("more.language") }
    static var photo: String { t("media.photo") }
    static var voice: String { t("media.voice") }
    static var file: String { t("media.file") }
    static var geo: String { t("media.geo") }
    static var mediaFail: String { t("media.fail") }

    static var code: String {
        UserDefaults.standard.string(forKey: "samal.lang")
            ?? (Locale.current.language.languageCode?.identifier == "ky" ? "ky" : "ru")
    }

    static func t(_ key: String) -> String {
        guard let path = Bundle.main.path(forResource: code, ofType: "lproj"),
              let bundle = Bundle(path: path) else {
            return NSLocalizedString(key, comment: "")
        }
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }
}
