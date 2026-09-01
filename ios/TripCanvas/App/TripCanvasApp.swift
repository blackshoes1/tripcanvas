import SwiftUI

@main
struct TripCanvasApp: App {
    @State private var environment = AppEnvironment()

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
        } else {
            SignInView()
        }
    }
}

struct SignInView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: Space.l) {
            Spacer()
            VStack(spacing: Space.s) {
                Text("From J").font(.largeTitle.weight(.bold))
                Text("웹에서 만든 여행이 여기서 이어집니다.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            VStack(spacing: Space.m) {
                TextField("이메일", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("비밀번호", text: $password)
                    .textContentType(.password)
            }
            .textFieldStyle(.roundedBorder)

            if let error = env.auth.lastError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            PrimaryActionButton(title: "로그인", isBusy: env.auth.isWorking) {
                Task { await env.auth.signIn(email: email, password: password) }
            }
            .disabled(email.isEmpty || password.isEmpty)

            Text("웹 From J와 같은 계정을 사용합니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(Space.xl)
    }
}
