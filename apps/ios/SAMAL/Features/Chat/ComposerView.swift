import AVFoundation
import SwiftUI

struct ComposerView: View {
    @Binding var text: String
    @Binding var recording: Bool
    var onAttach: (String) -> Void
    var onSend: () -> Void
    var onVoice: (URL, Int, [Double]) -> Void
    @State private var drag: CGSize = .zero
    @State private var locked = false
    @State private var recorder: AVAudioRecorder?
    @State private var file: URL?
    @State private var started = Date()
    @State private var bars: [Double] = []

    var body: some View {
        VStack(spacing: 8) {
            if recording {
                voiceHUD
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button { onAttach("sheet") } label: {
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

                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !locked {
                    mic
                } else {
                    Button {
                        if locked { ship() } else { onSend() }
                    } label: {
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
                        if !recording { begin() }
                        recording = true
                        drag = g.translation
                        sample()
                        if g.translation.height < -56 { locked = true }
                        if g.translation.width < -72 && !locked { cancel() }
                    }
                    .onEnded { _ in
                        if locked {
                            drag = .zero
                        } else {
                            ship()
                        }
                    }
            )
    }

    private var voiceHUD: some View {
        HStack {
            Circle().fill(SamalColor.danger).frame(width: 8, height: 8)
            Text(locked ? L10n.voiceHintLock : L10n.voiceHintCancel)
                .font(SamalFont.caption())
                .foregroundStyle(SamalColor.muted)
            Spacer()
            if locked {
                Button(L10n.cancel) { cancel() }
                    .font(SamalFont.caption())
                    .foregroundStyle(SamalColor.danger)
            }
        }
        .padding(.horizontal, 4)
    }

    private func begin() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try? session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).m4a")
        let rec = try? AVAudioRecorder(url: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ])
        rec?.isMeteringEnabled = true
        rec?.record()
        recorder = rec
        file = url
        started = Date()
        bars = []
    }

    private func sample() {
        guard let rec = recorder, bars.count < 64 else { return }
        rec.updateMeters()
        let power = rec.averagePower(forChannel: 0)
        let amp = min(1, max(0.08, (power + 50) / 50))
        bars.append(amp)
    }

    private func cancel() {
        recorder?.stop()
        recorder = nil
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
        recording = false
        locked = false
        drag = .zero
    }

    private func ship() {
        recorder?.stop()
        recorder = nil
        let ms = Int(Date().timeIntervalSince(started) * 1000)
        let url = file
        let wave = bars
        recording = false
        locked = false
        drag = .zero
        file = nil
        guard let url else { return }
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        if ms < 500 || size < 80 {
            try? FileManager.default.removeItem(at: url)
            return
        }
        onVoice(url, ms, wave)
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
