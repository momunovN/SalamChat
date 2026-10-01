import AVKit
import QuickLook
import SwiftUI
import UIKit

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
    if url.isFileURL {
        return previewCopy(url, name: name, owned: false)
    }
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
        return previewCopy(dest, name: name, owned: true)
    } catch {
        return nil
    }
}

struct MediaCover: View {
    let item: ChatMedia
    let onClose: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            if item.kind == "doc" {
                VStack(spacing: 0) {
                    bar
                    DocPreview(url: item.url)
                }
            } else if item.kind == "video" {
                ChatVideo(url: item.url)
            } else {
                ZoomImage(url: item.url)
                    .padding(12)
            }
            if item.kind != "doc" {
                bar
            }
        }
    }

    private var bar: some View {
        HStack(spacing: 8) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(0.16), in: Circle())
            }
            if item.kind != "image" {
                Text(item.name)
                    .font(SamalFont.caption())
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(item.kind == "doc" ? Color.black : Color.clear)
    }
}

private struct DocPreview: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> PreviewHost {
        PreviewHost(url: url, source: context.coordinator)
    }

    func updateUIViewController(_ host: PreviewHost, context: Context) {
        host.show(url)
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}

private final class PreviewHost: UIViewController {
    private let preview = QLPreviewController()
    private let source: DocPreview.Coordinator

    init(url: URL, source: DocPreview.Coordinator) {
        self.source = source
        source.url = url
        super.init(nibName: nil, bundle: nil)
        preview.dataSource = source
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        preview.dataSource = source
        addChild(preview)
        preview.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(preview.view)
        NSLayoutConstraint.activate([
            preview.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            preview.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            preview.view.topAnchor.constraint(equalTo: view.topAnchor),
            preview.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        preview.didMove(toParent: self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        preview.reloadData()
        hideChrome(preview.view)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        hideChrome(preview.view)
    }

    func show(_ url: URL) {
        guard url != source.url else { return }
        source.url = url
        preview.reloadData()
    }

    private func hideChrome(_ view: UIView) {
        for sub in view.subviews {
            if sub is UINavigationBar || sub is UIToolbar {
                if !sub.isHidden { sub.isHidden = true }
            } else {
                hideChrome(sub)
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

private func previewCopy(_ url: URL, name: String, owned: Bool) -> URL? {
    let wanted = preferredExtension(name: name, file: url)
    if wanted.isEmpty || url.pathExtension.lowercased() == wanted { return url }
    let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension(wanted)
    do {
        try? FileManager.default.removeItem(at: dest)
        if owned {
            try FileManager.default.moveItem(at: url, to: dest)
        } else {
            try FileManager.default.copyItem(at: url, to: dest)
        }
        return dest
    } catch {
        return url
    }
}

private func preferredExtension(name: String, file: URL) -> String {
    let fromName = fileExt(name)
    if !fromName.isEmpty && fromName != "bin" && fromName != "dat" { return fromName }
    let fromFile = file.pathExtension.lowercased()
    if !fromFile.isEmpty && fromFile != "bin" && fromFile != "dat" { return fromFile }
    return sniffedExtension(file) ?? ""
}

private func sniffedExtension(_ url: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    defer { try? handle.close() }
    let data = (try? handle.read(upToCount: 64)) ?? Data()
    if data.starts(with: Data("%PDF".utf8)) { return "pdf" }
    if data.count >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF { return "jpg" }
    if data.starts(with: Data([0x89, 0x50, 0x4E, 0x47])) { return "png" }
    if data.starts(with: Data("GIF8".utf8)) { return "gif" }
    if data.count >= 12 && data.starts(with: Data("RIFF".utf8)) && data.subdata(in: 8..<12) == Data("WEBP".utf8) { return "webp" }
    if data.count >= 12 && data.starts(with: Data("RIFF".utf8)) && data.subdata(in: 8..<12) == Data("WAVE".utf8) { return "wav" }
    if data.starts(with: Data("ID3".utf8)) { return "mp3" }
    if data.starts(with: Data("fLaC".utf8)) { return "flac" }
    if data.starts(with: Data("OggS".utf8)) { return "ogg" }
    if data.starts(with: Data("{\\rtf".utf8)) { return "rtf" }
    if data.count >= 12 && data.subdata(in: 4..<8) == Data("ftyp".utf8) {
        let brand = String(data: data.subdata(in: 8..<12), encoding: .ascii)?.lowercased() ?? ""
        if brand.hasPrefix("m4a") { return "m4a" }
        if brand.hasPrefix("hei") || brand == "mif1" { return "heic" }
        return "mp4"
    }
    if data.count >= 4 && data[0] == 0x1A && data[1] == 0x45 && data[2] == 0xDF && data[3] == 0xA3 { return "webm" }
    if data.count >= 4 && data[0] == 0x50 && data[1] == 0x4B && (data[2] == 0x03 || data[2] == 0x05 || data[2] == 0x07) { return "zip" }
    return nil
}

private func fileExt(_ raw: String) -> String {
    let clean = raw.split(separator: "?").first.map(String.init) ?? raw
    let name = (clean as NSString).lastPathComponent
    let ext = (name as NSString).pathExtension
    return ext.lowercased()
}
