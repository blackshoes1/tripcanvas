import SwiftUI
import UIKit
import XCTest
@testable import TripCanvas

@MainActor
final class CostOverviewTests: XCTestCase {
    struct Fixture: Decodable {
        let document: JSONValue
        let costs: TripCostsResponse
    }
    func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "cost-overview", withExtension: "json"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testUnknownFreePartialAndOriginalSourceFromActualAPI() throws {
        let fixture = try fixture()
        let items = try XCTUnwrap(fixture.costs.overview?.items)
        XCTAssertEqual(CostOverviewRow.amountLabel(try XCTUnwrap(items.first { $0.line.state == "UNKNOWN" }?.line)), "금액 미정")
        XCTAssertEqual(CostOverviewRow.amountLabel(try XCTUnwrap(items.first { $0.line.state == "FREE" }?.line)), "무료")
        XCTAssertTrue(items.contains { $0.line.state == "PARTIAL" })
        XCTAssertEqual(items.reduce(0) { $0 + ($1.line.totalKRW ?? 0) }, fixture.costs.totalKRW)
        XCTAssertEqual(TripCostsView.OverviewFilter.all.includes(items[0]), true)
        XCTAssertTrue(items.filter { TripCostsView.OverviewFilter.reservations.includes($0) }.contains { $0.line.key == "flight" })
    }

    func testSummaryAndRowsFitNarrowWidthAndGrowForAccessibility() throws {
        let fixture = try fixture()
        let item = try XCTUnwrap(fixture.costs.overview?.items.first)
        for width: CGFloat in [288, 343, 398] {
            let summary = UIHostingController(rootView: CostOverviewSummary(response: fixture.costs))
            let size = summary.sizeThatFits(in: CGSize(width: width, height: 1600))
            XCTAssertLessThanOrEqual(size.width, width + 1)
            let normal = UIHostingController(rootView: CostOverviewRow(item: item).environment(\.dynamicTypeSize, .large))
                .sizeThatFits(in: CGSize(width: width, height: 1600))
            let accessible = UIHostingController(rootView: CostOverviewRow(item: item).environment(\.dynamicTypeSize, .accessibility3))
                .sizeThatFits(in: CGSize(width: width, height: 1600))
            XCTAssertLessThanOrEqual(accessible.width, width + 1)
            XCTAssertGreaterThan(accessible.height, normal.height)
        }
    }

    func testOldAPIAndNewOverviewScreensRenderWithSyntheticData() async throws {
        let fixture = try fixture()
        let document = TripDocument(raw: try XCTUnwrap(fixture.document.objectValue))
        let summary = TripSummary(id: "t1", name: "스페인 여행", start: "2026-10-01", dayCount: 2,
            revision: 1, updatedAt: "2026-10-01T00:00:00Z", timeZone: "Europe/Madrid", cities: [],
            todayIndex: 0, daysUntilStart: nil, role: .owner, memberCount: 1)
        for (name, old, style, typeSize) in [
            ("before", true, UIUserInterfaceStyle.light, DynamicTypeSize.large),
            ("after", false, .light, .large),
            ("dark", false, .dark, .large),
            ("large-text", false, .light, .accessibility3)
        ] {
            var costs = fixture.costs
            if old { costs.overview = nil }
            let memory = TripCostsMemory()
            memory.remember(snapshot: TripDocumentSnapshot(document: document, revision: 1, role: .owner), response: costs)
            let host = UIHostingController(rootView: NavigationStack {
                TripCostsView(trip: summary, memory: memory)
            }.environment(AppEnvironment()).environment(\.dynamicTypeSize, typeSize))
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
            window.overrideUserInterfaceStyle = style
            window.rootViewController = host; window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            try await Task.sleep(for: .milliseconds(400))
            host.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
                XCTAssertTrue(host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true))
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "cost-overview-\(name)"; attachment.lifetime = .keepAlways; add(attachment)
            let pixels = try XCTUnwrap(image.cgImage?.dataProvider?.data) as Data
            XCTAssertGreaterThan(Set(pixels).count, 16)
        }
    }
}
