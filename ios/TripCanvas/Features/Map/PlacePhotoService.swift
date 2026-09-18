import Foundation
import UIKit

struct PlacePhoto {
    struct Author: Decodable {
        let displayName: String?
        let uri: String?
    }
    let image: UIImage
    let sourceURL: URL
    let authors: [Author]

    static func safeURL(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value), url.scheme == "https",
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

/// 사진과 만료되는 사진 참조는 여행 문서·디스크 캐시에 저장하지 않는다.
/// **메모리에만** 최근 것을 든다(2026-09-18) — 같은 장소를 다시 열 때 Google에 세 번 더 묻지 않는다. 앱을 끄면 사라진다.
@MainActor
final class PlacePhotoService {
    private let key: String
    private let bundleId: String
    private let session: URLSession
    private struct Remembered { let photo: PlacePhoto? }
    private var recent: [String: Remembered] = [:]
    private var recentOrder: [String] = []
    private static let recentLimit = 40

    init(key: String, bundleId: String, session: URLSession? = nil) {
        self.key = key
        self.bundleId = bundleId
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = session ?? URLSession(configuration: config)
    }

    private struct Details: Decodable {
        struct Photo: Decodable {
            let name: String
            let googleMapsUri: String?
            let authorAttributions: [PlacePhoto.Author]?
        }
        let photos: [Photo]?
    }
    private struct Media: Decodable { let photoUri: String }

    func photo(placeId: String) async throws -> PlacePhoto? {
        guard GooglePlaces.validPlaceId(placeId), !key.isEmpty else { throw URLError(.badURL) }
        if let hit = remembered(placeId) { return hit.photo }
        let root = "https://places.googleapis.com/v1/places/\(placeId)"
        let detailsData = try await data(url: URL(string: root)!, authenticated: true, fieldMask: "photos")
        let details = try JSONDecoder().decode(Details.self, from: detailsData)
        // 원본 사진 링크가 있는 한 장만 표시한다. 다른 장소를 이름으로 추측 검색하지 않는다.
        guard let photo = details.photos?.first(where: { PlacePhoto.safeURL($0.googleMapsUri) != nil }),
              let sourceURL = PlacePhoto.safeURL(photo.googleMapsUri) else { remember(placeId, nil); return nil }
        let prefix = "places/\(placeId)/photos/"
        guard photo.name.hasPrefix(prefix), !photo.name.dropFirst(prefix.count).isEmpty,
              photo.name.dropFirst(prefix.count).allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") })
        else { throw URLError(.badServerResponse) }
        let mediaURL = URL(string: "https://places.googleapis.com/v1/\(photo.name)/media?maxWidthPx=720&maxHeightPx=480&skipHttpRedirect=true")!
        let mediaData = try await data(url: mediaURL, authenticated: true)
        let media = try JSONDecoder().decode(Media.self, from: mediaData)
        guard let imageURL = PlacePhoto.safeURL(media.photoUri) else { throw URLError(.badServerResponse) }
        // 별도 이미지 요청에는 API 키·번들 헤더를 전달하지 않는다.
        let imageData = try await data(url: imageURL, authenticated: false)
        guard let image = UIImage(data: imageData) else { throw URLError(.cannotDecodeContentData) }
        let result = PlacePhoto(image: image, sourceURL: sourceURL, authors: photo.authorAttributions ?? [])
        remember(placeId, result)
        return result
    }

    /// 실패(throw)는 기억하지 않는다 — 다시 시도할 수 있어야 한다. '사진 없음'은 기억한다(그것도 답이다).
    private func remembered(_ placeId: String) -> Remembered? {
        guard let hit = recent[placeId] else { return nil }
        recentOrder.removeAll { $0 == placeId }
        recentOrder.append(placeId)
        return hit
    }

    private func remember(_ placeId: String, _ photo: PlacePhoto?) {
        recent[placeId] = Remembered(photo: photo)
        recentOrder.removeAll { $0 == placeId }
        recentOrder.append(placeId)
        while recentOrder.count > Self.recentLimit, let oldest = recentOrder.first {
            recentOrder.removeFirst()
            recent[oldest] = nil
        }
    }

    private func data(url: URL, authenticated: Bool, fieldMask: String? = nil) async throws -> Data {
        try Task.checkCancellation()
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpShouldHandleCookies = false
        if authenticated {
            request.setValue(key, forHTTPHeaderField: "X-Goog-Api-Key")
            request.setValue(bundleId, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
        }
        if let fieldMask { request.setValue(fieldMask, forHTTPHeaderField: "X-Goog-FieldMask") }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}
