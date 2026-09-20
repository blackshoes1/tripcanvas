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
}
