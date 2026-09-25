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
    @State private var introStep = 0
    @State private var routeProgress: CGFloat = 0
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
                    Color.clear.frame(height: 24)

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
                    .padding(.bottom, 24)
                    .opacity(introStep >= 1 || reduceMotion ? 1 : 0)
                    .offset(y: introStep >= 1 || reduceMotion ? 0 : 14)

                    if showsEmailForm {
                        emailForm
                            .transition(reduceMotion ? .identity : .opacity.combined(with: .offset(x: 16)))
                    } else {
                        JourneyIntroMark(progress: routeProgress,
                                         destinationVisible: introStep >= 3 || reduceMotion)
                            .padding(.bottom, 24)
                            .opacity(introStep >= 1 || reduceMotion ? 1 : 0)
                            .offset(y: introStep >= 1 || reduceMotion ? 0 : 10)
                        methodPicker
                            .transition(reduceMotion ? .identity : .opacity.combined(with: .offset(x: -16)))
                    }

                    accountSwitch
                        .padding(.top, 32)
                        .opacity(introStep >= 7 || reduceMotion ? 1 : 0)
                        .offset(y: introStep >= 7 || reduceMotion ? 0 : 10)
                        .allowsHitTesting(introStep >= 7 || reduceMotion)
                        .accessibilityHidden(introStep < 7 && !reduceMotion)

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
            guard introStep == 0 else { return }
            if reduceMotion {
                routeProgress = 1
                introStep = 7
                return
            }
            for (step, pause) in [(1, 80), (2, 180), (3, 820), (4, 160), (5, 190), (6, 230), (7, 230)] {
                try? await Task.sleep(for: .milliseconds(pause))
                guard !Task.isCancelled else { return }
                withAnimation(step == 2 ? .easeInOut(duration: 0.76) : .easeOut(duration: 0.34)) {
                    if step == 2 { routeProgress = 1 }
                    introStep = step
                }
            }
        }
        .task { await social.loadProviders() }
        .onDisappear { social.cancel() }
        .onChange(of: mode) { _, _ in env.auth.dismissNotice() }
    }

    private var methodPicker: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("다시 만나 반가워요")
                .font(Typeface.editorial(.title2).weight(.bold))
                .foregroundStyle(Ink.ink)
                .opacity(introStep >= 3 || reduceMotion ? 1 : 0)
                .offset(y: introStep >= 3 || reduceMotion ? 0 : 22)
            Text("여행 일정을 이어서 확인하세요.")
                .font(.subheadline)
                .foregroundStyle(Ink.soft)
                .padding(.top, Space.s)
                .padding(.bottom, 48)
                .opacity(introStep >= 4 || reduceMotion ? 1 : 0)
                .offset(y: introStep >= 4 || reduceMotion ? 0 : 14)

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
                .opacity(introStep >= 6 || reduceMotion ? 1 : 0)
                .offset(y: introStep >= 6 || reduceMotion ? 0 : 14)
                .allowsHitTesting(introStep >= 6 || reduceMotion)
                .accessibilityHidden(introStep < 6 && !reduceMotion)
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
        .opacity(introStep >= 5 || reduceMotion ? 1 : 0)
        .offset(y: introStep >= 5 || reduceMotion ? 0 : 14)
        .allowsHitTesting(introStep >= 5 || reduceMotion)
        .accessibilityHidden(introStep < 5 && !reduceMotion)
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

/// 여행의 경로가 J에 닿는 짧은 브랜드 장면. 로그인 선택지는 처음부터 제자리를 차지한다.
private struct JourneyIntroMark: View {
    let progress: CGFloat
    let destinationVisible: Bool

    var body: some View {
        GeometryReader { geometry in
            let destination = JourneyRoute.point(at: 1, width: geometry.size.width)
            ZStack(alignment: .topLeading) {
                Circle()
                    .stroke(Ink.accent.opacity(0.07), lineWidth: 1)
                    .frame(width: 210, height: 210)
                    .position(x: geometry.size.width * 0.48, y: 96)
                Circle()
                    .stroke(Ink.accent.opacity(0.07), lineWidth: 1)
                    .frame(width: 154, height: 154)
                    .position(x: geometry.size.width * 0.48, y: 96)

                HStack {
                    Text("WITH J  /  JOURNEY NOTE")
                    Spacer()
                    Text("01")
                }
                .metaLabel()
                .padding(.horizontal, 20)
                .padding(.top, 17)

                JourneyRoute()
                    .stroke(Ink.soft.opacity(0.20), style: StrokeStyle(lineWidth: 1, dash: [2, 6]))
                JourneyRoute(progress: progress)
                    .stroke(Ink.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))

                Circle()
                    .fill(Ink.paper)
                    .frame(width: 11, height: 11)
                    .overlay(Circle().strokeBorder(Ink.accent, lineWidth: 2))
                    .position(JourneyRoute.point(at: 0, width: geometry.size.width))

                Image(systemName: "paperplane.fill")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Ink.accent)
                    .frame(width: 24, height: 24)
                    .modifier(JourneyTravelEffect(progress: progress, width: geometry.size.width))
                    .opacity(progress > 0 && !destinationVisible ? 1 : 0)

                JourneyWaypoint(progress: progress, fraction: 0.37, width: geometry.size.width)
                JourneyWaypoint(progress: progress, fraction: 0.72, width: geometry.size.width)

                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Ink.accent.opacity(0.24), lineWidth: 1)
                        .frame(width: 56, height: 56)
                    RoundedRectangle(cornerRadius: 9)
                        .fill(Ink.accent)
                        .frame(width: 44, height: 44)
                    Text("J")
                        .font(Typeface.editorial(.title3).weight(.bold))
                        .foregroundStyle(Ink.paper)
                }
                .rotationEffect(.degrees(-7))
                .position(destination)
                .scaleEffect(destinationVisible ? 1 : 0.78)
                .opacity(destinationVisible ? 1 : 0)
                .shadow(color: Ink.accent.opacity(0.14), radius: 7, y: 4)
                .animation(.spring(response: 0.42, dampingFraction: 0.82), value: destinationVisible)

                Text("계획부터 여행까지")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Ink.soft)
                    .padding(.leading, 20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(.bottom, 16)
            }
        }
        .frame(height: 170)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: 20))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Ink.hairline))
        .shadow(color: Ink.ink.opacity(0.06), radius: 16, y: 7)
        .accessibilityHidden(true)
    }
}

private struct JourneyRoute: SwiftUI.Shape {
    var progress: CGFloat = 1

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    private static func points(width: CGFloat) -> (CGPoint, CGPoint, CGPoint, CGPoint) {
        (CGPoint(x: 28, y: 115), CGPoint(x: width * 0.27, y: 132),
         CGPoint(x: width * 0.59, y: 42), CGPoint(x: width - 48, y: 77))
    }

    private static func between(_ first: CGPoint, _ second: CGPoint, _ fraction: CGFloat) -> CGPoint {
        CGPoint(x: first.x + (second.x - first.x) * fraction,
                y: first.y + (second.y - first.y) * fraction)
    }

    static func point(at progress: CGFloat, width: CGFloat) -> CGPoint {
        let t = min(max(progress, 0), 1)
        let u = 1 - t
        let (start, first, second, end) = points(width: width)
        return CGPoint(
            x: u * u * u * start.x + 3 * u * u * t * first.x + 3 * u * t * t * second.x + t * t * t * end.x,
            y: u * u * u * start.y + 3 * u * u * t * first.y + 3 * u * t * t * second.y + t * t * t * end.y
        )
    }

    func path(in rect: CGRect) -> Path {
        let t = min(max(progress, 0), 1)
        let (start, first, second, end) = Self.points(width: rect.width)
        let firstEdge = Self.between(start, first, t)
        let middleEdge = Self.between(first, second, t)
        let lastEdge = Self.between(second, end, t)
        let firstControl = Self.between(firstEdge, middleEdge, t)
        let secondControl = Self.between(middleEdge, lastEdge, t)
        let tip = Self.between(firstControl, secondControl, t)
        return Path { path in
            path.move(to: start)
            path.addCurve(to: tip, control1: firstEdge, control2: firstControl)
        }
    }
}

private struct JourneyWaypoint: View, Animatable {
    var progress: CGFloat
    let fraction: CGFloat
    let width: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        let reveal = min(max((progress - fraction) * 12, 0), 1)
        Circle()
            .fill(Ink.paper)
            .frame(width: 9, height: 9)
            .overlay(Circle().strokeBorder(Ink.accent, lineWidth: 1.5))
            .position(JourneyRoute.point(at: fraction, width: width))
            .scaleEffect(reveal)
            .opacity(reveal)
    }
}

private struct JourneyTravelEffect: GeometryEffect {
    var progress: CGFloat
    let width: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let point = JourneyRoute.point(at: progress, width: width)
        return ProjectionTransform(CGAffineTransform(translationX: point.x - size.width / 2,
                                                     y: point.y - size.height / 2))
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
    func signInField() -> some View {
        padding(.horizontal, Space.l)
            .frame(height: 54)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Ink.hairline))
            .foregroundStyle(Ink.ink)
    }
}
