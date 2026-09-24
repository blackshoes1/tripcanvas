import GoogleSignIn
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
                .onOpenURL { url in _ = GIDSignIn.sharedInstance.handle(url) }
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
    @State private var social = SocialSignIn()
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    /// 가입은 오타 하나로 못 받는 메일이 되므로 최소한의 모양은 여기서 거른다.
    private var canSubmit: Bool {
        email.contains("@") && !email.hasPrefix("@") && password.count >= 8
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("WITH J")
                    .font(Typeface.meta(.caption))
                    .tracking(2.5)
                    .foregroundStyle(Ink.accent)
                    .padding(.bottom, Space.xl)

                Text(mode == .signIn ? "여행을 이어가요" : "여행을 시작해요")
                    .font(Typeface.editorial(.largeTitle))
                    .foregroundStyle(Ink.ink)
                    .padding(.bottom, Space.s)
                Text("웹에서 만든 일정과 저장한 장소를\n여기서 그대로 만나보세요.")
                    .font(.subheadline)
                    .foregroundStyle(Ink.soft)
                    .lineSpacing(4)
                    .padding(.bottom, 36)

                if !social.providers.isEmpty {
                    VStack(spacing: Space.m) {
                        ForEach(social.providers) { provider in
                            Button {
                                Task { await social.signIn(provider, auth: env.auth) }
                            } label: {
                                HStack(spacing: Space.m) {
                                    if provider == .google {
                                        Image("GoogleG")
                                            .resizable()
                                            .frame(width: 18, height: 18)
                                            .accessibilityHidden(true)
                                    } else if provider == .apple {
                                        Image(systemName: "apple.logo")
                                            .frame(width: 18)
                                            .accessibilityHidden(true)
                                    }
                                    Text(provider.title)
                                        .font(.system(size: 15, weight: .semibold))
                                    if provider == .google || provider == .apple {
                                        Color.clear.frame(width: 18, height: 18)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 54)
                                .foregroundStyle(provider == .google ? Color(red: 0.12, green: 0.12, blue: 0.12) : Ink.ink)
                                .background(provider == .google ? Color.white : Ink.raised,
                                            in: RoundedRectangle(cornerRadius: 14))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(provider.title)
                            .disabled(social.isWorking || env.auth.isWorking)
                            .opacity(social.isWorking || env.auth.isWorking ? 0.55 : 1)
                        }
                        if social.isWorking { ProgressView("로그인 확인 중") }
                        if let error = social.error {
                            Text(error).font(.footnote).foregroundStyle(Ink.danger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.bottom, Space.xl)

                    HStack(spacing: Space.m) {
                        Rectangle().fill(Ink.hairline).frame(height: 1)
                        Text("또는 이메일로")
                            .font(.caption)
                            .foregroundStyle(Ink.soft)
                            .fixedSize()
                        Rectangle().fill(Ink.hairline).frame(height: 1)
                    }
                    .padding(.bottom, Space.xl)
                }

                VStack(alignment: .leading, spacing: Space.l) {
                    VStack(alignment: .leading, spacing: Space.s) {
                        Text("이메일").font(.subheadline.weight(.medium)).foregroundStyle(Ink.ink)
                        TextField("", text: $email,
                                  prompt: Text("이메일 주소").foregroundColor(Ink.faint))
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.next)
                            .focused($focusedField, equals: .email)
                            .onSubmit { focusedField = .password }
                            .signInField()
                    }
                    VStack(alignment: .leading, spacing: Space.s) {
                        HStack {
                            Text("비밀번호").font(.subheadline.weight(.medium)).foregroundStyle(Ink.ink)
                            Spacer()
                            if mode == .signIn {
                                Button("비밀번호 재설정") {
                                    if email.contains("@") {
                                        Task { await env.auth.requestPasswordReset(email: email) }
                                    } else {
                                        focusedField = .email
                                    }
                                }
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Ink.accent)
                                .disabled(env.auth.isWorking || social.isWorking)
                            }
                        }
                        SecureField("", text: $password,
                                    prompt: Text(mode == .signUp ? "8자 이상 입력" : "비밀번호 입력")
                                        .foregroundColor(Ink.faint))
                            .textContentType(mode == .signUp ? .newPassword : .password)
                            .submitLabel(.go)
                            .focused($focusedField, equals: .password)
                            .onSubmit { if canSubmit { submit() } }
                            .signInField()
                    }
                }

                if let notice = env.auth.notice {
                    Text(notice).font(.footnote).foregroundStyle(Ink.soft)
                        .padding(.top, Space.l)
                }
                if let error = env.auth.lastError {
                    Text(error).font(.footnote).foregroundStyle(Ink.danger)
                        .padding(.top, Space.l)
                }

                Button(action: submit) {
                    HStack(spacing: Space.s) {
                        if env.auth.isWorking { ProgressView().tint(Ink.paper) }
                        Text(mode == .signIn ? "이메일로 로그인" : "계정 만들기")
                    }
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .foregroundStyle(canSubmit ? Ink.paper : Ink.soft)
                    .background(canSubmit ? Ink.accent : Ink.sunken,
                                in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .disabled(!canSubmit || env.auth.isWorking || social.isWorking)
                .padding(.top, Space.xl)

                HStack(spacing: Space.xs) {
                    Text(mode == .signIn ? "아직 계정이 없나요?" : "이미 계정이 있나요?")
                        .foregroundStyle(Ink.soft)
                    Button(mode == .signIn ? "가입하기" : "로그인") {
                        mode = mode == .signIn ? .signUp : .signIn
                        password = ""
                        focusedField = nil
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(Ink.accent)
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity)
                .padding(.top, Space.xl)

                Text("웹과 앱에서 같은 계정을 사용해요.")
                    .font(.caption)
                    .foregroundStyle(Ink.faint)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
            }
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Space.xl)
            .padding(.top, 52)
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Ink.paper.ignoresSafeArea())
        .task { await social.loadProviders() }
        .onDisappear { social.cancel() }
        .onChange(of: mode) { _, _ in env.auth.dismissNotice() }
    }

    private func submit() {
        let (mail, pass) = (email, password)
        Task {
            switch mode {
            case .signIn: await env.auth.signIn(email: mail, password: pass)
            case .signUp: await env.auth.signUp(email: mail, password: pass)
            }
        }
    }
}

private extension View {
    func signInField() -> some View {
        padding(.horizontal, Space.l)
            .frame(height: 54)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Ink.hairline))
            .foregroundStyle(Ink.ink)
    }
}
