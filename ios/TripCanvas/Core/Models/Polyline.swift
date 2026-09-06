import Foundation

/// 경로 폴리라인 — 서버가 보내는 인코딩 문자열을 좌표로 푼다.
///
/// ⚠️ **`lib.js`의 `decodePolyline` 복사본이다.** 규칙을 바꾸려면 `lib.js`를 먼저 고친다 —
/// `polylineParity.test.ts`가 픽스처(`Fixtures/polyline.json`)를 새로 쓰고 여기 테스트가 깨진다.
///
/// 형식은 구글 폴리라인 하나뿐이다: 카카오 경로도 서버에서 같은 함수로 인코딩되므로
/// 국내·해외 지도가 같은 문자열을 받는다.
enum Polyline {

    /// 못 읽는 문자열은 **빈 배열**이다 — 없는 길을 지어내지 않는다.
    static func decode(_ encoded: String?) -> [GeoPoint] {
        guard let encoded, !encoded.isEmpty else { return [] }
        let factor = 1e5
        var points: [GeoPoint] = []
        var lat = 0, lng = 0
        var index = encoded.startIndex

        /// 한 값을 읽는다. 문자열이 중간에 끊기면 nil — 거기까지만 쓴다.
        func next() -> Int? {
            var shift = 0
            var result = 0
            var byte = 0
            repeat {
                guard index < encoded.endIndex, let ascii = encoded[index].asciiValue else { return nil }
                index = encoded.index(after: index)
                byte = Int(ascii) - 63
                guard byte >= 0 else { return nil }
                result |= (byte & 0x1f) << shift
                shift += 5
                guard shift < 32 else { return nil }   // 32비트를 넘는 입력은 우리 것이 아니다
            } while byte >= 0x20
            return (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
        }

        while index < encoded.endIndex {
            guard let dLat = next(), let dLng = next() else { break }
            lat += dLat
            lng += dLng
            points.append(GeoPoint(lat: Double(lat) / factor, lng: Double(lng) / factor))
        }
        return points
    }
}
