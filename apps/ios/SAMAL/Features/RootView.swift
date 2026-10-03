import SwiftUI

struct RootView: View {
    @EnvironmentObject var session: SessionStore

    var body: some View {
        ZStack {
            SamalColor.bg.ignoresSafeArea()
            if session.isLoggedIn {
                if needsDisplayName(session.user?.displayName) {
                    ProfileOnboardingView()
                } else {
                    MainTabs()
                }
            } else {
                PhoneAuthView()
            }
            if let call = session.incomingCall, session.joinable(call), session.activeCall == nil {
                IncomingCallView(call: call)
                    .transition(.opacity)
            }
            if session.activeCall != nil {
                CallStageView()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: SamalMotion.normal), value: session.isLoggedIn)
    }
}

struct MainTabs: View {
    @State private var tab = 0

    var body: some View {
        VStack(spacing: 0) {
            Group {
                switch tab {
                case 0: ChatListView()
                case 1: CallsView()
                case 2: ContactsView()
                default: MoreView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                tabBtn(0, "bubble.left.and.bubble.right.fill", L10n.tabChats)
                tabBtn(1, "phone.fill", L10n.tabCalls)
                tabBtn(2, "person.2.fill", L10n.tabContacts)
                tabBtn(3, "ellipsis", L10n.tabMore)
            }
            .padding(.top, 8)
            .padding(.bottom, 6)
            .background(SamalColor.elevated.ignoresSafeArea(edges: .bottom))
        }
        .background(SamalColor.bg.ignoresSafeArea())
    }

    private func tabBtn(_ i: Int, _ icon: String, _ title: String) -> some View {
        Button {
            withAnimation(.easeOut(duration: SamalMotion.fast)) { tab = i }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                Text(title).font(SamalFont.tab())
            }
            .foregroundStyle(tab == i ? SamalColor.accent : SamalColor.muted)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }
}
