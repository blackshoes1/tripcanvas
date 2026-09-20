import UIKit

/// 도시명만 공개 백과에 전달한다. 여행 이름·일정·사용자 정보는 보내지 않는다.
/// 동음이의어나 이미지 출처가 불명확하면 추측하는 대신 표지 자리만 남긴다.
@MainActor
final class TripCoverService {
    struct Cover {
        let image: UIImage
        let author: String
        let license: String
        let source: URL
    }
    static let shared = TripCoverService()
    private let session: URLSession
    private var cached: [String: Cover] = [:]
    private var attempted: Set<String> = []

    init(session: URLSession = .shared) { self.session = session }

    func representative(city: String) async -> Cover? {
        let input = city.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = Self.articleTitle(input)
        guard !title.isEmpty, title != "기타" else { return nil }
        if let result = cached[title] { return result }
        guard !attempted.contains(title) else { return nil }
        do {
            let page = try await query(host: "ko.wikipedia.org", items: [
                "prop": "pageimages|coordinates|pageprops", "titles": title, "redirects": "1",
                "piprop": "name|thumbnail", "pithumbsize": "960", "pilicense": "free"
            ])
            guard let entry = Self.pages(page).first,
                  entry["coordinates"] is [[String: Any]],
                  (entry["pageprops"] as? [String: Any])?["disambiguation"] == nil,
                  let file = entry["pageimage"] as? String,
                  let thumbnail = entry["thumbnail"] as? [String: Any],
                  let imageURL = Self.imageURL(thumbnail["source"] as? String) else {
                attempted.insert(title); return nil
            }
            let info = try await query(host: "commons.wikimedia.org", items: [
                "prop": "imageinfo", "titles": "File:" + file, "iiprop": "extmetadata|url"
            ])
            guard let imageInfo = (Self.pages(info).first?["imageinfo"] as? [[String: Any]])?.first,
                  let metadata = imageInfo["extmetadata"] as? [String: Any],
                  let attribution = Self.attribution(metadata),
                  let sourceText = imageInfo["descriptionurl"] as? String,
                  let source = URL(string: sourceText), source.scheme == "https",
                  source.host == "commons.wikimedia.org" else { attempted.insert(title); return nil }
            var request = URLRequest(url: imageURL, timeoutInterval: 15)
            request.setValue("WithJ/1.0 (tripcanvas-ai.vercel.app)", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  data.count < 8_000_000, let image = UIImage(data: data) else { return nil }
            let result = Cover(image: image, author: attribution.0, license: attribution.1, source: source)
            if cached.count >= 24 { cached.removeAll(); attempted.removeAll() }
            cached[title] = result
            return result
        } catch { return nil } // 오프라인·취소는 다음 진입에서 다시 시도할 수 있다.
    }

    static func articleTitle(_ city: String) -> String {
        // 한국어 백과의 행정구역 표제. 검색 첫 결과를 임의로 고르지 않는다.
        let aliases = ["교토": "교토시", "오사카": "오사카시", "도쿄": "도쿄도", "후쿠오카": "후쿠오카시",
                       "삿포로": "삿포로시", "나고야": "나고야시", "제주": "제주도", "서울": "서울특별시", "부산": "부산광역시"]
        return aliases[city] ?? city
    }

    static func imageURL(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value), url.scheme == "https",
              ["upload.wikimedia.org", "thumb.wikimedia.org"].contains(url.host ?? ""), url.user == nil, url.password == nil,
              url.path.hasPrefix("/wikipedia/commons/"),
              ["jpg", "jpeg", "png", "webp"].contains(url.pathExtension.lowercased()) else { return nil }
        return url
    }

    static func attribution(_ metadata: [String: Any]) -> (String, String)? {
        guard let license = (metadata["LicenseShortName"] as? [String: Any])?["value"] as? String,
              let artist = (metadata["Artist"] as? [String: Any])?["value"] as? String else { return nil }
        let key = license.lowercased()
        guard (key.hasPrefix("cc by") && !key.contains("nc") && !key.contains("nd")) || key == "cc0" || key == "public domain" else { return nil }
        let author = artist.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&quot;", with: "\"")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !author.isEmpty else { return nil }
        return (author, license)
    }

    private func query(host: String, items: [String: String]) async throws -> [String: Any] {
        var url = URLComponents()
        url.scheme = "https"; url.host = host; url.path = "/w/api.php"
        url.queryItems = (["action": "query", "format": "json", "formatversion": "2"].merging(items) { _, new in new })
            .map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let endpoint = url.url else { throw URLError(.badURL) }
        var request = URLRequest(url: endpoint, timeoutInterval: 15)
        request.setValue("WithJ/1.0 (tripcanvas-ai.vercel.app)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private static func pages(_ response: [String: Any]) -> [[String: Any]] {
        (response["query"] as? [String: Any])?["pages"] as? [[String: Any]] ?? []
    }
}
