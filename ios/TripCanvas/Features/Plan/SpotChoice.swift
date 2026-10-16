import Foundation

/// 두 장소를 한 일정 칸에 둔다. 현재 장소만 기존 계산에 들어가고 대안은 원문 안에 보관된다.
/// 구버전 앱도 현재 장소를 읽을 수 있으며, 선택은 기존 문서 CAS 저장 경로를 그대로 지난다.
struct SpotChoice: Hashable, Sendable {
    enum State: String, Sendable { case pending = "PENDING", selected = "SELECTED" }
    var alternative: TripSpot
    var state: State
    var decideBy: String?

    func replacingAlternative(_ spot: TripSpot) -> SpotChoice {
        var edited = self; edited.alternative = spot; return edited
    }

    static let slotKeys = ["at", "who", "split", "reunion", "must", "opt"]

    static func unavailableReason(_ spot: TripSpot, allowsFinished: Bool = false) -> String? {
        if spot.isStay || spot.category == .stay { return "숙소는 하루 출발·복귀 기준이라 선택지로 묶을 수 없어요." }
        if spot.bookingId != nil || spot.carPickupId != nil || spot.carReturnId != nil {
            return "연결된 예약·렌터카 장소는 선택지로 묶을 수 없어요. 예약 원본에서 먼저 연결을 확인해 주세요."
        }
        if !allowsFinished && spot.status != .planned { return "이미 완료하거나 건너뛴 장소는 선택지로 묶을 수 없어요." }
        if !allowsFinished && spot.raw["payState"]?.stringValue == "PAID" {
            return "이미 낸 비용이 있는 장소는 선택지로 바꿀 수 없어요. 지출 내역을 먼저 확인해 주세요."
        }
        return nil
    }

    static func validTime(_ text: String?) -> Bool {
        guard let text, !text.isEmpty else { return true }
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              text.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == ":") }),
              let h = Int(parts[0]), let m = Int(parts[1]) else { return false }
        return (0...23).contains(h) && (0...59).contains(m)
    }

    static func samePlace(_ a: TripSpot, _ b: TripSpot) -> Bool {
        if let id = a.placeId, let next = b.placeId, id == next { return true }
        if let id = a.kakaoId, let next = b.kakaoId, id == next { return true }
        return a.name.trimmingCharacters(in: .whitespacesAndNewlines).localizedCaseInsensitiveCompare(
            b.name.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame && a.city == b.city && a.point == b.point
    }

    func validationError(current: TripSpot) -> String? {
        if let reason = Self.unavailableReason(current, allowsFinished: state == .selected) ?? Self.unavailableReason(alternative) { return reason }
        for spot in [current, alternative] {
            let name = spot.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty || name.utf16.count > 240 { return "선택지 이름을 240자 안에서 입력해 주세요." }
        }
        if alternative.raw["choice"] != nil { return "선택지는 두 장소까지 담을 수 있어요." }
        if Self.samePlace(current, alternative) { return "서로 다른 두 장소를 골라 주세요." }
        if !Self.validTime(decideBy) { return "결정 시각은 HH:MM 형식으로 입력해 주세요." }
        if let decideBy, !decideBy.isEmpty,
           let booking = [current.bookedAt, alternative.bookedAt].compactMap({ $0 }).filter({ !$0.isEmpty }).min(),
           decideBy > booking {
            return "결정 시각은 가장 이른 예약·입장 시각 \(booking)보다 늦지 않게 정해 주세요."
        }
        return nil
    }
}

extension TripSpot {
    var choice: SpotChoice? {
        get {
            guard let object = raw["choice"]?.objectValue,
                  object["version"]?.doubleValue == 1,
                  let state = object["state"]?.stringValue.flatMap(SpotChoice.State.init(rawValue:)),
                  let alternative = object["alternative"]?.objectValue else { return nil }
            return SpotChoice(alternative: TripSpot(raw: alternative), state: state,
                              decideBy: object["decideBy"]?.stringValue)
        }
        set {
            guard let newValue else { setField("choice", nil); return }
            var alternate = newValue.alternative.raw
            alternate.removeValue(forKey: "choice")
            for key in SpotChoice.slotKeys { alternate.removeValue(forKey: key) }
            // 이미 있는 미래 메타데이터도 선택 상태를 바꾸는 동안 보존한다.
            var object = raw["choice"]?.objectValue ?? [:]
            object["version"] = .number(1)
            object["state"] = .string(newValue.state.rawValue)
            object["alternative"] = .object(alternate)
            object.setOrRemove("decideBy", newValue.decideBy.flatMap { $0.isEmpty ? nil : .string($0) })
            setField("choice", .object(object))
        }
    }

    var pendingChoiceLabel: String? {
        guard let choice, choice.state == .pending else { return nil }
        return "아직 고르지 않았어요 · \(name) / \(choice.alternative.name)"
    }

    /// 선택한 장소의 신원·예약·비용은 함께 바뀌고, 일정 칸의 시각·참여자·분리는 그대로다.
    /// 예약 원본을 취소하거나 지우지 않는다. UI는 바꾼 뒤 '완료'로 저장하기 전까지 초안이다.
    mutating func selectChoice(alternative: Bool) {
        guard var choice, status == .planned, raw["payState"]?.stringValue != "PAID", choice.validationError(current: self) == nil else { return }
        if alternative {
            var previous = raw
            previous.removeValue(forKey: "choice")
            for key in SpotChoice.slotKeys { previous.removeValue(forKey: key) }
            var next = choice.alternative.raw
            for key in SpotChoice.slotKeys {
                next.setOrRemove(key, raw[key])
            }
            next["choice"] = raw["choice"]
            self = TripSpot(raw: next)
            choice.alternative = TripSpot(raw: previous)
        }
        choice.state = .selected
        self.choice = choice
    }
}
