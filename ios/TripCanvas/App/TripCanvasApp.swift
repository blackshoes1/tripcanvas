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

/// 로그인 방법 선택과 이메일 입력을 가르고 가입 · 비밀번호 재설정을 제공한다.
/// 화면은 제공자를 모른다 — `AuthStore`가 `/api/auth/*`(웹과 같은 서버)와 이야기한다.
struct SignInView: View {
    enum Mode: String, CaseIterable {
        case signIn = "로그인"
        case signUp = "가입"
    }

    @Environment(AppEnvironment.self) private var env
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var social = SocialSignIn()
    @State private var showsEmailForm = false
    /// 브랜드 장면이 시작된 때. 이메일 화면에 갔다 돌아와도 다시 재생하지 않는다.
    @State private var introStart: Date?
    @State private var introDone = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    /// 가입은 오타 하나로 못 받는 메일이 되므로 최소한의 모양은 여기서 거른다.
    private var canSubmit: Bool {
        email.contains("@") && !email.hasPrefix("@") && password.count >= 8
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer(minLength: 24)

                    HStack(spacing: Space.l) {
                        if showsEmailForm {
                            Button {
                                setEmailForm(false)
                                mode = .signIn
                                password = ""
                                focusedField = nil
                                env.auth.dismissNotice()
                            } label: {
                                Image(systemName: "chevron.left")
                                    .font(.body.weight(.semibold))
                                    .frame(width: 24, height: 44)
                            }
                            .accessibilityLabel("로그인 방법으로 돌아가기")
                        }
                        Text("With J")
                            .font(.title3.weight(.semibold))
                    }
                    .foregroundStyle(Ink.ink)
                    .padding(.bottom, compact(geometry) ? Space.l : 28)

                    if showsEmailForm {
                        emailForm
                            .transition(reduceMotion ? .identity : .opacity.combined(with: .offset(x: 16)))
                    } else {
                        methodPicker(compact: compact(geometry))
                            .transition(reduceMotion ? .identity : .opacity.combined(with: .offset(x: -16)))
                    }

                    accountSwitch
                        .padding(.top, compact(geometry) ? Space.l : 28)

                    Spacer(minLength: 24)
                }
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height - Space.xl * 2)
                .padding(.horizontal, Space.xl)
                .padding(.vertical, Space.xl)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Ink.paper.ignoresSafeArea())
        .task {
            guard introStart == nil, !introDone else { return }
            if reduceMotion { introDone = true; return }
            // 앱이 열리는 전환(약 0.4초)이 끝난 뒤에 시작한다 — 곧바로 시작하면 흩어진 장면이
            // 전환에 가려, 이미 모여 있는 카드부터 보인다(시뮬레이터 녹화로 확인).
            try? await Task.sleep(for: .milliseconds(400))
            introStart = .now
            // 끝나면 타임라인을 멈춘다 — 멈춘 장면을 매 프레임 다시 그리지 않게.
            try? await Task.sleep(for: .seconds(ItineraryIntroTimeline.duration + 0.1))
            introDone = true
        }
        .task { await social.loadProviders() }
        .onDisappear { social.cancel() }
        .onChange(of: mode) { _, _ in env.auth.dismissNotice() }
    }

    /// 작은 화면(SE)에서는 장면을 줄여 로그인 버튼이 첫 화면 안에 남게 한다.
    private func compact(_ geometry: GeometryProxy) -> Bool { geometry.size.height < 720 }

    /// 장면의 지금 모양. 움직임 줄이기이거나 이미 끝났으면 마지막 모양이다.
    private func introFrame(at date: Date) -> ItineraryIntroTimeline.Frame {
        if reduceMotion || introDone { return ItineraryIntroTimeline.final }
        guard let introStart else { return ItineraryIntroTimeline.frame(at: 0) }
        return ItineraryIntroTimeline.frame(at: date.timeIntervalSince(introStart))
    }

    private func methodPicker(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            TimelineView(.animation(paused: introDone || reduceMotion)) { context in
                let frame = introFrame(at: context.date)
                VStack(alignment: .leading, spacing: 0) {
                    // 큰 글자에서는 장면을 빼고 말과 버튼만 남긴다 — 장식이 버튼을 화면 밖으로 밀면 안 된다.
                    if !typeSize.isAccessibilitySize {
                        ItineraryIntroScene(frame: frame, compact: compact)
                            .padding(.bottom, compact ? Space.l : 28)
                    }
                    Text("가고 싶은 곳이\n하루가 되기까지")
                        .font(Typeface.editorial(.title))
                        .foregroundStyle(Ink.ink)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .introReveal(frame.headline)
                    Text("계획할 때도, 여행 중에도 곁에서.")
                        .font(.subheadline)
                        .foregroundStyle(Ink.soft)
                        .padding(.top, Space.s)
                        .introReveal(frame.subline)
                }
            }
            .padding(.bottom, compact ? Space.l : 32)

            VStack(spacing: Space.m) {
                providerButton(.google)
                ForEach(social.providers.filter { $0 != .google }) { provider in
                    providerButton(provider)
                }

                Button {
                    mode = .signIn
                    setEmailForm(true)
                } label: {
                    Label("이메일로 계속하기", systemImage: "envelope")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 54)
                        .foregroundStyle(Ink.paper)
                        .background(Ink.accent, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(SignInButtonStyle())
                .disabled(social.isWorking || env.auth.isWorking)
            }

            if social.isWorking { ProgressView("로그인 확인 중").padding(.top, Space.l) }
            if let error = social.error {
                Text(error).font(.footnote).foregroundStyle(Ink.danger)
                    .padding(.top, Space.l)
            }

        }
    }

    private func providerButton(_ provider: SocialSignIn.Provider) -> some View {
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
                    .font(.subheadline.weight(.semibold))
                if provider == .google || provider == .apple {
                    Color.clear.frame(width: 18, height: 18)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .foregroundStyle(Ink.ink)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Ink.hairline))
        }
        .buttonStyle(SignInButtonStyle())
        .accessibilityLabel(provider.title)
        .disabled(social.isWorking || env.auth.isWorking)
    }

    private var emailForm: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(mode == .signIn ? "이메일로 로그인" : "계정 만들기")
                .font(.title.weight(.semibold))
                .foregroundStyle(Ink.ink)
            Text("웹에서 사용하던 계정으로 여행을 이어가세요.")
                .font(.subheadline)
                .foregroundStyle(Ink.soft)
                .padding(.top, Space.s)
                .padding(.bottom, 40)

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
                    Text("비밀번호").font(.subheadline.weight(.medium)).foregroundStyle(Ink.ink)
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

            if mode == .signIn {
                Button("비밀번호 재설정") {
                    if email.contains("@") {
                        Task { await env.auth.requestPasswordReset(email: email) }
                    } else {
                        focusedField = .email
                    }
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Ink.accent)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.top, Space.m)
                .disabled(env.auth.isWorking)
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
                    Text(mode == .signIn ? "로그인" : "계정 만들기")
                }
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 54)
                .foregroundStyle(canSubmit ? Ink.paper : Ink.soft)
                .background(canSubmit ? Ink.accent : Ink.sunken,
                            in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(SignInButtonStyle())
            .disabled(!canSubmit || env.auth.isWorking)
            .padding(.top, 40)

        }
    }

    private var accountSwitch: some View {
        HStack(spacing: Space.xs) {
            Text(mode == .signIn ? "계정이 없으신가요?" : "이미 계정이 있으신가요?")
                .foregroundStyle(Ink.soft)
            Button(mode == .signIn ? "가입하기" : "로그인") {
                mode = mode == .signIn ? .signUp : .signIn
                setEmailForm(true)
                password = ""
                focusedField = nil
            }
            .fontWeight(.semibold)
            .foregroundStyle(Ink.accent)
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity)
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

    private func setEmailForm(_ visible: Bool) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) {
            showsEmailForm = visible
        }
    }
}

private struct SignInButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private extension View {
    /// 장면의 문구가 떠오르는 모양 — 아래에서 8pt 올라오며 나타난다.
    func introReveal(_ progress: Double) -> some View {
        opacity(progress).offset(y: 8 * (1 - progress))
    }

    func signInField() -> some View {
        padding(.horizontal, Space.l)
            .frame(height: 54)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Ink.hairline))
            .foregroundStyle(Ink.ink)
    }
}
