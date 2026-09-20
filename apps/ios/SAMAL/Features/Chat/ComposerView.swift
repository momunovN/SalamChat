import SwiftUI

struct ComposerView: View {
    @Binding var text: String
    @Binding var recording: Bool
    var onAttach: () -> Void
    var onSend: () -> Void
    @State private var drag: CGSize = .zero
    @State private var locked = false

    var body: some View {
        VStack(spacing: 8) {
            if recording {
                voiceHUD
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button(action: onAttach) {
                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(SamalColor.text)
                        .frame(width: 40, height: 40)
                        .background(SamalColor.elevated, in: Circle())
                }
                .buttonStyle(.plain)

                TextField(L10n.composerPlaceholder, text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .font(SamalFont.body())
                    .foregroundStyle(SamalColor.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(SamalColor.elevated, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    mic
                } else {
                    Button(action: onSend) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(SamalColor.accent, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(SamalColor.bg)
    }

    private var mic: some View {
        Image(systemName: locked ? "lock.fill" : "mic.fill")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(recording ? SamalColor.danger : SamalColor.text)
            .frame(width: 40, height: 40)
            .background(recording ? SamalColor.danger.opacity(0.15) : SamalColor.elevated, in: Circle())
            .offset(x: min(0, drag.width), y: min(0, drag.height))
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        recording = true
                        drag = g.translation
                        if g.translation.height < -56 { locked = true }
                        if g.translation.width < -72 && !locked {
                            cancel()
                        }
                    }
                    .onEnded { _ in
                        if !locked { finish() }
                    }
            )
            .animation(.easeOut(duration: SamalMotion.fast), value: recording)
    }

    private var voiceHUD: some View {
        HStack {
            Circle().fill(SamalColor.danger).frame(width: 8, height: 8)
            Text(locked ? L10n.voiceHintLock : L10n.voiceHintCancel)
                .font(SamalFont.caption())
                .foregroundStyle(SamalColor.muted)
            Spacer()
            if locked {
                Button("OK") { finish() }
                    .font(SamalFont.caption())
                    .foregroundStyle(SamalColor.accent)
            }
        }
        .padding(.horizontal, 4)
    }

    private func cancel() {
        recording = false
        locked = false
        drag = .zero
    }

    private func finish() {
        recording = false
        locked = false
        drag = .zero
        // Outbox voice upload is wired in UploadService; UI records the gesture contract now.
    }
}

struct AttachSheet: View {
    var onPick: (String) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(" ").frame(height: 4)
            HStack(spacing: 16) {
                item("photo.fill", L10n.attachPhoto, "photo")
                item("video.fill", L10n.attachVideo, "video")
                item("doc.fill", L10n.attachFile, "file")
                item("location.fill", L10n.attachGeo, "location")
            }
            .padding(.horizontal, 24)
            Spacer()
        }
        .padding(.top, 12)
        .background(SamalColor.elevated)
    }

    private func item(_ icon: String, _ title: String, _ kind: String) -> some View {
        Button { onPick(kind) } label: {
            VStack(spacing: 8) {
                ZStack {
                    Circle().fill(SamalColor.accent.opacity(0.16)).frame(width: 56, height: 56)
                    Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundStyle(SamalColor.accent)
                }
                Text(title).font(SamalFont.caption()).foregroundStyle(SamalColor.muted)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }
}
