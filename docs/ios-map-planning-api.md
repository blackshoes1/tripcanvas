# iOS 지도 탐색 API

## 국내 지도 검색

인증된 `GET /api/v1/places/search`에 기존 `q`, `lat`, `lng`, `limit` 외에 다음 선택 인자를 받는다.

- `category`: `food` / `cafe` / `attraction` / `stay`. 각각 카카오 `FD6` / `CE7` / `AT4` / `AD5`다.
- `bounds`: `south,west,north,east` 순서의 십진 좌표. 실제 카카오 요청에서는 `rect=west,south,east,north`로 바꾼다.
- 검색어가 없으면 `category`와 유효한 `bounds`가 모두 필요하다.

화면 범위 검색은 지도 밖 결과를 제외하고, 결과가 없을 때 전국으로 넓혀 다시 찾지 않는다. 기존 `q + lat/lng` 요청의 근처→전국 검색 순서는 유지한다. 날짜변경선을 넘거나 역전된 범위, 부적절한 숫자는 400이다. 앱의 화면 탐색 범위는 지도 중심에서 가장 먼 모서리까지 20km로 제한하며 초과 시 확대 안내를 반환한다. 이는 카카오 `rect`의 공식 제한을 뜻하지 않는다.

기존 응답 필드를 유지하며 각 장소에 `provider: "kakao"`, `providerId: string | null`, `placeUrl: string | null`을 추가한다. 원본 ID나 장소 링크가 없으면 만들어 내지 않는다. REST 키는 서버 헤더에만 사용한다. 제공처 연결 실패는 빈 검색 결과와 구분한다.

카카오 API의 매개변수와 응답은 [공식 REST 문서](https://developers.kakao.com/docs/ko/local/dev-guide)를 기준으로 한다. 모의 응답 테스트는 실제 제공처 조회 성공을 뜻하지 않는다.

## 후보 저장과 다시 읽기

`POST /api/v1/trips/:id/candidates`는 기존 본문에 `provider: "kakao" | "google" | null`, `providerId: string | null`, `clientKey: UUID | null`을 선택적으로 받는다. 성공 응답은 기존 `{ schemaVersion, id }`와 201을 유지한다. 조회 응답에는 `provider`, `provider_id`를 선택 필드로 추가한다.

- NAS `trip_candidates.provider`, `provider_id`에 분리해서 저장한다. 기존 `place_id`는 Google ID 호환 필드다.
- Google ID는 기존 `place_id`에도 보존한다. Kakao ID를 `place_id`로 보내는 혼용 요청은 거절한다. 클라이언트가 일정에 배치할 때 Kakao ID는 `spot.kakaoId`, Google ID는 `spot.placeId`로 옮긴다.
- `providerId`가 있으면 지원하는 `provider`가 있어야 한다. 제공자만 알고 ID가 없으면 제공자를 보존하고 중복 판정은 하지 않는다.
- 같은 여행의 동일 `provider + providerId`는 DB 유일성 제약과 트랜잭션으로 한 후보만 저장한다. 반복 담기는 기존 ID를 반환하며 제목·메모·상태를 덮어쓰지 않는다. 다른 편집자의 첫 담기는 그 후보에 MUST 의견을 추가하되, 이미 남긴 의견은 유지한다. 제안 활동은 첫 생성 시만 기록한다.
- 같은 담기 요청의 통신 재시도는 처음 만든 `clientKey`와 원래 본문을 유지한다. `client_key`는 UUID로 저장하며 같은 여행 안에서 유일하다. 좌표·제공자 ID가 없는 직접 입력도 동일 요청 키로 재시도하면 기존 ID와 활동 한 건을 유지한다. 다른 키나 다른 여행을 이름으로 합치지 않는다. 사용자가 제외한 후보를 담을 때에는 별도 REOPEN 확인을 거치며 중복 요청으로 제외 상태를 자동 취소하지 않는다.
- 다른 제공자의 ID, 동명이점, 좌표만 같은 장소, ID가 없는 장소를 추측해 합치지 않는다. 기존 행의 제공자 ID도 추측해 채우거나 병합하지 않는다.
- 위치가 없으면 위도·경도 모두 null이다. 숫자가 아닌 값, 범위 밖 좌표, 한쪽만 있는 좌표는 400이다. 실제 0 좌표는 유효하다.
- OWNER/EDITOR만 담을 수 있고 VIEWER 및 다른 여행 사용자는 기존 권한 규칙으로 차단한다.

일정에는 후보의 `candidateId`를 함께 보존한다. NAS 여행 PUT은 기존 문서에 연결 ID가 있던 동일 여행의 SCHEDULED 후보만 같은 CAS 트랜잭션에서 새 일자 참조로 바꾸며, 연결 장소를 삭제하면 PROPOSED로 돌린다. 새 PROPOSED의 최초 SCHEDULE 표시는 기존 별도 요청이 담당한다. 다른 여행 후보, ID 없는 legacy, 여러 날짜에 복제된 모호한 ID는 추측 수정하지 않는다. 기존 일정 변경 활동으로 보드를 다시 읽으며 후보 활동을 중복 생성하지 않는다. 그룹 제안은 이미 문서에 들어간 확정 candidateId를 제외해 상태 표시 실패 후 재배치를 제안하지 않는다.

레거시 Supabase 후보 RPC는 새 제공자 필드·멱등 요청 키를 보존할 수 없어 해당 요청을 명시적 미지원 오류로 반환한다. 기존 입력은 유지한다. 이 기능의 운영 대상은 NAS다.

## 배포와 되돌리기

마이그레이션 `0010_candidate_place_provider`는 nullable provider/provider_id/client_key 컬럼, 제공자/ID 체크, 여행별 제공자 ID·요청 키 유일 인덱스를 추가한다. 기존 행은 변경하지 않는다. 아직 배포하지 않은 0010에 요청 키 변경을 합쳤으며 Drizzle snapshot과 journal도 같은 최종 스키마로 맞췄다. 앱 배포 전 NAS에 이 마이그레이션과 동일 커밋의 API를 배포해야 한다. 프로젝트의 NAS 릴리스 절차에 따라 migrate·api·realtime을 같은 커밋으로 빌드하고 전체 구성을 확인한다.

배포 순서는 [NAS 릴리스 절차](nas-release.md)를 따른다.

1. 배포 대상 커밋을 확정하고 전체 검증 결과와 스킵 항목을 확인한다. 운영 백업을 먼저 확인하고 실제 DB의 마지막 migration이 0009인지 확인한다. 어떤 환경이든 이전 내용의 0010을 이미 적용했다면 파일을 덮어써 재적용하지 않고, 차이를 별도 forward migration으로 추가해야 한다.
2. 같은 커밋으로 `migrate`, `api`, `realtime` 이미지를 빌드한다. 운영 환경 변수는 기존 운영 파일을 유지한다. 앱·정적 웹 배포는 아직 진행하지 않는다.
3. `migrate`를 실행해 0010 성공과 migration journal을 확인한다. 실패했으면 새 API를 시작하지 않는다. Compose는 API와 realtime 시작 전에 migrate 성공을 기다리도록 구성돼 있다.
4. API·realtime·backup을 포함한 전체 구성을 올리고 이미지 커밋을 대조한다. DB 스키마만 적용하거나 API 이미지만 바꾸는 것으로 마무리하지 않는다.
5. 승인된 검증 계정/임시 여행으로 구형 검색, 새 범위 검색, 후보 ID 왕복, 같은 clientKey 재전송, 날짜 이동·삭제, VIEWER 거절, preview 409와 저장되지 않음, 다른 클라이언트 재조회를 확인한다. `/health`나 비인증 401은 로그인·쓰기 성공 검증을 대신하지 않는다. 모의 테스트 통과를 실제 NAS 경로 검증으로 표시하지 않는다.
6. API 호환 확인 뒤 웹 변경을 내보내고 마지막으로 새 iOS/TestFlight 빌드를 배포한다. 신규 `places/details`와 `plan-preview`는 NAS의 Next Route Handler이며 Vercel 정적 웹 배포만으로 생기지 않는다.

앱만 먼저 배포하면 구형 NAS는 검색어 없는 검색/새 preview 경로를 지원하지 않고, 후보 요청에서 provider/clientKey를 버릴 수 있다. 0010 컬럼만 남아 있어도 구형 API가 새 요청을 안전하게 처리하게 되는 것은 아니다.

되돌릴 때 새 nullable 컬럼·인덱스와 저장된 후보 식별자는 유지한다. **새 iOS가 이미 배포됐다면 해당 앱이 계속 실행될 수 있으므로 새 요청을 지원하는 API를 유지하면서 호환 수정하거나, 기능 접근을 확실히 중단한 뒤 검증한 API로 전환한다.** 이 변경에는 구형 API로 자동 우회하는 기능이 없다. 예전 서버는 외화 비용 소수를 반올림할 수 있으므로 새로운 비용 문서를 기존 서버에 다시 쓰는 경로도 확인해야 한다. 앱 이전 빌드를 제공했다고 모든 설치 앱이 되돌아갔다고 가정하지 않는다. 단순 git revert로 DB를 지우거나 Supabase로 주소만 바꾸지 않는다.

## 일정 변경 미리보기

`POST /api/v1/trips/:id/plan-preview`는 `{document: <편집한 여행 원문>, dayIndex: 0, revision: <읽은 서버 버전>}`을 받고 `{before: DayPlanResponse, after: DayPlanResponse}`를 반환한다. 선택한 하루의 도착 시각·이동·종료·비용은 기존 `buildDayPlanView`로 계산한다. 원래 문서와 초안을 저장하지 않으며, 반영은 사용자가 확인한 뒤 기존 여행 PUT의 revision CAS로 한다. 미리보기가 성공해도 이후 저장 충돌이 면제되지 않는다.

인증이 없으면 401, 접근할 수 없거나 삭제된 여행은 404, VIEWER는 403이다. 버전이 바뀌었으면 `REVISION_CONFLICT` 409와 현재 `revision`을 반환한다. revision/dayIndex는 0 이상의 안전한 정수이며 두 문서 모두에 선택일이 있어야 한다. 초안은 공통 `validateTripPayload`/`normalizeTrip` 검증을 통과하고 문서 안의 id·role로 다른 여행이나 권한을 선택할 수 없다. JSON 파싱 전에 스트림을 2 MiB + 1 KiB로 제한하고, 여행 문서 자체는 기존 2 MiB 제한을 따른다.

캐시를 읽을 때 `waitMs=0`을 사용하고 외부 경로 조회·캐시 채우기를 시작하지 않는다. 미조회 구간은 기존 `STRAIGHT_LINE_ESTIMATE`로 표시하고 `legsPending=0`을 반환한다. 초안을 반복 조회하도록 유도하지 않는다. 체류 미정은 `stayMinutes:null`, 사용자가 입력한 0분은 `0`으로 구분하며 둘 다 계산상 머무는 시간은 0분이다.

`DayPlanSpot.bookingLateMinutes`는 기존 웹의 예약 지연 경고가 켜졌을 때만 정수 분을 전달한다. 기존 경고 기준은 도착 예상이 예약보다 5분 넘게 늦는 경우이며, 표시 값은 분으로 반올림한다. 예약이 없거나 경고 대상이 아니면 null이다. `conflict`는 기존 고정 도착(`at`) 충돌 의미를 유지한다. 예약 요건/개인 예약 완료 정보인 `spot.admission`과 예약 시각 `bookAt`은 서로 다른 필드다.

금액은 서버 `number`와 iOS `Double`로 전달하며 시간·개수는 기존 정수 계약을 유지한다. 합계, 항목별 금액, 원화 환산과 예산 차액 모두 같은 숫자 형식을 사용한다. 유효한 개별 입력도 인원·항목 수·환율을 곱하면 Int64 범위를 넘을 수 있어 합계를 자르거나 낮은 임의 상한으로 바꾸지 않는다. `swiftParity`가 생성한 `day-cost-extreme.json`과 iOS `DayCostTests`가 이 경계를 검증한다. 기존 배포 앱의 `Int` 계약은 해당 극단 금액을 읽지 못할 수 있으며 새 API만으로 고쳐지지 않는다. 또한 JS `number`와 `Double`은 2^53을 넘는 정수의 1원 단위 정밀도를 보장하지 않는다. 이번 수정은 디코딩 실패를 막으며 임의 정밀도 정산을 추가하지 않는다.
