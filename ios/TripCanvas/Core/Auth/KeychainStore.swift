import Foundation
import Security

/// 세션은 UserDefaults가 아니라 Keychain에 둔다(§25). 다른 앱·백업 경로로 새지 않게.
struct KeychainStore {
    let service: String
    let account: String

    init(service: String = "ai.tripcanvas.ios", account: String) {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    func write<T: Encodable>(_ value: T) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        SecItemDelete(baseQuery as CFDictionary)
        var query = baseQuery
        query[kSecValueData as String] = data
        // 기기가 잠겨 있는 동안에는 읽히지 않게. 다른 기기로 백업되지도 않는다.
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    func read<T: Decodable>(_ type: T.Type) -> T? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
