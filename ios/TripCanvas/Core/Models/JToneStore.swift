import Foundation
import Observation

struct JTonePreferences: Codable, Sendable {
    let jTone: JTone
}

/// 개인 설정은 계정별로 보관한다. 이전 계정의 응답은 읽기·쓰기 모두 버린다.
@Observable
@MainActor
final class JToneStore {
    private(set) var selected: JTone = .friendly
    private(set) var isSaving = false
    private(set) var pending = false
    private(set) var message: String?
    private(set) var refreshVersion = 0
    var onSaved: (() -> Void)?
    private var accountID: String?
    private var revision = 0
    private let defaults: UserDefaults
    private let fetch: () async throws -> JTonePreferences
    private let persist: (JTone) async throws -> JTonePreferences

    init(accountID: String?, defaults: UserDefaults = .standard,
         fetch: @escaping () async throws -> JTonePreferences,
         persist: @escaping (JTone) async throws -> JTonePreferences) {
        self.defaults = defaults
        self.fetch = fetch
        self.persist = persist
        useAccount(accountID)
    }

    func useAccount(_ id: String?) {
        accountID = id
        revision += 1
        selected = JTone(rawValue: defaults.string(forKey: key) ?? "") ?? .friendly
        pending = defaults.bool(forKey: key + ".pending")
        isSaving = false
        message = nil
        refreshVersion += 1
    }

    private var key: String { "tripcanvas_j_tone_v1." + (accountID ?? "guest") }
    private func cache() {
        defaults.set(selected.rawValue, forKey: key)
        defaults.set(pending, forKey: key + ".pending")
    }

    func load() async {
        guard accountID != nil, !pending, !isSaving else { return }
        let version = revision
        do {
            let result = try await fetch()
            guard version == revision, !pending, !isSaving else { return }
            if selected != result.jTone { refreshVersion += 1 }
            selected = result.jTone
            message = nil
            cache()
        } catch {
            guard version == revision else { return }
            message = "계정 설정을 불러오지 못했어요 — 이 기기에 저장된 말투를 사용해요."
        }
    }

    func select(_ tone: JTone) async {
        guard !isSaving else { return }
        revision += 1
        let version = revision
        selected = tone
        pending = accountID != nil
        message = nil
        cache()
        guard accountID != nil else { return }
        isSaving = true
        do {
            let result = try await persist(tone)
            guard version == revision else { return }
            selected = result.jTone
            pending = false
            isSaving = false
            message = "계정에 저장했어요."
            cache()
            refreshVersion += 1
            onSaved?()
        } catch {
            guard version == revision else { return }
            isSaving = false
            message = "계정에 저장하지 못했어요 — 이 기기에 남겨 뒀어요. 연결되면 다시 저장해 주세요."
        }
    }
}


/// 401 재시도 중 계정이 바뀌어도 새 계정으로 이전 설정을 보내지 않는다.
@MainActor
struct JToneTokenProvider: TokenProviding {
    let store: AuthStore
    let accountID: String?
    private func checkAccount() throws {
        guard let accountID, store.session?.userId == accountID else { throw APIError.unauthorized }
    }
    func accessToken() async throws -> String {
        try checkAccount()
        let token = try await store.validAccessToken()
        try checkAccount()
        return token
    }
    func refreshToken() async throws -> String {
        try checkAccount()
        let token = try await store.forceRefresh().token
        try checkAccount()
        return token
    }
}
