import GoogleMaps
import KakaoMapsSDK
import SwiftUI

@main
struct TripCanvasApp: App {
    @State private var environment = AppEnvironment()

    init() {
        // 지도 SDK는 첫 지도 화면보다 먼저 키를 받아야 한다. 여기 한 번이면 끝이다.
        GMSServices.provideAPIKey(AppConfig.googleMapsKey)
        SDKInitializer.InitSDK(appKey: AppConfig.kakaoNativeKey)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(environment)
        }
    }
}

/// 로그인 상태만 가른다. 로그인돼 있으면 곧장 여행 목록 — 시작 화면에 설명을 깔지 않는다(§46 속도).
struct RootView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        if env.auth.isSignedIn {
            TripListView()
                // 들고 있던 토큰이 아직 사는지 서버에 한 번 묻는다. 죽었으면 로그인 화면으로 돌아간다.
                // 네트워크가 안 되면 세션을 버리지 않는다 — 오프라인에서 로그아웃당하지 않게.
                .task { await env.auth.restore() }
        } else {
            SignInView()
        }
    }
}

/// 로그인 · 가입 · 비밀번호 재설정을 한 화면에서 가른다.
/// 화면은 제공자를 모른다 — `AuthStore`가 `/api/auth/*`(웹과 같은 서버)와 이야기한다.
struct SignInView: View {
    enum Mode: String, CaseIterable {
        case signIn = "로그인"
        case signUp = "가입"
    }

    @Environment(AppEnvironment.self) private var env
    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""

    /// 가입은 오타 하나로 못 받는 메일이 되므로 최소한의 모양은 여기서 거른다.
    private var canSubmit: Bool {
        email.contains("@") && !email.hasPrefix("@") && password.count >= 8
    }

    var body: some View {
        VStack(spacing: Space.l) {
            Spacer()
            VStack(spacing: Space.s) {
                Text("With J").font(.largeTitle.weight(.bold))
                Text("웹에서 만든 여행이 여기서 이어집니다.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Picker("", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            VStack(spacing: Space.m) {
                TextField("이메일", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(mode == .signUp ? "비밀번호 (8자 이상)" : "비밀번호", text: $password)
                    .textContentType(mode == .signUp ? .newPassword : .password)
            }
            .textFieldStyle(.roundedBorder)

            if let notice = env.auth.notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if let error = env.auth.lastError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            PrimaryActionButton(title: mode.rawValue, isBusy: env.auth.isWorking) {
                let (mail, pass) = (email, password)
                Task {
                    switch mode {
                    case .signIn: await env.auth.signIn(email: mail, password: pass)
                    case .signUp: await env.auth.signUp(email: mail, password: pass)
                    }
                }
            }
            .disabled(!canSubmit)

            if mode == .signIn {
                // 새 비밀번호를 정하는 화면은 웹에만 있다 — 메일 링크가 웹으로 간다.
                Button("비밀번호를 잊었어요") {
                    let mail = email
                    Task { await env.auth.requestPasswordReset(email: mail) }
                }
                .font(.footnote)
                .disabled(!email.contains("@") || env.auth.isWorking)
            }

            Text("웹 With J와 같은 계정을 사용합니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(Space.xl)
        .onChange(of: mode) { _, _ in env.auth.dismissNotice() }
    }
}
