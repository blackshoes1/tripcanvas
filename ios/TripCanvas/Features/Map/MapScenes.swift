import Foundation

/// 하루를 **장면**으로 나눈다 — 서로 가까운 장소들의 묶음(2026-09-19).
///
/// 마드리드 → 세비야처럼 도시를 건너는 날은 하루 전체를 한 화면에 담으면 사각형이 나라 절반이 돼
/// 도시 안 동선이 점 하나로 뭉친다. 그날 시간을 쓰는 곳은 도착 도시인데 지도가 그걸 못 보여 준다.
/// 그래서 연속한 두 장소 사이가 `splitKm`(25km) 이상 벌어지면 거기서 장면을 끊고, 기본 카메라는
/// **주 장면**(장소가 가장 많은 묶음, 같으면 뒤쪽 = 그날 잠드는 곳)에 맞춘다. 전체는 칩 한 번으로 본다 —
/// J가 대신 정하지 않는다. 도시 안 하루는 장면이 하나라 예전과 똑같다.
///
/// 이 파일은 SDK를 모른다 — XCTest가 그대로 검사한다.
struct SceneSpot: Equatable {
    /// 문서의 장소 인덱스(`days[di].spots`). 좌표 없는 장소는 여기 오지 않는다.
    let index: Int
    let point: GeoPoint
    /// 장소에 적힌 도시. 비어 있을 수 있다 — 그때 이름표는 번호로 간다.
    let city: String
}

struct MapScene: Identifiable, Equatable {
    /// 하루 안의 순서(0부터).
    let id: Int
    let spotIndexes: [Int]
    /// 도시 이름(다수결) 또는 `2–4번`.
    let label: String
    let points: [GeoPoint]
    var count: Int { spotIndexes.count }
}

/// 장면 사이의 이동 — `id`는 출발 장면의 id다.
struct MapTransfer: Identifiable, Equatable {
    let id: Int
    let mode: TravelMode?
    /// 서버가 구간을 계산해 뒀을 때만. 없으면 nil — 지어내지 않는다.
    let minutes: Int?
    let distanceKm: Double
    /// 직선 거리인가(서버 구간이 없을 때). 화면이 "약"이라고 말한다.
    let estimated: Bool
}

enum MapScenes {
    /// 이 거리 이상 떨어지면 다른 장면이다. 도시 안 이동은 이보다 짧고, 도시 사이는 이보다 길다.
    static let splitKm = 25.0

    /// 순서대로 훑으며 `splitKm` 이상 벌어지는 곳에서 끊는다. 빈 입력은 빈 배열.
    static func split(_ spots: [SceneSpot], splitKm: Double = MapScenes.splitKm) -> [MapScene] {
        var groups: [[SceneSpot]] = []
        for spot in spots {
            if let last = groups.last?.last, distanceKm(last.point, spot.point) < splitKm {
                groups[groups.count - 1].append(spot)
            } else {
                groups.append([spot])
            }
        }
        return groups.enumerated().map { offset, group in
            MapScene(id: offset, spotIndexes: group.map(\.index), label: label(for: group), points: group.map(\.point))
        }
    }

    /// 주 장면 — 장소가 가장 많은 묶음. 같으면 **뒤쪽**(그날 잠드는 곳). 장면이 없으면 nil.
    static func mainScene(in scenes: [MapScene]) -> Int? {
        var best: Int?
        for scene in scenes where best == nil || scene.count >= scenes[best!].count { best = scene.id }
        return best
    }

    /// 장면 사이 이동. `leg`는 도착 장면 첫 장소의 서버 구간(있으면) — 없으면 두 점의 직선 거리다.
    static func transfers(between scenes: [MapScene],
                          leg: (_ arrivingSpotIndex: Int) -> (mode: TravelMode?, minutes: Int?, distanceKm: Double?)?) -> [MapTransfer] {
        guard scenes.count >= 2 else { return [] }
        return zip(scenes, scenes.dropFirst()).compactMap { from, to in
            guard let a = from.points.last, let b = to.points.first, let arriving = to.spotIndexes.first else { return nil }
            let known = leg(arriving)
            if let known, let km = known.distanceKm, km > 0 {
                return MapTransfer(id: from.id, mode: known.mode, minutes: known.minutes, distanceKm: km, estimated: false)
            }
            return MapTransfer(id: from.id, mode: known?.mode, minutes: nil, distanceKm: distanceKm(a, b), estimated: true)
        }
    }

    /// 이름표 — 비어 있지 않은 도시 중 가장 많은 것(같으면 먼저 나온 것). 도시가 하나도 없으면 번호 범위.
    static func label(for spots: [SceneSpot]) -> String {
        var counts: [String: Int] = [:]
        var order: [String] = []
        for city in spots.map(\.city).map({ $0.trimmingCharacters(in: .whitespaces) }) where !city.isEmpty {
            if counts[city] == nil { order.append(city) }
            counts[city, default: 0] += 1
        }
        if let city = order.max(by: { counts[$0]! < counts[$1]! || (counts[$0]! == counts[$1]! && order.firstIndex(of: $0)! > order.firstIndex(of: $1)!) }) {
            return city
        }
        guard let first = spots.first?.index, let last = spots.last?.index else { return "" }
        return first == last ? "\(first + 1)번" : "\(first + 1)–\(last + 1)번"
    }

    /// 대원 거리(km) — 하버사인. 지구 반지름 6371km.
    static func distanceKm(_ a: GeoPoint, _ b: GeoPoint) -> Double {
        let radius = 6371.0088
        let lat1 = a.lat * .pi / 180, lat2 = b.lat * .pi / 180
        let dLat = (b.lat - a.lat) * .pi / 180, dLng = (b.lng - a.lng) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * radius * asin(min(1, sqrt(h)))
    }

    /// 화면 문구 — `기차 2시간 30분 · 390km` / `약 390km`.
    static func text(for transfer: MapTransfer) -> String {
        let km = transfer.distanceKm >= 10 ? String(format: "%.0fkm", transfer.distanceKm) : String(format: "%.1fkm", transfer.distanceKm)
        if let minutes = transfer.minutes, !transfer.estimated { return "\(TimeFormat.duration(minutes)) · \(km)" }
        return "약 \(km)"
    }
}

extension TripDay {
    /// 장면 나누기 입력 — 좌표 있는 장소만, 문서 인덱스를 그대로 들고.
    var sceneSpots: [SceneSpot] {
        spots.enumerated().compactMap { index, spot in
            guard let point = spot.point else { return nil }
            return SceneSpot(index: index, point: point, city: spot.city)
        }
    }
}
