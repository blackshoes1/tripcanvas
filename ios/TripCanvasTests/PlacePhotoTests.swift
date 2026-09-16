import XCTest
import UIKit
@testable import TripCanvas

private final class PhotoResponseProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
        var status = 200
        var body = Data()
        if url.host == "places.googleapis.com" {
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Goog-Api-Key"), "photo-test-key")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier"), "com.fromj.trip")
            if url.path.hasSuffix("/media") {
                XCTAssertEqual(url.path, "/v1/places/TestSuccess/photos/first/media", "한 장만 요청한다")
                let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
                XCTAssertEqual(query?.first(where: { $0.name == "skipHttpRedirect" })?.value, "true")
                body = Data(#"{"photoUri":"https://lh3.googleusercontent.com/test-photo"}"#.utf8)
            } else {
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-Goog-FieldMask"), "photos")
                let id = url.lastPathComponent
                if id == "TestEmpty" { body = Data("{}".utf8) }
                else if id == "TestFailure" { status = 403; body = Data("{}".utf8) }
                else {
                    let resource = id == "TestWrong" ? "places/OtherPlace/photos/first" : "places/\(id)/photos/first"
                    let source = id == "TestUnsafe" ? "javascript:alert(1)" : "https://maps.google.com/photo-source"
                    body = try! JSONSerialization.data(withJSONObject: ["photos": [
                        ["name": resource, "googleMapsUri": source,
                         "authorAttributions": [["displayName": "합성 작성자", "uri": "https://maps.google.com/author"]]],
                        ["name": "places/\(id)/photos/should-not-load", "googleMapsUri": source]
                    ]])
                }
            }
        } else {
            XCTAssertEqual(url.absoluteString, "https://lh3.googleusercontent.com/test-photo")
            XCTAssertNil(request.value(forHTTPHeaderField: "X-Goog-Api-Key"))
            XCTAssertNil(request.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier"))
            body = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")!
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class PlacePhotoTests: XCTestCase {
    private func withService(_ check: (PlacePhotoService) async throws -> Void) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PhotoResponseProtocol.self]
        config.urlCache = nil
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        try await check(PlacePhotoService(key: "photo-test-key", bundleId: "com.fromj.trip", session: session))
    }

    func testPhotoKeepsAuthorAndSourceWithoutSendingCredentialsToImageHost() async throws {
        try await withService { service in
            let result = try await service.photo(placeId: "TestSuccess")
            let photo = try XCTUnwrap(result)
            XCTAssertEqual(photo.image.size.width, 1)
            XCTAssertEqual(photo.sourceURL.absoluteString, "https://maps.google.com/photo-source")
            XCTAssertEqual(photo.authors.first?.displayName, "합성 작성자")
            XCTAssertEqual(photo.authors.first?.uri, "https://maps.google.com/author")
        }
    }

    func testMissingPhotosAndUnsafeSourceAreEmptyRatherThanGuessed() async throws {
        try await withService { service in
            let missing = try await service.photo(placeId: "TestEmpty")
            let unsafe = try await service.photo(placeId: "TestUnsafe")
            XCTAssertNil(missing)
            XCTAssertNil(unsafe)
        }
    }

    func testOtherPlacesPhotoAndAuthenticationFailureAreErrors() async throws {
        try await withService { service in
            for id in ["TestWrong", "TestFailure", "../wrong"] {
                do { _ = try await service.photo(placeId: id); XCTFail("사진 조회가 거절되어야 한다") }
                catch { XCTAssertTrue(error is URLError) }
            }
        }
    }

    func testCancelledSelectionCannotCompletePhotoLoading() async throws {
        try await withService { service in
            let task = Task { try await service.photo(placeId: "TestSuccess") }
            task.cancel()
            do { _ = try await task.value; XCTFail("취소된 장소의 사진을 표시하면 안 된다") }
            catch { XCTAssertTrue(error is CancellationError || (error as? URLError)?.code == .cancelled) }
        }
    }

    func testKakaoOrUnlinkedPlacesDoNotRequestGooglePhotos() {
        XCTAssertNil(PlacePhotoView(placeId: "TestSuccess", kakaoId: "123", name: "국내").googleId)
        XCTAssertNil(PlacePhotoView(placeId: nil, kakaoId: nil, name: "수동").googleId)
        XCTAssertNil(PlacePhotoView(placeId: "TestSuccess", kakaoId: nil, name: "지도", allowsGooglePhoto: false).googleId)
        XCTAssertEqual(PlacePhotoView(placeId: "TestSuccess", kakaoId: nil, name: "해외").googleId, "TestSuccess")
    }
}
