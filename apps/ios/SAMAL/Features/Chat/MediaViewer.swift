import AVKit
import SwiftUI

struct ChatMedia: Identifiable {
    let id = UUID()
    let url: URL
    let name: String
    let kind: String
}

func chatMediaKind(_ message: LocalMessage) -> String? {
    guard !message.deleted else { return nil }
    let raw = message.mediaURL.isEmpty ? message.localPath : message.mediaURL
    guard !raw.isEmpty else { return nil }
    if message.type == "photo" { return "image" }
    if message.type == "voice" || message.type == "location" || message.type == "text" { return nil }
    let ext = fileExt(message.text).isEmpty ? fileExt(raw) : fileExt(message.text)
    if ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp"].contains(ext) { return "image" }
    if ["mp4", "mov", "m4v", "webm", "mkv"].contains(ext) { return "video" }
    if message.type == "file" || message.type == "video" { return "file" }
    return nil
}

func resolveMedia(_ raw: String) -> URL? {
    if raw.hasPrefix("http://") || raw.hasPrefix("https://") || raw.hasPrefix("file://") {
        return URL(string: raw)
    }
    if raw.isEmpty { return nil }
    return URL(fileURLWithPath: raw)
}

func materializeMedia(_ url: URL, name: String) async -> URL? {
    if url.isFileURL { return url }
    let ext = fileExt(name).isEmpty ? url.pathExtension : fileExt(name)
    let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString + (ext.isEmpty ? "" : ".\(ext)"))
    do {
        let (tmp, response) = try await URLSession.shared.download(from: url)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            return nil
        }
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    } catch {
        return nil
    }
}

struct MediaCover: View {
    let item: ChatMedia
    let onClose: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if item.kind == "video" {
                ChatVideo(url: item.url)
            } else {
                ZoomImage(url: item.url)
                    .padding(12)
            }
            VStack {
                HStack(spacing: 8) {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(.white.opacity(0.16), in: Circle())
                    }
                    Text(item.name)
                        .font(SamalFont.caption())
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                Spacer()
            }
        }
    }
}

private struct ZoomImage: View {
    let url: URL
    @State private var scale: CGFloat = 1
    @State private var base: CGFloat = 1

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in scale = min(max(base * value, 1), 5) }
                            .onEnded { _ in base = scale }
                    )
            case .failure:
                Image(systemName: "photo")
                    .font(.system(size: 40))
                    .foregroundStyle(.white)
            default:
                ProgressView().tint(.white)
            }
        }
    }
}

private struct ChatVideo: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        VideoPlayer(player: player)
            .ignoresSafeArea(edges: .bottom)
            .onAppear {
                let next = AVPlayer(url: url)
                player = next
                next.play()
            }
            .onDisappear {
                player?.pause()
                player = nil
            }
    }
}

private func fileExt(_ raw: String) -> String {
    let clean = raw.split(separator: "?").first.map(String.init) ?? raw
    let name = (clean as NSString).lastPathComponent
    let ext = (name as NSString).pathExtension
    return ext.lowercased()
}
