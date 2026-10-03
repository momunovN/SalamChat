import AVKit
import PhotosUI
import SwiftUI

/// Statuses, as the website and Android show them: photo, video or a text card for 24 hours.
enum StoryStyle {
    static let backgrounds = ["#2b6bff", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#334155"]
    static let photoSeconds: Double = 5
    static let textSeconds: Double = 6
    static let maxUpload = 20 * 1024 * 1024

    static func color(_ hex: String) -> Color {
        let clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard clean.count == 6, let value = UInt(clean, radix: 16) else { return SamalColor.accent }
        return Color(hex: value)
    }

    static func ago(_ date: Date) -> String {
        let minutes = max(0, Int(Date().timeIntervalSince(date) / 60))
        if minutes < 1 { return L10n.statusNow }
        if minutes < 60 { return L10n.statusMinutes(minutes) }
        return L10n.statusHours(minutes / 60)
    }
}

/// An avatar with a ring: bright while something is unseen, dim once all are watched.
private struct RingedAvatar: View {
    let name: String
    let unseen: Bool
    let ring: Bool

    var body: some View {
        LetterAvatar(name: name, size: 52)
            .padding(4)
            .overlay {
                if ring {
                    Circle().strokeBorder(
                        unseen
                            ? AnyShapeStyle(AngularGradient(colors: [Color(hex: 0x2B6BFF), Color(hex: 0x22D3EE), Color(hex: 0xA855F7), Color(hex: 0x2B6BFF)], center: .center))
                            : AnyShapeStyle(Color.white.opacity(0.2)),
                        lineWidth: 2.5
                    )
                }
            }
    }
}

struct StoryStrip: View {
    let groups: [APIStoryGroup]
    let me: String
    let meName: String
    let onOpen: (Int) -> Void
    let onAdd: () -> Void

    var body: some View {
        let own = groups.firstIndex { $0.user.id.caseInsensitiveCompare(me) == .orderedSame }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                VStack(spacing: 4) {
                    ZStack(alignment: .bottomTrailing) {
                        Button {
                            if let own { onOpen(own) } else { onAdd() }
                        } label: {
                            RingedAvatar(name: meName, unseen: false, ring: own != nil)
                        }
                        .buttonStyle(.plain)
                        Button(action: onAdd) {
                            Image(systemName: "plus")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 20, height: 20)
                                .background(SamalColor.accent, in: Circle())
                                .overlay(Circle().stroke(SamalColor.bg, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(L10n.addStatus)
                    }
                    Text(L10n.myStatus).font(.system(size: 11)).foregroundStyle(SamalColor.muted).lineLimit(1)
                }
                .frame(width: 66)
                ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
                    if group.user.id.caseInsensitiveCompare(me) != .orderedSame {
                        Button { onOpen(index) } label: {
                            VStack(spacing: 4) {
                                RingedAvatar(name: group.user.displayName, unseen: group.unseen, ring: true)
                                Text(group.user.displayName.split(separator: " ").first.map(String.init) ?? "")
                                    .font(.system(size: 11, weight: group.unseen ? .medium : .regular))
                                    .foregroundStyle(group.unseen ? SamalColor.text : SamalColor.muted)
                                    .lineLimit(1)
                            }
                            .frame(width: 66)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, SamalSpace.md)
            .padding(.bottom, SamalSpace.sm)
        }
    }
}

struct StoryViewerView: View {
    @EnvironmentObject var session: SessionStore
    let groups: [APIStoryGroup]
    let start: Int
    let me: String
    let onSeen: (String) -> Void
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var gi = 0
    @State private var si = 0
    @State private var progress: Double = 0
    @State private var paused = false
    @State private var viewers: [APIStoryViewer]?
    @State private var player: AVPlayer?
    @State private var ready = false

    private var group: APIStoryGroup? { groups.indices.contains(gi) ? groups[gi] : nil }
    private var story: APIStory? {
        guard let group, group.stories.indices.contains(si) else { return nil }
        return group.stories[si]
    }
    private var own: Bool { group?.user.id.caseInsensitiveCompare(me) == .orderedSame }

    private let tick = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            if let story {
                content(story)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { _ in paused = true }
                            .onEnded { value in
                                paused = false
                                let moved = abs(value.translation.width) + abs(value.translation.height)
                                if value.translation.height > 120 { dismiss(); return }
                                guard moved < 10 else { return }
                                if value.location.x < UIScreen.main.bounds.width / 3 { prev() } else { next() }
                            }
                    )
                header(story)
                if own {
                    VStack {
                        Spacer()
                        Button {
                            viewers = []
                            Task { viewers = (try? await session.api.storyViews(id: story.id)) ?? [] }
                        } label: {
                            Label("\(story.views ?? 0)", systemImage: "eye")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(.black.opacity(0.5), in: Capsule())
                        }
                        .padding(.bottom, 20)
                    }
                }
            }
        }
        .statusBarHidden()
        .onAppear {
            gi = start
            si = max(0, groups[safe: start]?.stories.firstIndex { !$0.viewed } ?? 0)
            ready = true
            prepare()
        }
        .onChange(of: story?.id) { _, _ in prepare() }
        .onChange(of: paused) { _, value in value ? player?.pause() : player?.play() }
        .onReceive(tick) { _ in advance() }
        .sheet(item: Binding(get: { viewers.map { ViewerList(items: $0) } }, set: { if $0 == nil { viewers = nil } })) { list in
            NavigationStack {
                List(list.items) { v in
                    HStack(spacing: 12) {
                        LetterAvatar(name: v.displayName, size: 40)
                        Text(v.displayName)
                    }
                }
                .overlay {
                    if list.items.isEmpty { Text(L10n.statusNoViews).foregroundStyle(SamalColor.muted) }
                }
                .navigationTitle("\(L10n.statusViews) · \(list.items.count)")
                .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.medium, .large])
        }
    }

    private struct ViewerList: Identifiable {
        let items: [APIStoryViewer]
        var id: Int { items.count }
    }

    @ViewBuilder private func content(_ story: APIStory) -> some View {
        if story.kind == "text" {
            ZStack {
                StoryStyle.color(story.bg)
                Text(story.text)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(32)
            }
        } else if story.kind == "video", let player {
            VideoPlayer(player: player).disabled(true)
        } else if let raw = story.url, let url = URL(string: raw) {
            ZStack {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill().blur(radius: 30).opacity(0.5)
                } placeholder: { Color.black }
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: { ProgressView().tint(.white) }
            }
        }
        if story.kind != "text", !story.text.isEmpty {
            VStack {
                Spacer()
                Text(story.text)
                    .font(.system(size: 15))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.bottom, 80)
            }
        }
    }

    private func header(_ story: APIStory) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(Array((group?.stories ?? []).enumerated()), id: \.element.id) { index, _ in
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.white.opacity(0.3))
                            Capsule().fill(.white).frame(width: geo.size.width * (index < si ? 1 : index == si ? progress : 0))
                        }
                    }
                    .frame(height: 3)
                }
            }
            HStack(spacing: 10) {
                LetterAvatar(name: group?.user.displayName ?? "", size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(own ? L10n.myStatus : (group?.user.displayName ?? ""))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(StoryStyle.ago(story.createdAt)).font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
                if own {
                    Button {
                        Task {
                            try? await session.api.deleteStory(id: story.id)
                            onChanged()
                            dismiss()
                        }
                    } label: {
                        Image(systemName: "trash").font(.system(size: 18)).foregroundStyle(.white).frame(width: 40, height: 40)
                    }
                    .accessibilityLabel(L10n.statusDelete)
                }
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white).frame(width: 40, height: 40)
                }
                .accessibilityLabel(L10n.cancel)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 24)
        .background(LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
    }

    private func prepare() {
        guard ready, let story else { return }
        progress = 0
        player?.pause()
        player = nil
        if story.kind == "video", let raw = story.url, let url = URL(string: raw) {
            var headers: [String: String] = [:]
            if let token = session.api.accessToken { headers["Authorization"] = "Bearer \(token)" }
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
            let next = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            player = next
            next.play()
        }
        if !own, !story.viewed {
            onSeen(story.id)
            Task { try? await session.api.viewStory(id: story.id) }
        }
    }

    private func advance() {
        guard ready, let story, !paused, viewers == nil else { return }
        if story.kind == "video" {
            guard let item = player?.currentItem else { return }
            let total = item.duration.seconds
            let now = item.currentTime().seconds
            if total.isFinite, total > 0 {
                progress = min(1, now / total)
                if now >= total - 0.05 { next() }
            }
            return
        }
        let total = story.kind == "text" ? StoryStyle.textSeconds : StoryStyle.photoSeconds
        progress = min(1, progress + 0.05 / total)
        if progress >= 1 { next() }
    }

    private func next() {
        guard let group else { return dismiss() }
        if si + 1 < group.stories.count {
            si += 1
        } else if gi + 1 < groups.count {
            gi += 1
            si = max(0, groups[gi].stories.firstIndex { !$0.viewed } ?? 0)
        } else {
            dismiss()
        }
        progress = 0
    }

    private func prev() {
        if si > 0 {
            si -= 1
        } else if gi > 0 {
            gi -= 1
            si = max(0, groups[gi].stories.count - 1)
        }
        progress = 0
    }
}

struct StoryComposerView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    let onPosted: () -> Void

    @State private var mode: Mode = .pick
    @State private var text = ""
    @State private var bg = StoryStyle.backgrounds[0]
    @State private var item: PhotosPickerItem?
    @State private var fileURL: URL?
    @State private var mime = ""
    @State private var busy = false
    @State private var error: String?

    enum Mode { case pick, text, media }

    private var isVideo: Bool { mime.hasPrefix("video/") }

    var body: some View {
        switch mode {
        case .pick: picker
        case .text, .media: editor
        }
    }

    private var picker: some View {
        NavigationStack {
            List {
                PhotosPicker(selection: $item, matching: .any(of: [.images, .videos])) {
                    Label(L10n.statusPhoto, systemImage: "photo.on.rectangle")
                }
                Button { mode = .text } label: {
                    Label(L10n.statusText, systemImage: "textformat")
                }
                if let error { Text(error).foregroundStyle(SamalColor.danger) }
            }
            .navigationTitle(L10n.addStatus)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L10n.cancel) { dismiss() } }
            }
        }
        .onChange(of: item) { _, picked in
            guard let picked else { return }
            Task { await load(picked) }
        }
    }

    private var editor: some View {
        ZStack {
            (mode == .text ? StoryStyle.color(bg) : Color.black).ignoresSafeArea()
            if mode == .text {
                TextField(L10n.statusPlaceholder, text: $text, axis: .vertical)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .tint(.white)
                    .padding(32)
            } else if let fileURL {
                if isVideo {
                    VideoPlayer(player: AVPlayer(url: fileURL))
                } else if let image = UIImage(contentsOfFile: fileURL.path) {
                    Image(uiImage: image).resizable().scaledToFit()
                }
            }
            VStack {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 40, height: 40).background(.black.opacity(0.3), in: Circle())
                    }
                    Spacer()
                    if mode == .text {
                        ForEach(StoryStyle.backgrounds, id: \.self) { c in
                            Circle().fill(StoryStyle.color(c)).frame(width: 26, height: 26)
                                .overlay(Circle().stroke(.white.opacity(c == bg ? 1 : 0.3), lineWidth: 2))
                                .onTapGesture { bg = c }
                        }
                    }
                }
                .padding(.horizontal, 12)
                Spacer()
                if let error { Text(error).foregroundStyle(.white).padding(.bottom, 6) }
                HStack(spacing: 8) {
                    if mode == .media {
                        TextField(L10n.statusPlaceholder, text: $text)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(height: 46)
                            .background(.black.opacity(0.5), in: Capsule())
                    } else {
                        Spacer()
                    }
                    Button { Task { await publish() } } label: {
                        Group {
                            if busy { ProgressView().tint(.black) } else { Text(L10n.statusPublish).fontWeight(.semibold) }
                        }
                        .foregroundStyle(.black)
                        .padding(.horizontal, 20)
                        .frame(height: 46)
                        .background(.white, in: Capsule())
                    }
                    .disabled(busy || (mode == .text ? text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : fileURL == nil))
                }
                .padding(12)
            }
        }
    }

    private func load(_ picked: PhotosPickerItem) async {
        guard let data = try? await picked.loadTransferable(type: Data.self) else {
            error = L10n.statusFailed
            return
        }
        if data.count > StoryStyle.maxUpload {
            error = L10n.statusTooBig
            return
        }
        let type = picked.supportedContentTypes.first
        mime = type?.preferredMIMEType ?? "image/jpeg"
        let ext = type?.preferredFilenameExtension ?? (mime.hasPrefix("video/") ? "mp4" : "jpg")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("story-\(UUID().uuidString).\(ext)")
        do {
            try data.write(to: url)
            fileURL = url
            mode = .media
        } catch {
            self.error = L10n.statusFailed
        }
    }

    private func publish() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            if mode == .text {
                try await session.api.postStory(kind: "text", text: text.trimmingCharacters(in: .whitespacesAndNewlines), bg: bg)
            } else if let fileURL {
                let kind = isVideo ? "video" : "photo"
                let id = try await session.api.upload(fileURL: fileURL, mime: mime, kind: kind)
                try await session.api.postStory(kind: kind, text: text.trimmingCharacters(in: .whitespacesAndNewlines), uploadID: id)
            }
            onPosted()
            dismiss()
        } catch {
            self.error = L10n.statusFailed
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
