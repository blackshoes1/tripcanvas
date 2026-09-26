import SwiftUI
import XCTest
import UIKit
import ImageIO
@testable import TripCanvas

@MainActor
final class TripCoverTests: XCTestCase {
    func testOnlyCommonsRasterThumbnailsAreAccepted() {
        XCTAssertNotNil(TripCoverService.imageURL("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Kyoto.jpg/960px-Kyoto.jpg"))
        for url in ["http://upload.wikimedia.org/wikipedia/commons/test.jpg",
                    "https://upload.wikimedia.org.evil.test/wikipedia/commons/test.jpg",
                    "https://upload.wikimedia.org/wikipedia/en/test.jpg",
                    "https://upload.wikimedia.org/wikipedia/commons/test.svg",
                    "https://user@upload.wikimedia.org/wikipedia/commons/test.jpg"] {
            XCTAssertNil(TripCoverService.imageURL(url))
        }
    }

    func testAttributionRetainsAuthorAndRejectsRestrictedLicenses() {
        for license in ["CC BY-SA 4.0", "CC BY 3.0", "CC0", "Public domain"] {
            let value = TripCoverService.attribution(["LicenseShortName": ["value": license],
                                                       "Artist": ["value": "<a href='example'>A &amp; B</a>"]])
            XCTAssertEqual(value?.0, "A & B")
            XCTAssertEqual(value?.1, license)
        }
        for license in ["Fair use", "CC BY-NC 4.0", "CC BY-ND 4.0", ""] {
            XCTAssertNil(TripCoverService.attribution(["LicenseShortName": ["value": license], "Artist": ["value": "Author"]]))
        }
        XCTAssertNil(TripCoverService.attribution(["LicenseShortName": ["value": "CC BY-SA 4.0"]]))
    }

    func testSelectedPhotoIsResizedAndMetadataIsNotCopied() throws {
        let source = UIGraphicsImageRenderer(size: CGSize(width: 1800, height: 900)).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1800, height: 900))
        }
        let data = try XCTUnwrap(TripCoverImage.jpeg(from: XCTUnwrap(source.pngData())))
        XCTAssertLessThanOrEqual(data.count, 250_000)
        let image = try XCTUnwrap(UIImage(data: data))
        XCTAssertLessThanOrEqual(max(image.size.width, image.size.height), 1200)
        let decoded = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(decoded, 0, nil) as? [String: Any])
        XCTAssertNil(properties[kCGImagePropertyGPSDictionary as String])
        XCTAssertNil(TripCoverImage.jpeg(from: Data("not an image".utf8)))
    }

    func testEditorialFontIsBundledAndRegistered() {
        XCTAssertNotNil(Bundle.main.url(forResource: "NanumMyeongjo-Regular", withExtension: "ttf"))
        XCTAssertNotNil(UIFont(name: "NanumMyeongjo", size: 24))
    }

    func testCropAlwaysMatchesCoverAspectAndStaysInsidePhoto() {
        for size in [CGSize(width: 900, height: 1800), CGSize(width: 1800, height: 900)] {
            for zoom in [CGFloat(1), 2, 4] {
                for position in [CGPoint(x: -1, y: -1), CGPoint(x: 0.5, y: 0.5), CGPoint(x: 2, y: 2)] {
                    let crop = TripCoverImage.cropRect(size: size, zoom: zoom, position: position)
                    XCTAssertEqual(crop.width / crop.height, TripCoverImage.aspectRatio, accuracy: 0.0001)
                    XCTAssertGreaterThanOrEqual(crop.minX, 0)
                    XCTAssertGreaterThanOrEqual(crop.minY, 0)
                    XCTAssertLessThanOrEqual(crop.maxX, size.width + 0.0001)
                    XCTAssertLessThanOrEqual(crop.maxY, size.height + 0.0001)
                }
            }
        }
    }

    func testSavedCropUsesSelectedRegionAndFitsUploadLimit() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 2000, height: 1000), format: format).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1000, height: 1000))
            UIColor.blue.setFill()
            context.fill(CGRect(x: 1000, y: 0, width: 1000, height: 1000))
        }
        let left = try XCTUnwrap(TripCoverImage.jpeg(from: image, zoom: 2, position: CGPoint(x: 0, y: 0.5)))
        let right = try XCTUnwrap(TripCoverImage.jpeg(from: image, zoom: 2, position: CGPoint(x: 1, y: 0.5)))
        XCTAssertNotEqual(left, right, "위치 조정이 저장 이미지에도 반영되어야 한다")
        for data in [left, right] {
            XCTAssertLessThanOrEqual(data.count, 250_000)
            let saved = try XCTUnwrap(UIImage(data: data))
            XCTAssertEqual(saved.size.width / saved.size.height, TripCoverImage.aspectRatio, accuracy: 0.0001)
            let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
            let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any])
            XCTAssertNil(properties[kCGImagePropertyGPSDictionary as String])
        }
    }
}

private final class CoverResponseProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let title = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "titles" }?.value
        let body: Data
        if url.host == "ko.wikipedia.org" {
            var page: [String: Any] = ["pageimage": "City.jpg", "thumbnail": ["source": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/City.jpg/960px-City.jpg"]]
            if title != "NoLocation" { page["coordinates"] = [["lat": 35.0, "lon": 135.0]] }
            if title == "Ambiguous" { page["pageprops"] = ["disambiguation": ""] }
            body = try! JSONSerialization.data(withJSONObject: ["query": ["pages": [page]]])
        } else if url.host == "commons.wikimedia.org" {
            XCTAssertEqual(title, "File:City.jpg")
            body = Data(#"{"query":{"pages":[{"imageinfo":[{"descriptionurl":"https://commons.wikimedia.org/wiki/File:City.jpg","extmetadata":{"Artist":{"value":"Test photographer"},"LicenseShortName":{"value":"CC BY-SA 4.0"}}}]}]}}"#.utf8)
        } else {
            XCTAssertEqual(url.host, "thumb.wikimedia.org")
            body = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")!
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

extension TripCoverTests {
    func testPhotoPipelineAndAmbiguousDestinationFallback() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoverResponseProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let service = TripCoverService(session: session)
        let found = await service.representative(city: "교토")
        let photo = try XCTUnwrap(found)
        XCTAssertEqual(photo.author, "Test photographer")
        XCTAssertEqual(photo.license, "CC BY-SA 4.0")
        XCTAssertEqual(photo.image.size.width, 1)
        let ambiguous = await service.representative(city: "Ambiguous")
        let noLocation = await service.representative(city: "NoLocation")
        XCTAssertNil(ambiguous)
        XCTAssertNil(noLocation)
        XCTAssertEqual(TripCoverService.articleTitle("교토"), "교토시")
        XCTAssertEqual(TripCoverService.articleTitle("알 수 없는 도시"), "알 수 없는 도시")
    }
}

@MainActor
private final class CoverTokens: TokenProviding {
    func accessToken() async throws -> String { "cover-test-token" }
    func refreshToken() async throws -> String { "cover-test-token" }
}

private final class CoverAPIProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.url?.path, "/api/v1/trips/test/cover")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer cover-test-token")
        let data: Data
        var status = 200
        if request.httpMethod == "GET" {
            data = Data(#"{"revision":3,"imageBase64":null}"#.utf8)
        } else {
            // URLSession은 업로드 데이터를 스트림으로 바꿀 수 있다.
            var body = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    body.append(contentsOf: buffer.prefix(count))
                }
            }
            let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
            XCTAssertEqual(json?["expectedRevision"] as? Int, 3)
            XCTAssertTrue(json?["imageBase64"] is NSNull)
            status = 409
            data = Data(#"{"error":"STALE_VERSION","message":"표지가 바뀌었어요"}"#.utf8)
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Cache-Control": "no-store"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

extension TripCoverTests {
    func testCoverAPIUsesAuthenticationAndDoesNotTreatConflictAsSaved() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoverAPIProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let api = APIClient(baseURL: URL(string: "https://test.invalid")!, tokens: CoverTokens(), session: session)
        let cover: TripCoverResponse = try await api.get("api/v1/trips/test/cover")
        XCTAssertEqual(cover.revision, 3)
        XCTAssertNil(cover.image)
        do {
            let _: TripCoverResponse = try await api.put("api/v1/trips/test/cover", body: ["expectedRevision": cover.revision, "imageBase64": NSNull()])
            XCTFail("충돌을 저장 성공으로 처리하면 안 된다")
        } catch {
            XCTAssertEqual(error as? APIError, .revisionConflict(message: "표지가 바뀌었어요", revision: nil))
        }
    }

    // ── 표지 디스크 캐시 ─────────────────────────────────────────────────────
    // 원본은 서버다. 기기 사본은 **먼저 그리기**와 **못 받았을 때 버티기**를 위한 것이다.

    /// 서버가 답하면 그 값이 이긴다.
    func testServerAnswerWins() {
        let fresh = TripCoverResponse(revision: 7, imageBase64: "new")
        let stale = TripCoverResponse(revision: 3, imageBase64: "old")
        let outcome = TripCoverView.resolve(fetched: fresh, shown: stale)
        XCTAssertEqual(outcome.cover, fresh)
        XCTAssertFalse(outcome.failed)
    }

    /// ⚠️ 못 받았다고 **보여 주던 표지를 지우지 않는다** — NAS가 잠깐 꺼져도 목록이 비어 보이지 않게.
    /// 그래도 `failed`는 선다: 들고 있는 revision이 낡아 그대로 편집하면 충돌하므로
    /// 화면이 '표지 바꾸기' 대신 '다시 불러오기'를 보여야 한다.
    func testAFailedReadKeepsWhatIsAlreadyShown() {
        let cached = TripCoverResponse(revision: 3, imageBase64: "old")
        let outcome = TripCoverView.resolve(fetched: nil, shown: cached)
        XCTAssertEqual(outcome.cover, cached, "사진은 한 판 낡아도 틀린 말을 하지 않는다")
        XCTAssertTrue(outcome.failed, "편집은 막아야 한다 — revision이 낡았다")
    }

    /// 보여 줄 것이 아무것도 없으면 비어 있는 그대로 둔다(없는 표지를 지어내지 않는다).
    func testNothingToShowStaysEmpty() {
        let outcome = TripCoverView.resolve(fetched: nil, shown: nil)
        XCTAssertNil(outcome.cover)
        XCTAssertTrue(outcome.failed)
    }

    /// 표지를 지운 것도 서버의 답이다 — 캐시된 옛 사진으로 되돌아가지 않는다.
    func testRemovedCoverIsNotResurrectedFromCache() {
        let removed = TripCoverResponse(revision: 8, imageBase64: nil)
        let outcome = TripCoverView.resolve(fetched: removed, shown: TripCoverResponse(revision: 7, imageBase64: "old"))
        XCTAssertEqual(outcome.cover, removed)
        XCTAssertNil(outcome.cover?.imageBase64)
    }

    /// 캐시는 파일로 오간다 — 앱을 껐다 켜도 남는다.
    func testCoverSurvivesARoundTripThroughTheCache() async throws {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
        let cache = TripCache(directory: dir)
        defer { try? FileManager.default.removeItem(at: dir) }
        let key = TripCache.coverKey(tripId: "t1")
        await cache.save(TripCoverResponse(revision: 4, imageBase64: "abc"), key: key)
        let loaded = await cache.load(TripCoverResponse.self, key: key)
        XCTAssertEqual(loaded?.value, TripCoverResponse(revision: 4, imageBase64: "abc"))
        let other = await cache.load(TripCoverResponse.self, key: TripCache.coverKey(tripId: "다른-여행"))
        XCTAssertNil(other, "여행마다 따로 남는다")
    }
}


extension TripCoverTests {
    func testItineraryCoverOptionsKeepOrderDeduplicateAndExcludeUnsupportedPlaces() {
        let document = TripDocument(raw: ["days": .array([
            .object(["spots": .array([
                .object(["name": .string("미술관"), "placeId": .string("ChIJmuseum")]),
                .object(["name": .string("사진 없음")]),
                .object(["name": .string("카카오 장소"), "placeId": .string("123"), "kakaoId": .string("123")])
            ])]),
            .object(["spots": .array([
                .object(["name": .string("미술관 재방문"), "placeId": .string("ChIJmuseum")]),
                .object(["name": .string("공원"), "placeId": .string("ChIJpark")])
            ])])
        ])])
        let options = TripCoverPlaceOption.options(in: document)
        XCTAssertEqual(options.map(\.name), ["미술관", "공원"])
        XCTAssertEqual(options.map(\.day), [1, 2])
    }

    func testPlaceCoverStoresOnlyIdentifierAndCompositionAndReadsOldResponses() throws {
        let original = TripCoverResponse(revision: 3, imageBase64: nil,
                                        placePhoto: TripCoverPlace(placeId: "ChIJmuseum", zoom: 2, x: 0.2, y: 0.8))
        let data = try JSONEncoder().encode(original)
        XCTAssertEqual(try JSONDecoder().decode(TripCoverResponse.self, from: data), original)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let place = try XCTUnwrap(json["placePhoto"] as? [String: Any])
        XCTAssertEqual(Set(place.keys), ["placeId", "zoom", "x", "y"])
        let old = try JSONDecoder().decode(TripCoverResponse.self, from: Data(#"{"revision":1,"imageBase64":null}"#.utf8))
        XCTAssertNil(old.placePhoto)
    }
}


extension TripCoverTests {
    func testCoverEditorRendersSelectionAndCropScreens() async throws {
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 1000, height: 800)).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1000, height: 800))
            UIColor.systemYellow.setFill()
            context.fill(CGRect(x: 200, y: 150, width: 300, height: 500))
        }
        for (name, image) in [("selection", nil as UIImage?), ("crop", photo)] {
            let host = UIHostingController(rootView: TripCoverEditor(
                title: "새 여행", tripId: "preview",
                storageDescription: "이 여행을 함께 보는 일행과 다른 기기에도 같은 표지가 보여요.",
                initialImage: image, save: { _, _ in }).environment(AppEnvironment()))
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
            window.overrideUserInterfaceStyle = .light
            window.rootViewController = host
            window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            try await Task.sleep(for: .milliseconds(300))
            host.view.layoutIfNeeded()
            let rendered = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
                XCTAssertTrue(host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true))
            }
            let attachment = XCTAttachment(image: rendered)
            attachment.name = "cover-\(name)"
            attachment.lifetime = .keepAlways
            add(attachment)
            let pixels = try XCTUnwrap(rendered.cgImage?.dataProvider?.data) as Data
            XCTAssertGreaterThan(Set(pixels).count, 16, "빈 화면을 성공한 렌더링으로 처리하지 않는다")
            XCTAssertEqual(host.view.bounds.width, 393, accuracy: 1)
        }
    }
}
