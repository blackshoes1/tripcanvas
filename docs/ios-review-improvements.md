# iOS 검색 저장 및 비용 화면 개선

검색한 장소가 실제로 저장됐는지 확인하고, 다른 장소로 교체할 때 이전 예약이 잘못 연결되지 않게 한다. 비용·예약은 다른 기기의 변경을 반영하며, 편집 초안은 사용자가 복원 여부를 고를 수 있도록 기기에 보관한다.

## 적용 항목

- 장소 ID가 같은 정보 갱신은 예약·비용을 유지한다. 다른 장소로 교체하면 사용자가 확인한 뒤 예약 연결·숙소 표시·연박·입장 예약·장소 비용을 해제한다. 시간·체류·일정 메모·참여자와 원본 예약은 남는다.
- 일정 검색은 가까운 일자의 장소와 유효한 여행 시간대를 사용한다. 공항·역은 기준에서 제외하고, 명시한 일자 시간대와 다른 지역의 기준점은 사용하지 않는다. 국내·해외 전환을 제공하며, 기준 없는 자동 검색에서 국내 이름 일치가 없으면 해외도 확인한다.
- 일반 검색도 요청 세대를 확인한다. 입력 변경·다음 검색·화면 종료 뒤 이전 응답은 결과와 로딩 상태를 바꾸지 않는다.
- 검색 상세의 추가는 저장 성공 후 닫힌다. 실패하면 선택을 유지하고 같은 장소를 재시도한다. 저장 중에는 추가·닫기·뒤로가기를 막는다.
- 원격 문서·멤버 변경은 비용·예약 캐시를 무효화한다. 열린 편집기를 자동 덮어쓰지 않고, 닫은 뒤 최신 내용으로 다시 읽는다.
- 비용은 일정과 같은 `TripDocumentStore`를 통해 저장한다. 합계 조회는 저장 완료와 분리하며, 이전 revision의 금액을 최신 합계처럼 표시하지 않는다.
- 비용·예약 입력은 계정·여행·대상별 초안으로 보관한다. 원본 내용·예약 연결·revision이 바뀐 초안은 자동 복원하지 않고 확인·복사·버리기를 제공한다. 신규 결제 항목은 재시도와 복원에서 같은 ID를 사용한다.
- 비용 요약은 예상 비용·남은 예산·미정 항목 확인을 먼저 표시하고 결제·환산 상세는 접힌 상태로 연다. 미정·일부 금액만 모아 원본을 고칠 수 있고, 예산도 같은 비용 화면에서 수정한다.

초기 검색·비용 개선에서는 저장 계약·환율·예약 원본·운영 API 주소와 DB 스키마를 유지했다. 아래 추가 검토 보완에는 공통 금액 파서·인증 클라이언트 변경이 포함되므로 웹 자산 버전도 갱신한다.

## 추가 검토 13건 보완 (2026-10-14)

| 검토 항목 | 적용한 동작 | 회귀 검증 |
| --- | --- | --- |
| 앱 복귀 시 일정·비용·예약이 오래된 상태로 남음 | 백그라운드 복귀는 재구독에 더해 API 조회·캐시 무효화. 일정·비용 편집 중에는 원본을 유지하고 닫은 뒤 갱신 | `IOSAdditionalReviewTests`, 기존 비용 편집 보호 테스트 |
| 목록의 늦은 조회가 생성·삭제를 덮음 | 조회·변경 세대 확인, 중복 삽입 방지, 실패 복구 시 기존 행 확인 | 지연 목록 응답과 생성·삭제 테스트 |
| 붙여넣기 입력 유실 | 계정별 원문·파싱 결과·선택·위치·생성 ID 기기 초안, 명시적 복원·버리기, 닫기 확인 | 초안 파일 왕복 + 앱 종료·복원 UI 테스트 |
| 예약 저장이 후속 GET을 기다림 | PUT 완료 뒤 즉시 편집기 종료. 요약은 별도 Task에서 갱신 | 지연 예약 요약 응답 테스트 |
| 비밀번호 재설정 연결 실패를 성공으로 안내 | 계정 유무는 숨기되 연결 실패·요청 제한은 재시도 안내. 웹·iOS 같은 정책 | 웹 인증·iOS 상태 및 HTTP transport 테스트 |
| 외화 소수 오독 | 소수·천 단위 구분 보존, 깨진 숫자 부분 추출 방지, Swift 금액을 Double로 수신 | 공통 파서·일정 API·iOS 계약 테스트 |
| 가져온 정보 누락 | 금액·통화·선택 표시·예약 링크·주소·카카오 ID 저장 | 실제 생성 문서와 원본 필드 대조 |
| 멀티시티 검색 기준 오류 | 당일의 선택한 장소만 기준으로 사용, 교통 장소 제외, 명시 도시가 다르면 좌표 사용 안 함 | 날짜·공항·도시가 다른 입력 테스트 |
| 여행 생성 재시도 중복 | 입력 상태가 UUID를 유지. 서버의 기존 ID 충돌 계약을 사용해 이미 생성된 여행 확인 | 저장 후 응답 유실 → POST 재시도 → GET으로 동일 여행 복구 |
| 예약 종료일 경고 누락 | 시작·종료 날짜 모두 새 기간과 비교 | 체크인만 기간 안에 있는 예약·종료일만 있는 예약 |
| Siri 안내 시작 요건 불충족 | 시작·종료 Intent가 LiveActivityIntent를 따르고 시스템 요청 완료까지 기다림 | 프로토콜 컴파일 + 지연 안내 시작 테스트 |
| Siri 종료가 기존 앱에 반영 안 됨 | 앱 복귀와 요청 완료에 공유 상태 재확인. 오래된 요청과 종료된 상태를 다시 적용하지 않음 | 별도 앱/Siri 컨트롤러와 늦은 응답 |
| 잠금화면 안내 중복 | 시스템의 진행 중 Activity에서 같은 여행·이름·일자를 재사용하고 중복·다른 안내 종료 | 복구 대상 선택 테스트 + Release 컴파일 |

여행 생성에는 `creationKey`와 `creationFingerprint` 메타데이터를 원문에 보존한다. 서버의 기존 `POST {trip}`·ID 충돌·권한 확인 경로를 사용하며 새 라우트·DB 마이그레이션은 없다. 응답 유실 후 입력까지 바뀐 경우 기존 여행을 새 입력이 저장된 결과로 안내하지 않고 목록에서 확인하도록 한다. 기존 여행을 덮거나 자동 복제하지 않는다.

시뮬레이터 UI 검증은 합성 의존성으로만 실행한다. Siri 실제 실행·실기기 잠금화면 표시·서명·푸시 도착은 CI 결과와 구분한다.

## 후속 검토 8건 적용 (2026-10-14)

아래 8건은 위의 첫 추가 검토 13건 다음에 발견한 항목이다. 이어지는 재검토 13건과 별도로 추적한다. 표의 회귀 검증은 **작성한 검사**이며, 이번 변경의 네이티브 실행 결과는 아직 대기 중이다.

| 번호 · 발견 내용 | 적용한 동작 | 구현 근거 | 회귀 검증 |
| --- | --- | --- | --- |
| 8-1 · 붙여넣기 시작일 오류에도 이전 날짜로 생성 | 날짜 칸의 오류 상태와 실제 날짜 유효성을 생성 버튼·생성 함수 양쪽에서 확인. 날짜 없는 여행은 허용 | [PasteItineraryView.swift](../ios/TripCanvas/Features/Trips/PasteItineraryView.swift) `canCreate` | [EditingFollowupTests](../ios/TripCanvasTests/EditingFollowupTests.swift) `testPasteInvalidInputCannotUseThePreviousValidStart`, `testPasteAllowsUndatedTravelAndRejectsInvalidCanonicalDates` |
| 8-2 · 숙소 선택이 입력한 통화를 덮음 | 이미 입력한 금액·통화는 유지. 통화 선택 여부도 초안에 보존. 다른 통화의 숫자를 환산 없이 자동 입력하지 않음 | [BookingEditorView.swift](../ios/TripCanvas/Features/Booking/BookingEditorView.swift) `BookingStayPrefill` | [EditingFollowupTests](../ios/TripCanvasTests/EditingFollowupTests.swift) 입력 중 소수·통화 선택·통화 불일치·원화 기본값, 기존 예약 초안 복원 UI 검사 |
| 8-3 · Siri 오늘 열기가 새 라우터에 전달 | 앱이 등록한 `ActionRouter`를 App Intent 의존성으로 사용 | [TripCanvasIntents.swift](../ios/TripCanvas/Features/Intents/TripCanvasIntents.swift), [AppEnvironment.swift](../ios/TripCanvas/App/AppEnvironment.swift) | [SystemFollowupTests](../ios/TripCanvasTests/SystemFollowupTests.swift) `testOpenTodayIntentUsesTheRouterRegisteredByTheApp` |
| 8-4 · 알림 미등록도 이미 보낸 것으로 기록 | 조회는 `markSent: false`. 현재 권한을 확인하고 시스템 등록 성공한 DEVICE 항목만 로컬 기록·서버 ACK. ACK 응답 유실은 알림을 중복 등록하지 않고 재확인 | [PushService.swift](../ios/TripCanvas/Core/Push/PushService.swift), [TravelModeController.swift](../ios/TripCanvas/Features/TravelMode/TravelModeController.swift), [NotificationAcknowledgement.swift](../ios/TripCanvas/Services/NotificationAcknowledgement.swift), [tripViews.ts](../next/src/features/trip-state/services/routes/tripViews.ts) | [SystemFollowupTests](../ios/TripCanvasTests/SystemFollowupTests.swift) 권한 거부·등록 실패·ACK 응답 유실, [handlers.test.ts](../next/src/features/trip-state/services/handlers.test.ts) ACK 인증·입력 제한·중복·기록 실패 |
| 8-5 · APNs 토큰 등록 콜백 누락 | 앱 델리게이트에서 토큰·실패 콜백을 `PushService`로 연결하고 서버 등록 실패 상태를 보존 | [TripCanvasApp.swift](../ios/TripCanvas/App/TripCanvasApp.swift), [PushService.swift](../ios/TripCanvas/Core/Push/PushService.swift) | [SystemFollowupTests](../ios/TripCanvasTests/SystemFollowupTests.swift) `testAPNsBridgeRegistersTheReceivedTokenAndReportsFailure` |
| 8-6 · 알림 탭의 링크를 화면에서 소비하지 않음 | 수신 링크를 앱 라우터로 전달. 유효한 여행 링크만 이동하고 처리한 대기 링크는 제거 | [PushService.swift](../ios/TripCanvas/Core/Push/PushService.swift), [AppEnvironment.swift](../ios/TripCanvas/App/AppEnvironment.swift) | [SystemFollowupTests](../ios/TripCanvasTests/SystemFollowupTests.swift) `testNotificationTapIsDeliveredToTheAppRouterAndInvalidLinksAreIgnored` |
| 8-7 · 동시 위치 조회가 먼저 요청한 대기를 덮음 | 하나의 시스템 위치 조회를 여러 호출자가 공유. 호출자별 취소·시간 제한·권한 응답 후 조회 처리 | [LocationProvider.swift](../ios/TripCanvas/Core/Location/LocationProvider.swift) | [SystemFollowupTests](../ios/TripCanvasTests/SystemFollowupTests.swift) 동시 조회·한 호출자 취소·시간 제한·권한 대기 |
| 8-8 · 새 여행 생성 중 입력 변경 가능 | 요청 중 폼 전체와 취소·방식 전환을 잠그고 날짜 오류는 실제 생성 함수에서도 차단 | [NewTripView.swift](../ios/TripCanvas/Features/Trips/NewTripView.swift) | Debug 합성 `--review-scratch`에서 지연 저장 중 이름·도시 입력 잠금 및 저장된 이름 확인 |

## 재검토 13건 적용 (2026-10-14)

| 번호 · 발견 내용 | 적용한 동작 | 구현 근거 | 회귀 검증 |
| --- | --- | --- | --- |
| 13-1 · Siri가 활성 여행 대신 첫 여행을 변경 | 공유 상태의 활성 `tripId`를 우선 선택. 여러 여행에서 대상을 확정할 수 없거나 삭제된 여행이면 변경을 거절 | [TripCanvasIntents.swift](../ios/TripCanvas/Features/Intents/TripCanvasIntents.swift) `IntentSupport.selectTrip` | [SystemFollowupTests](../ios/TripCanvasTests/SystemFollowupTests.swift) `testSiriMutationUsesThePersistedActiveTripInsteadOfFirstLiveTrip` |
| 13-2 · 분리 일정 부분 저장 재시도에서 장소 3개 중복 | 문서에 이미 저장된 후보·분리 묶음을 다시 읽어 복구하고 후보 표시만 재시도. 다시 연 미리보기 ID도 중복 생성하지 않음 | [CandidateBoardViewModel.swift](../ios/TripCanvas/Features/Collab/CandidateBoardViewModel.swift), [CollabModel.swift](../ios/TripCanvas/Core/Models/CollabModel.swift), [collab.js](../collab.js) | [CollabFollowupTests](../ios/TripCanvasTests/CollabFollowupTests.swift) 문서 응답 유실·후보 표시 실패·표시 응답 유실, 공통 분리 파리티 픽스처 |
| 13-3 · 늦은 GET이 새 PUT의 기기 캐시를 덮음 | 문서·오늘·일자 캐시의 revision을 낮추지 않음. 계정·여행의 요청 세대를 확인해 오래된 응답의 저장을 거절 | [TripCache.swift](../ios/TripCanvas/Core/Storage/TripCache.swift), [TripService.swift](../ios/TripCanvas/Services/TripService.swift) | [AccountCacheFollowupTests](../ios/TripCanvasTests/AccountCacheFollowupTests.swift) `testLateDocumentGETCannotReplaceSavedRevisionOnDiskOrAfterRestart`, `testLateTodayAndDayPlanResponsesDoNotRegressCachedRevision` |
| 13-4 · 삭제·탈퇴한 여행이 오프라인 캐시에서 재등장 | 성공한 제거 뒤 목록·문서·예약·오프라인 묶음 삭제, 이미 출발한 GET으로 복구하지 않음. 실패한 제거는 캐시 보존, 새 초대 수락은 새 접근 세대로 처리 | [TripCache.swift](../ios/TripCanvas/Core/Storage/TripCache.swift), [TripService.swift](../ios/TripCanvas/Services/TripService.swift) | [AccountCacheFollowupTests](../ios/TripCanvasTests/AccountCacheFollowupTests.swift) 성공·실패 제거, 재시작, 늦은 GET, 재초대 |
| 13-5 · 공유 자료 저장 대기 중 유형·제목·본문 변경 | 확인 버튼을 누른 순간의 입력을 값으로 고정해 최신 문서 조회·PUT에 사용하고, 화면 입력도 저장 중 잠금 | [SharedImport.swift](../ios/TripCanvas/Features/Inbox/SharedImport.swift), [SharedInboxView.swift](../ios/TripCanvas/Features/Inbox/SharedInboxView.swift) | [AccountCacheFollowupTests](../ios/TripCanvasTests/AccountCacheFollowupTests.swift) `testSharedImportUsesConfirmedInputDuringDelayedReadAndSave`, Debug 합성 `--review-shared` |
| 13-6 · 비용 조회 실패 시 결제일로 상태 전환, 옛 테스트도 오류 통과 | 날짜 자동 판정 제거. 서버 응답이 없으면 `PaymentRow.manualPayState` 유지. 과거 예정·미래 완료·날짜만 있는 미구분을 실제 행으로 검사 | [TripCostsView.swift](../ios/TripCanvas/Features/Plan/TripCostsView.swift), [DayCost.swift](../ios/TripCanvas/Core/Models/DayCost.swift), [PaymentLedger.swift](../ios/TripCanvas/Features/Plan/PaymentLedger.swift) | [PaymentLedgerTests](../ios/TripCanvasTests/PaymentLedgerTests.swift) `testPaymentRowKeepsConfirmedStateRegardlessOfPaymentDate`; 공통 [day-cost.test.js](../test/day-cost.test.js) 날짜와 상태 독립 규칙 |
| 13-7 · 빠른 지출을 연결 숙소의 계산되지 않는 금액에 저장 | 금액 있는 숙박 예약이 연결된 장소는 별도 현장 비용으로 저장. 원래 숙박 예약·장소는 유지. 예약 금액 미정이면 장소 비용 경로를 허용 | [DayCost.swift](../ios/TripCanvas/Core/Models/DayCost.swift) `SpotExpensePolicy`, [QuickSpendEditor.swift](../ios/TripCanvas/Features/Plan/QuickSpendEditor.swift), [DayCostView.swift](../ios/TripCanvas/Features/Plan/DayCostView.swift), [TripCostsView.swift](../ios/TripCanvas/Features/Plan/TripCostsView.swift) | [EditingFollowupTests](../ios/TripCanvasTests/EditingFollowupTests.swift) priced/unpriced·잘못된 예약 종류·다른 예약, Debug 합성 연결 호텔의 별도 비용과 예약 원액 확인 |
| 13-8 · 후보 삭제 후 지도에 저장됨 표시 잔존 | 서버 후보 목록 확인 뒤 임시 저장 표시와 삭제된 후보 ID·요청 키를 정리하여 같은 장소를 새 후보로 저장 가능 | [MapDiscoveryModel.swift](../ios/TripCanvas/Features/Map/MapDiscoveryModel.swift) | [MapDiscoveryTests](../ios/TripCanvasTests/MapDiscoveryTests.swift) `testDeletedCandidateCanBeSavedAgainWithANewRequestKey` |
| 13-9 · 해외 추가 조회가 유효한 국내 결과를 실패·무관 결과로 대체 | 국내 결과가 있으면 해외 추가 조회 실패를 이유로 지우지 않음. 해외 이름이 맞는 결과일 때만 대체 | [PlaceSearchService.swift](../ios/TripCanvas/Features/Map/PlaceSearchService.swift) | [PlaceSearchTransportTests](../ios/TripCanvasTests/PlaceSearchTransportTests.swift) `testSupplementalForeignFailureKeepsValidDomesticResults`, `testUnrelatedForeignResultDoesNotReplaceDomesticResults` |
| 13-10 · 빠른 반응에서 옛 실패가 최신 성공을 되돌림 | 후보별 반응 요청 세대 확인. 옛 실패를 무시하고, 서버를 뒤늦게 덮은 옛 성공 뒤에는 마지막 선택을 복구 | [CandidateBoardViewModel.swift](../ios/TripCanvas/Features/Collab/CandidateBoardViewModel.swift) | [CollabFollowupTests](../ios/TripCanvasTests/CollabFollowupTests.swift) `testNewReactionSuccessSurvivesOlderDelayedFailure`, `testOlderDelayedSuccessCannotLeaveServerWithOlderReaction` |
| 13-11 · 펼친 댓글이 실시간으로 갱신되지 않음 | 댓글 이벤트에서 현재 열린 댓글만 다시 읽음. 닫힌 댓글은 미리 요청하지 않음 | [CandidateBoardView.swift](../ios/TripCanvas/Features/Collab/CandidateBoardView.swift), [CandidateBoardViewModel.swift](../ios/TripCanvas/Features/Collab/CandidateBoardViewModel.swift) | [CollabFollowupTests](../ios/TripCanvasTests/CollabFollowupTests.swift) `testLiveCommentReloadsOnlyOpenedThread` |
| 13-12 · 탈퇴 후 접근할 수 없는 여행 화면에 잔류 | 탈퇴 성공 후 여행 경로·열린 패널·그 여행의 대기 이동을 정리하고 목록 갱신 | [CollabView.swift](../ios/TripCanvas/Features/Collab/CollabView.swift), [CollabViewModel.swift](../ios/TripCanvas/Features/Collab/CollabViewModel.swift), [TripListView.swift](../ios/TripCanvas/Features/Trips/TripListView.swift) | [CollabFollowupTests](../ios/TripCanvasTests/CollabFollowupTests.swift) `testSuccessfulLeaveClearsNavigationAndPendingRoute` |
| 13-13 · 취향 갱신이 편집 중인 이름을 덮음 | 원본 이름과 입력 초안을 구분. 첫 응답·새로고침·저장 응답 동안 새로 친 내용은 유지 | [CollabView.swift](../ios/TripCanvas/Features/Collab/CollabView.swift) `CollabNameDraft` | [CollabFollowupTests](../ios/TripCanvasTests/CollabFollowupTests.swift) `testNameDraftSurvivesPreferenceRefreshAndTypingDuringSave` |

### 연동 보완과 범위

- **전경 복귀:** 같이 짜기와 후보 보드는 현재 보이는 화면에서 멤버·권한·취향·활동·초대·열린 댓글을 다시 확인한다. 숨겨진 화면은 캐시를 무효화하고 다시 열 때 조회한다. 복귀 전 시작된 읽기가 무효화된 캐시를 되살리지 않게 요청 세대도 확인한다. 근거는 `TripHomeView`·`CollabViewModel`·`CandidateBoardViewModel`이고, `CollabFollowupTests`의 보이는/숨겨진 화면 및 지연 읽기 검사가 대응한다.
- **숙박 1인 금액:** 8-2의 자동입력 보완에는 `costBasis: PER_PERSON`과 정수 인원을 곱해 예약 총액으로 옮기는 처리가 포함된다. `CostEntry.totalAmount`는 공통 `lib.js costAmountOf`처럼 명시한 기준에만 인원을 곱하고 통화의 최소 단위로 반올림한다. 100 EUR × 2명은 예약 총액 200 EUR다. 이는 별도 새 발견 수에 더하지 않는다.
- **Watch 제외:** 이번 수정·검증 범위는 iOS 앱과 관련 공통 API다. Watch의 실제 동작·동기화·알림은 별도 검토 및 기기 검증 대상이다. 공유 계약이나 앱 타깃의 CI 성공을 Watch 동작 검증으로 표시하지 않는다.

### 이번 변경 검증 대기표

| 검증 | 현재 상태 | 완료 조건 |
| --- | --- | --- |
| iOS 신규 회귀 테스트 | 작성됨 · 실행 대기 | `EditingFollowupTests`·`SystemFollowupTests`·`AccountCacheFollowupTests`·`CollabFollowupTests`와 기존 검색·지도·결제 테스트를 최종 커밋에서 실행 |
| iOS Debug 빌드·XCTest·UI 조작 | 실행 대기 | XcodeGen 생성, 전체 단위·UI 검사 및 결과 번들 확인. 날짜 오류·저장 중 잠금·연결 호텔 별도 비용·공유 자료 저장을 합성 의존성으로 조작 |
| iOS Release 빌드 | 실행 대기 | 최종 커밋의 Release 빌드 및 Debug 합성 화면 제외 확인 |
| ACK API 및 전체 저장소 게이트 | 실행 대기 | ACK 라우트 단위·권한·중복·실패 검사와 `npm run verify:all` 결과 확인. PASS/FAIL/SKIP을 구분 |
| 실기기 Siri·APNs·알림 탭·잠금화면 | 미검증 | 실제 등록·도착·이동·기기 상태와 권한 변화 확인. 시뮬레이터 콜백 테스트만으로 완료 처리하지 않음 |
| Watch | 이번 범위 제외 | 별도 Watch 검토·기기 검증 |

공통 비용 원본의 로컬 검사는 `node --test test/day-cost.test.js` **35개 통과**했다. 이는 비용 계산 원본의 확인이며 새 Swift 테스트·네이티브 화면·ACK API 검증을 대신하지 않는다. 이전 커밋의 iOS 성공 기록을 이번 변경의 검증 결과로 재사용하지 않는다.

## 검증 중 발견한 의존성 보완

기존 Next 워크스페이스의 보안 감사에서 발견한 취약점은 `sharp 0.35.5`, `source-map-js 1.2.2`, `Vitest 4.1.11`로 갱신한다. Drizzle 개발 도구가 사용하는 `@esbuild-kit/core-utils`의 esbuild만 `0.25.12`로 고정한다. 테스트 도구의 변경 범위를 줄이기 위해 기존 Vite `7.3.6`을 명시한다. 개발 도구의 `brace-expansion`도 수정 버전으로 갱신한다. Next·React·인증 라이브러리의 버전과 운영 설정은 유지한다. 보안 감사뿐 아니라 전체 백엔드 테스트·타입 검사·운영 빌드·도구 빌드로 호환성을 확인한다.

개발 도구 전체 감사에는 ESLint의 `braces 3.0.3` 의존 경로 5건이 남는다. [공식 보안 공지](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)에 수정 버전이 없고 npm 최신 버전도 `3.0.3`이다. 이는 개발 도구의 glob 패턴 처리 경로이며 `npm audit --omit=dev`에서는 취약점 0건이다. 패치가 나오면 갱신해야 하며, 감사 제외나 Next ESLint의 강제 다운그레이드로 통과를 만들지 않는다.

## 검증

`IOSReviewRegressionTests`는 검색 응답 순서·닫힌 검색의 늦은 응답·저장과 합계 갱신의 분리·원격 변경 중 편집 보호·미정 필터를 검사한다. `PlaceSearchTransportTests`는 합성 HTTP 응답으로 한글 해외 검색·자동 폴백·명시적 국내 검색의 호출 경로를 검사한다. 장소 교체와 기기 초안 테스트는 같은 장소·호텔에서 카페로 교체·다른 revision·변경된 연결을 다룬다.

`TripCanvasUITests`는 Debug 전용 합성 화면에서 검색 실패 후 재시도, 미정 필터·예산 저장, 비용·예약 입력 중 앱 종료와 명시적 복원, 큰 글자·다크 화면의 주요 동작을 검증한다. 운영 계정·운영 API에 테스트 자료를 쓰지 않는다. 비용 합성 자료는 API 파리티 픽스처를 사용한다. 이 화면과 합성 의존성은 `#if DEBUG` 안에 있으며 Release의 실행 화면에는 포함되지 않는다.

전체 게이트는 `npm run verify:all`, iOS는 XcodeGen 명세의 `TripCanvas` 스킴으로 Debug XCTest·UI 테스트와 Release 빌드를 실행한다. iOS CI는 결과 번들을 `ios-test-results` 아티팩트로 남긴다. Windows의 로컬 실행으로 Xcode·실기기·VoiceOver 검증까지 통과했다고 판단하지 않는다.

## 릴리스와 되돌리기

수정 브랜치의 PR에서 필수 CI와 iOS 조작 결과를 확인한다. main merge는 자동 배포와 연결되므로 별도 릴리스 판단을 거친다. 되돌릴 때는 이번 변경을 revert한다. 서버 스키마 변경이나 데이터 마이그레이션은 없다.

이번 후속 보완은 `POST /api/v1/trips/:id/travel-state` 알림 등록 확인(ACK) 경로를 추가한다. ACK는 **기기의 시스템 알림 등록 성공**을 기록하며 APNs 실제 도착을 보증하지 않는다. 서버는 인증·여행 접근 권한·DEVICE 종류·여행별 dedupe key·입력 크기를 검사하고 중복 확인은 같은 결과로 처리한다. 기존 GET의 `markSent` 계약은 기존 클라이언트 호환을 위해 유지하고, 새 iOS는 조회 단계에서 발송을 기록하지 않는다.

**API를 먼저 릴리스한다.** 서버 변경의 게이트 통과 → NAS 배포의 실제 revision·건강 상태·ACK 지원 확인 → 새 iOS 배포 순서로 진행한다. API 지원이 없는 서버에 새 앱을 먼저 배포하지 않는다. 이 문서는 준비·검증 범위를 기록한 것이며 운영 merge·배포를 수행했다는 기록이 아니다. 클라이언트를 되돌릴 때 ACK 라우트는 하위호환으로 남길 수 있으므로 서버와 앱을 동시에 강제로 롤백할 필요는 없다.
