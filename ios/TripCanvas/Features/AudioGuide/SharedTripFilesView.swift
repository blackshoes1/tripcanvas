import SwiftUI
import UniformTypeIdentifiers
import QuickLook

@MainActor
struct SharedTripFilesView: View {
    let tripID: String
    var spot: TripSpot? = nil
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var files: [SharedTripFile] = []
    @State private var canEdit = false
    @State private var busy = false
    @State private var offline = false
    @State private var importer = false
    @State private var showsLocal = false
    @State private var status: String?
    @State private var preview: URL?
    @State private var deleting: SharedTripFile?
    @State private var renaming: SharedTripFile?
    @State private var renameText = ""
    @State private var savedIDs: Set<String> = []
    @State private var visible = false
    @State private var player = SharedGuidePlayer.shared
    private var account: String? { env.auth.session?.userId }
    private var kind: String { spot == nil ? "DOCUMENT" : "AUDIO" }
    private var placeKey: String { spot.map(AudioGuidePlace.key) ?? "" }
    private var path: String { "/api/v1/trips/" + tripID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)! + "/files" }
    private var shown: [SharedTripFile] { files.filter { $0.kind == kind && (kind != "AUDIO" || $0.placeKey == placeKey) } }
    private var types: [UTType] { spot == nil ? [.pdf, .jpeg, .png, .webP, .plainText] : [.audio] }
    private func current(_ id: String) -> Bool { visible && account == id }

    var body: some View {
        NavigationStack {
            PaperList {
                Section {
                    if let spot { Text(spot.name).font(.headline) }
                    Text("로그인한 여행 멤버와 공유해요. 출발 전에 오프라인으로 저장하면 인터넷 없이 열 수 있어요.")
                        .foregroundStyle(Ink.soft)
                    if offline { Label("오프라인 · 저장해 둔 파일만 열 수 있어요", systemImage: "wifi.slash") }
                }
                if let status { Section { Text(status).foregroundStyle(Ink.soft) } }
                if busy { Section { ProgressView("파일을 처리하는 중…") } }
                if canEdit {
                    Section {
                        Button { importer = true } label: { Label("파일 추가", systemImage: "plus.circle").frame(minHeight: 44) }
                            .disabled(busy)
                    } footer: {
                        Text(spot == nil ? "PDF·JPEG·PNG·WebP·TXT · 파일당 10MB. 여행당 전체 파일은 100개·200MB까지 보관해요."
                             : "MP3·M4A·WAV·OGG·FLAC · 파일당 25MB. 여러 음성을 골라 제목과 순서를 정할 수 있어요.")
                    }
                }
                if shown.isEmpty, !busy {
                    Section { Text(spot == nil ? "아직 첨부한 문서가 없어요." : "이 장소에 공유한 음성이 없어요.").foregroundStyle(Ink.soft) }
                }
                ForEach(shown) { file in
                    Section {
                        Text(file.title).font(.headline)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file) +
                             (savedIDs.contains(file.id) ? " · 오프라인 저장됨" : " · 여행 멤버와 공유"))
                            .font(.caption).foregroundStyle(Ink.soft)
                        Button {
                            Task { await open(file) }
                        } label: {
                            Label(file.kind == "AUDIO" ? (player.fileID == file.id && player.isPlaying ? "일시정지" : "듣기") : "문서 열기",
                                  systemImage: file.kind == "AUDIO" ? "headphones" : "doc")
                                .frame(minHeight: 44)
                        }.disabled(busy || (offline && !savedIDs.contains(file.id)))
                        if player.fileID == file.id {
                            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                                VStack {
                                    Slider(value: Binding(get: { player.time }, set: { player.time = $0 }), in: 0...max(1, player.duration))
                                        .accessibilityLabel("재생 위치")
                                    Text(clock(player.time) + " / " + clock(player.duration)).font(.caption.monospacedDigit())
                                }
                            }
                        }
                        Button(savedIDs.contains(file.id) ? "이 기기의 사본 지우기" : "오프라인 저장") {
                            Task { await downloadOrRemove(file) }
                        }.disabled(busy || (offline && !savedIDs.contains(file.id))).frame(minHeight: 44)
                        if canEdit {
                            HStack {
                                Button("제목 수정") { renaming = file; renameText = file.title }.disabled(busy)
                                if spot != nil, shown.first?.id != file.id {
                                    Button("위로") { Task { await edit(file, patch: ["move": "UP"]) } }.disabled(busy)
                                }
                                Button("공유 파일 삭제", role: .destructive) { deleting = file }.disabled(busy)
                            }.frame(minHeight: 44)
                        }
                    }
                }
                if player.fileID != nil {
                    Section {
                        Text(player.title).font(.caption)
                        Button("음성 재생 종료") { player.stop() }.frame(minHeight: 44)
                        if let error = player.errorMessage { Text(error).foregroundStyle(Ink.warning) }
                    }
                }
                if spot != nil {
                    Section {
                        Button("이 iPhone에만 보관한 음성") { player.pause(); showsLocal = true }.frame(minHeight: 44)
                    }
                }
            }
            .navigationTitle(spot == nil ? "여행 티켓·문서" : "음성 가이드")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("새로고침") { Task { await reload() } }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } }
            }
        }
        .quickLookPreview($preview)
        .fileImporter(isPresented: $importer, allowedContentTypes: types, allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await upload(urls) }
            case .failure: status = "파일을 열지 못했어요. 파일 앱에서 내려받은 뒤 다시 골라 주세요."
            }
        }
        .sheet(isPresented: $showsLocal) { if let spot { AudioGuideView(tripID: tripID, spot: spot) } }
        .confirmationDialog("이 공유 파일을 여행에서 삭제할까요?", isPresented: Binding(
            get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                if let deleting { Button("공유 파일 삭제", role: .destructive) { Task { await remove(deleting) } } }
                Button("취소", role: .cancel) { deleting = nil }
            } message: { Text("동행자가 새로 내려받을 수 없게 돼요. 이미 내려받은 다른 기기의 사본은 남을 수 있어요.") }
        .alert("표시할 제목", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("제목", text: $renameText)
            Button("저장") { if let file = renaming { Task { await edit(file, patch: ["title": renameText.trimmingCharacters(in: .whitespacesAndNewlines)]) } } }
            Button("취소", role: .cancel) { renaming = nil }
        }
        .task { visible = true; await reload() }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .onChange(of: account) { _, _ in player.stop(); dismiss() }
    }
    private func reload() async {
        guard let account else { return }
        busy = true
        defer { busy = false }
        do {
            let response: SharedTripFilesResponse = try await env.service.api.get(path)
            guard current(account) else { return }
            files = response.files; canEdit = response.canEdit; offline = false; status = nil
            try? await SharedTripFileStore.shared.saveList(files, account: account, trip: tripID)
        } catch {
            guard current(account) else { return }
            canEdit = false
            if unavailable(error) {
                files = (try? await SharedTripFileStore.shared.list(account: account, trip: tripID)) ?? []
                offline = true; status = files.isEmpty ? "미리 저장한 파일이 없어요. 연결한 뒤 파일을 먼저 저장해 주세요." : "연결할 수 없어 저장해 둔 목록을 보여 드려요."
            } else { files = []; status = error.localizedDescription }
        }
        var saved: Set<String> = []
        for file in files {
            if (try? await SharedTripFileStore.shared.localURL(file, account: account, trip: tripID)) != nil { saved.insert(file.id) }
        }
        if current(account) { savedIDs = saved }
    }
    private func local(_ file: SharedTripFile, account: String) async throws -> URL {
        if let url = try await SharedTripFileStore.shared.localURL(file, account: account, trip: tripID) { return url }
        let data = try await env.service.api.fileRequest(path: path + "/" + file.id)
        guard current(account) else { throw APIError.unauthorized }
        let url = try await SharedTripFileStore.shared.save(data, file: file, account: account, trip: tripID)
        savedIDs.insert(file.id); return url
    }
    private func open(_ file: SharedTripFile) async {
        guard let account, !busy else { return }
        busy = true; defer { busy = false }
        do {
            let url = try await local(file, account: account)
            guard current(account) else { return }
            if file.kind == "AUDIO" { try player.play(file, url: url, account: account) }
            else { preview = url }
        } catch { if current(account) { status = error.localizedDescription } }
    }
    private func downloadOrRemove(_ file: SharedTripFile) async {
        guard let account, !busy else { return }
        busy = true; defer { busy = false }
        do {
            if savedIDs.contains(file.id) {
                if player.fileID == file.id { player.stop() }
                try await SharedTripFileStore.shared.remove(file, account: account, trip: tripID)
                if current(account) { savedIDs.remove(file.id) }
            } else {
                try await SharedTripFileStore.shared.saveList(files, account: account, trip: tripID)
                _ = try await local(file, account: account)
            }
        } catch { if current(account) { status = error.localizedDescription } }
    }
    private func upload(_ urls: [URL]) async {
        guard let account, !busy else { return }
        guard urls.count <= 20 else { status = "한 번에 최대 20개까지 골라 주세요."; return }
        busy = true; defer { busy = false }
        var failures: [String] = []
        for (index, url) in urls.enumerated() {
            guard current(account) else { return }
            status = String(index + 1) + " / " + String(urls.count) + " · " + url.lastPathComponent + " 업로드 중…"
            do {
                let data = try await Task.detached(priority: .userInitiated) {
                    let accessed = url.startAccessingSecurityScopedResource()
                    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard values.isRegularFile == true, let size = values.fileSize, size > 0 else { throw APIError.badRequest("비어 있지 않은 파일을 골라 주세요.") }
                    guard size <= 25 * 1024 * 1024 else { throw APIError.badRequest("공유 파일은 최대 25MB까지 올릴 수 있어요.") }
                    let handle = try FileHandle(forReadingFrom: url)
                    defer { try? handle.close() }
                    let data = try handle.read(upToCount: 25 * 1024 * 1024 + 1) ?? Data()
                    guard data.count <= 25 * 1024 * 1024 else { throw APIError.badRequest("공유 파일은 최대 25MB까지 올릴 수 있어요.") }
                    return data
                }.value
                guard current(account) else { return }
                if kind == "DOCUMENT", data.count > 10 * 1024 * 1024 { throw APIError.badRequest("문서는 최대 10MB까지 올릴 수 있어요.") }
                let query = [URLQueryItem(name: "kind", value: kind), URLQueryItem(name: "placeKey", value: placeKey), URLQueryItem(name: "name", value: url.lastPathComponent)]
                let response = try await env.service.api.fileRequest(path: path, method: "POST", query: query, bytes: data)
                struct Uploaded: Decodable { let file: SharedTripFile }
                let file = try JSONDecoder().decode(Uploaded.self, from: response).file
                guard current(account) else { return }
                _ = try? await SharedTripFileStore.shared.save(data, file: file, account: account, trip: tripID)
            } catch { failures.append(url.lastPathComponent + ": " + error.localizedDescription) }
        }
        guard current(account) else { return }
        await reload()
        if !failures.isEmpty { status = failures.joined(separator: "\n") }
    }
    private func edit(_ file: SharedTripFile, patch: [String: Any]) async {
        guard let account, !busy else { return }
        busy = true; defer { busy = false }
        do {
            struct Ok: Decodable { let ok: Bool }
            let _: Ok = try await env.service.api.patch(path + "/" + file.id, body: patch)
            if current(account) { await reload() }
        } catch { if current(account) { status = error.localizedDescription } }
    }
    private func remove(_ file: SharedTripFile) async {
        guard let account, !busy else { return }
        deleting = nil; busy = true; defer { busy = false }
        do {
            struct Ok: Decodable { let ok: Bool }
            let _: Ok = try await env.service.api.delete(path + "/" + file.id)
            if player.fileID == file.id { player.stop() }
            try? await SharedTripFileStore.shared.remove(file, account: account, trip: tripID)
            if current(account) { await reload() }
        } catch { if current(account) { status = error.localizedDescription } }
    }
    private func clock(_ seconds: Double) -> String {
        let t = Int(max(0, seconds.isFinite ? seconds : 0)); return String(format: "%d:%02d", t / 60, t % 60)
    }
    private func unavailable(_ error: Error) -> Bool {
        guard let api = error as? APIError else { return error is URLError }
        switch api {
        case .offline: return true
        case .server(let status, _): return status == 408 || status == 429 || status >= 500
        default: return false
        }
    }
}
