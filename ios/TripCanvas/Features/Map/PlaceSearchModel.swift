import Foundation

/// 지도·검색의 순수 규칙. 네트워크·SDK를 모르고 전부 인자로 받는다 — 테스트 대상.
///
/// ⚠️ 여기 있는 판정(`inKorea`·`isKoreanSearch`·구글 도시/카테고리)은 `lib.js`의 **복사본**이다.
/// 웹과 갈라지면 같은 장소를 두 플랫폼이 다른 도시·다른 카테고리로 담는다. 바꿀 일이 생기면
/// `lib.js`를 먼저 고치고 여기를 따라 맞춘다(`inKorea` · `isKoreanSearch` · `cityFromGoogle` · `catFromGoogle`).
enum MapRegion {
    /// `lib.js` `inKorea` — 국내면 카카오, 아니면 구글.
    static func isKorea(_ point: GeoPoint?) -> Bool {
        guard let point else { return false }
        return point.lat >= 33 && point.lat <= 39 && point.lng >= 124.5 && point.lng <= 132
    }

    /// `lib.js` `isKoreanSearch` — 앵커 좌표가 있으면 그 위치로, 없으면 한글이 있는지로 가른다.
    static func isKoreanSearch(_ query: String, near: GeoPoint?) -> Bool {
        if let near { return isKorea(near) }
        return query.unicodeScalars.contains { (0xAC00...0xD7A3).contains($0.value) }
    }
}

/// 검색 결과 한 건. 어느 SDK에서 왔든 같은 모양이라 화면은 출처를 모른다.
struct PlaceHit: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let city: String
    let address: String
    let point: GeoPoint
    let category: SpotCategory?
    /// 구글 Place ID(호텔 identity·시세 조회). 카카오 결과에는 없다.
    let placeId: String?

    /// 검색 결과 → 장소. 웹의 `kakaoSearch`/구글 담기가 만드는 필드와 같다.
    func makeSpot() -> TripSpot {
        var spot = TripSpot(name: name, city: city.isEmpty ? "기타" : city)
        spot.point = point
        spot.category = category
        if let placeId { spot.placeId = placeId }
        return spot
    }
}

// MARK: - 서버(카카오 프록시) 응답

/// `GET /api/v1/places/search` 응답. 정규화는 서버의 `lib.js`가 이미 했다.
struct PlaceSearchResponse: Codable, Sendable {
    struct Place: Codable, Sendable {
        let name: String
        let address: String
        let city: String
        let lat: Double
        let lng: Double
        let category: String?
    }
    let provider: String
    let places: [Place]

    var hits: [PlaceHit] {
        places.enumerated().map { index, place in
            PlaceHit(
                id: "kakao-\(index)-\(place.lat)-\(place.lng)",
                name: place.name, city: place.city, address: place.address,
                point: GeoPoint(lat: place.lat, lng: place.lng),
                category: place.category.flatMap(SpotCategory.init(rawValue:)),
                placeId: nil)
        }
    }
}

// MARK: - 구글 Places API (New) — 앱이 번들 ID로 제한된 키로 직접 묻는다

enum GooglePlaces {
    static let endpoint = URL(string: "https://places.googleapis.com/v1/places:searchText")!
    static let fieldMask = "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.addressComponents"
    /// 앵커가 있을 때 우선 볼 반경. 웹의 카카오 반경과 같다
    static let biasRadiusMeters = 20_000.0

    /// 요청 본문. 순수 함수라 테스트에서 그대로 검사한다.
    static func requestBody(query: String, near: GeoPoint?, limit: Int, languageCode: String) -> [String: Any] {
        var body: [String: Any] = [
            "textQuery": query,
            "maxResultCount": min(20, max(1, limit)),
            "languageCode": languageCode
        ]
        if let near {
            body["locationBias"] = [
                "circle": [
                    "center": ["latitude": near.lat, "longitude": near.lng],
                    "radius": biasRadiusMeters
                ]
            ]
        }
        return body
    }

    struct Response: Codable, Sendable {
        struct LocalizedText: Codable, Sendable { let text: String? }
        struct LatLng: Codable, Sendable { let latitude: Double?; let longitude: Double? }
        struct AddressComponent: Codable, Sendable {
            let longText: String?
            let shortText: String?
            let types: [String]?
        }
        struct Place: Codable, Sendable {
            let id: String?
            let displayName: LocalizedText?
            let formattedAddress: String?
            let location: LatLng?
            let types: [String]?
            let primaryType: String?
            let addressComponents: [AddressComponent]?
        }
        let places: [Place]?
    }

    /// 응답 → 검색 결과. 좌표나 이름이 없는 것은 버린다(담아도 동선에 못 쓴다).
    static func hits(from response: Response) -> [PlaceHit] {
        (response.places ?? []).compactMap { place in
            guard let lat = place.location?.latitude, let lng = place.location?.longitude,
                  lat >= -90, lat <= 90, lng >= -180, lng <= 180 else { return nil }
            let name = placeName(displayName: place.displayName?.text, formattedAddress: place.formattedAddress)
            guard !name.isEmpty else { return nil }
            let placeId = place.id.flatMap { validPlaceId($0) ? $0 : nil }
            return PlaceHit(
                id: placeId ?? "google-\(lat)-\(lng)-\(name)",
                name: name,
                city: cityFromGoogle(place.addressComponents ?? []),
                address: place.formattedAddress ?? "",
                point: GeoPoint(lat: lat, lng: lng),
                category: catFromGoogle(types: place.types ?? [], primary: place.primaryType),
                placeId: placeId)
        }
    }

    /// `lib.js` `placeName` — displayName이 비면 주소 앞부분으로 폴백한다.
    static func placeName(displayName: String?, formattedAddress: String?) -> String {
        let name = (displayName ?? "").trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { return name }
        return (formattedAddress ?? "").split(separator: ",").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
    }

    /// `lib.js` `cityFromGoogle` — locality 우선, 도쿄 특별구는 '도쿄'로 묶고, 한국 지명 접미사를 정리한다.
    static func cityFromGoogle(_ components: [Response.AddressComponent]) -> String {
        func pick(_ type: String) -> String {
            let hit = components.first { ($0.types ?? []).contains(type) }
            return hit?.longText ?? hit?.shortText ?? ""
        }
        let locality = pick("locality")
        let area1 = pick("administrative_area_level_1")
        let area2 = pick("administrative_area_level_2")
        let isTokyo: (String) -> Bool = { $0.lowercased().hasPrefix("tokyo") || $0.hasPrefix("도쿄") }
        if isTokyo(area1), !locality.isEmpty, !isTokyo(locality) { return area1 }
        var city = locality.isEmpty ? (area2.isEmpty ? area1 : area2) : locality
        for suffix in ["특별시", "광역시", "특별자치시"] where city.hasSuffix(suffix) { city.removeLast(suffix.count) }
        for suffix in ["시", "군"] where city.hasSuffix(suffix) { city.removeLast(suffix.count) }
        return city
    }

    /// `lib.js` `_GOOGLE_CAT` — 배열 순서가 우선순위다. primaryType이 있으면 그것이 대표 성격.
    private static let categoryTable: [(SpotCategory, [String])] = [
        (.stay, ["lodging", "hotel", "motel", "hostel", "resort_hotel", "guest_house", "bed_and_breakfast", "extended_stay_hotel", "inn"]),
        (.cafe, ["cafe", "coffee_shop", "bakery", "tea_house", "dessert_shop", "ice_cream_shop"]),
        (.food, ["restaurant", "bar", "pub", "wine_bar", "meal_takeaway", "meal_delivery", "fast_food_restaurant", "food_court"]),
        (.transport, ["airport", "international_airport", "train_station", "subway_station", "transit_station", "bus_station", "light_rail_station", "ferry_terminal", "car_rental"]),
        (.nature, ["park", "national_park", "state_park", "beach", "hiking_area", "campground", "garden", "botanical_garden", "wildlife_park"]),
        (.activity, ["amusement_park", "water_park", "aquarium", "zoo", "spa", "movie_theater", "stadium", "arena", "night_club", "casino", "bowling_alley", "ski_resort", "concert_hall", "performing_arts_theater"]),
        (.sight, ["tourist_attraction", "museum", "art_gallery", "church", "mosque", "synagogue", "hindu_temple", "place_of_worship", "historical_landmark", "historical_place", "monument", "cultural_landmark", "observation_deck", "plaza"]),
        (.shop, ["shopping_mall", "department_store", "supermarket", "market", "grocery_store", "clothing_store", "gift_shop", "book_store", "convenience_store"])
    ]

    static func catFromGoogle(types: [String], primary: String?) -> SpotCategory? {
        func hit(_ type: String) -> SpotCategory? { categoryTable.first { $0.1.contains(type) }?.0 }
        if let primary, let category = hit(primary) { return category }
        for (category, list) in categoryTable {
            if types.contains(where: { list.contains($0) }) { return category }
        }
        return nil
    }

    /// `lib.js` normalizeSpot의 placeId 규칙과 같다.
    static func validPlaceId(_ value: String) -> Bool {
        value.count >= 5 && value.count <= 200
            && value.allSatisfy { ($0.isASCII && ($0.isLetter || $0.isNumber)) || $0 == "_" || $0 == "-" }
    }
}
