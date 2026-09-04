import Observation
import SwiftUI
import WebKit

/// 웹 화면 안에서 링크를 어떻게 다룰지. WebKit 없이 검사할 수 있게 순수 함수로 뺐다.
enum WebLinkRoute: Equatable {
    /// 웹뷰가 그대로 연다
    case inApp
    /// `tel:` · `mailto:` · `kakaomap:` 처럼 웹뷰가 열 수 없는 것 — 시스템에 넘긴다
    case system(URL)
    /// 주소가 없거나 스킴을 알 수 없다
    case blocked
}

enum WebLink {
    /// 웹뷰 안에서 열 것과 밖으로 내보낼 것을 가른다.
    ///
    /// ⚠️ **호스트로 가르지 않는다.** 웹 화면은 구글 지도·카카오맵 SDK를 다른 호스트에서 받아 쓰기
    /// 때문에, "우리 도메인만 안에서" 규칙을 넣으면 지도가 통째로 죽는다. 웹뷰가 못 여는
    /// 스킴만 시스템에 넘긴다.
    static func route(for url: URL?) -> WebLinkRoute {
        guard let url, let scheme = url.scheme?.lowercased(), !scheme.isEmpty else { return .blocked }
        switch scheme {
        case "http", "https", "about", "blob", "data", "file": return .inApp
        default: return .system(url)
        }
    }
}

/// 내려받은 파일 하나. `.sheet(item:)`에 태우려고 id를 붙였다.
struct WebDownloadFile: Identifiable, Equatable {
    let id = UUID()
    let url: URL
}

/// 웹뷰의 상태와 조작을 SwiftUI 쪽에 내어 주는 창구.
@Observable
@MainActor
final class WebViewState {
    var isLoading = false
    var errorMessage: String?
    var canGoBack = false
    /// 내보내기(JSON·이미지)로 받은 파일 — 값이 생기면 공유 시트가 뜬다
    var download: WebDownloadFile?

    /// 웹뷰 자체는 관찰 대상이 아니다 — 뷰를 다시 그리게 할 값이 아니라 조작 대상이다.
    @ObservationIgnored fileprivate weak var webView: WKWebView?

    func goBack() { webView?.goBack() }

    func reload() {
        errorMessage = nil
        if webView?.url == nil { webView?.reloadFromOrigin() } else { webView?.reload() }
    }
}

/// 웹 화면을 앱 안에서 그대로 띄운다.
///
/// 계획(장소 담기·지도·예약·설정)은 웹에만 있다. 그 화면을 Swift로 다시 만들면 같은 판단이 두 벌이
/// 되므로(엔진은 하나다) 복제하지 않고 웹을 그대로 보여준다.
///
/// ⚠️ **로그인 세션은 웹뷰 안에만 있다** — 네이티브 로그인(Keychain)과 저장소가 달라 공유되지 않는다.
///    웹 화면에서는 한 번 따로 로그인해야 하고, 그 세션은 앱을 껐다 켜도 남는다(`WKWebsiteDataStore.default`).
struct WebAppView: View {
    let url: URL

    @Environment(\.dismiss) private var dismiss
    @State private var state = WebViewState()

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                WebContainer(url: url, state: state)
                    .ignoresSafeArea(edges: .bottom)
                if state.isLoading {
                    ProgressView()
                        .progressViewStyle(.linear)
                        .accessibilityLabel("불러오는 중")
                }
                if let message = state.errorMessage {
                    failure(message)
                }
            }
            .navigationTitle("웹 화면")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("닫기") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: Space.m) {
                        if state.canGoBack {
                            Button { state.goBack() } label: { Image(systemName: "chevron.left") }
                                .accessibilityLabel("뒤로")
                        }
                        Button { state.reload() } label: { Image(systemName: "arrow.clockwise") }
                            .accessibilityLabel("새로고침")
                    }
                }
            }
        }
        .sheet(item: $state.download) { file in
            ShareSheet(items: [file.url])
        }
    }

    /// 못 열었을 때 빈 화면을 남기지 않는다 — NAS가 꺼져 있거나 오프라인일 때가 대부분이다.
    private func failure(_ message: String) -> some View {
        VStack(spacing: Space.l) {
            Spacer()
            Image(systemName: "wifi.exclamationmark").font(.largeTitle).foregroundStyle(.secondary)
            Text("웹 화면을 열지 못했어요").font(.headline)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("다시 시도") { state.reload() }
                .buttonStyle(.borderedProminent)
            Spacer()
        }
        .padding(Space.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

// MARK: - WKWebView 감싸기

private struct WebContainer: UIViewRepresentable {
    let url: URL
    let state: WebViewState

    func makeCoordinator() -> WebCoordinator { WebCoordinator(state: state) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // 기본 저장소 — 로그인과 로컬 편집(localStorage)이 앱을 껐다 켜도 남는다.
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        state.webView = webView
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

/// 내비게이션·JS 대화상자·내려받기를 한 곳에서 받는다.
@MainActor
final class WebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let state: WebViewState
    private var downloadDestination: URL?
    private var hasLoadedOnce = false

    init(state: WebViewState) { self.state = state }

    // MARK: 내비게이션

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // `<a download>` — 웹의 JSON·이미지 내보내기가 이 길로 온다.
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        switch WebLink.route(for: navigationAction.request.url) {
        case .inApp:
            decisionHandler(.allow)
        case .system(let url):
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            decisionHandler(.cancel)
        case .blocked:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        state.isLoading = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedOnce = true
        state.isLoading = false
        state.errorMessage = nil
        state.canGoBack = webView.canGoBack
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finishWithError(error, webView: webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finishWithError(error, webView: webView)
    }

    private func finishWithError(_ error: Error, webView: WKWebView) {
        state.isLoading = false
        state.canGoBack = webView.canGoBack
        // 사용자가 다른 링크를 눌러 중단된 것은 실패가 아니다.
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        // 한 번이라도 그려졌으면 화면을 덮지 않는다 — 새로고침 한 번 실패했다고 보던 화면을 잃으면 안 된다.
        guard !hasLoadedOnce else { return }
        state.errorMessage = error.localizedDescription
    }

    // MARK: JS 대화상자 — 없으면 confirm()이 조용히 false가 된다(삭제·초기화가 먹통이 된다)

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        guard let host = topViewController(from: webView) else { completionHandler(); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
        host.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        guard let host = topViewController(from: webView) else { completionHandler(false); return }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
        host.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard let host = topViewController(from: webView) else { completionHandler(nil); return }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        host.present(alert, animated: true)
    }

    /// `target="_blank"` — 새 창을 만들지 않고 같은 웹뷰에서 연다(공유 링크가 그냥 사라지지 않게).
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, case .inApp = WebLink.route(for: navigationAction.request.url) {
            webView.load(navigationAction.request)
        }
        return nil
    }

    // MARK: 내려받기 — 받은 파일은 공유 시트로 넘긴다(웹뷰에는 "저장" 자리가 없다)

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("web-downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
        let destination = folder.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: destination)
        downloadDestination = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let destination = downloadDestination { state.download = WebDownloadFile(url: destination) }
        downloadDestination = nil
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestination = nil
        state.errorMessage = error.localizedDescription
    }

    private func topViewController(from webView: WKWebView) -> UIViewController? {
        var top = webView.window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

/// UIActivityViewController 한 겹. 내보낸 파일을 사진·파일·메시지로 넘길 수 있게 한다.
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
