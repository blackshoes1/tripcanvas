# 명소 예약 정보와 참고 입장료

## 구현 상태

인증된 `GET /api/v1/places/details?provider=kakao|google&id=<원본 ID>`를 추가했다. 한 번에 한 장소만 받으며, 제공자와 ID가 맞지 않거나 ID를 여러 개 보내면 400, 인증이 없으면 401이다. 응답은 다음 의미를 가진다.

```json
{
  "schemaVersion": 1,
  "provider": "kakao",
  "providerId": "12345678",
  "status": "NOT_CONNECTED",
  "requirement": "UNKNOWN",
  "quote": null,
  "sourceURL": null,
  "checkedAt": null,
  "stale": false
}
```

위 ID는 합성 예시이며 `schemaVersion` 실제 값은 공통 API 계약을 따른다. 현재 자동 예약 요건·입장료 제공처는 **미연결**이다. 이 응답은 명소의 가격을 조회했다거나 예약이 불필요하다는 뜻이 아니다. `stale`은 현재 보유한 참고 데이터의 오래됨 여부이며, 미연결에서 false여도 최신 정보를 확보했다는 뜻은 아니다. 실제 출처/가격을 조회하지 않았으므로 확인 시각을 만들지 않는다. 검색 API 키가 설정돼 있어도 입장료 연결로 간주하지 않는다.

공통 타입은 `next/src/features/trip/domain/admission.ts`에 있다. 향후 실제 공급처가 연결되면 참고 가격은 금액/범위, 통화, 1인/총액/미상, 연령·권종·유효 날짜·포함 조건·출처·확인 시각을 전달해야 한다. 지금은 이 필드를 채우는 대역 제공처를 운영 기능에 넣지 않았다. `AVAILABLE`, `NO_DATA`, `ERROR` 상태는 계약에 예약돼 있으나 실제 제공처 경로는 아직 없다.

## 사용자가 직접 확인한 정보

`spot.admission`은 `{source:'USER', requirement, personalStatus?, officialURL?, checkedAt?, note?, people?}`다.

- `requirement`: `REQUIRED`, `RECOMMENDED`, `NOT_REQUIRED`, `UNKNOWN`.
- `personalStatus`: `NOT_BOOKED`, `BOOKED`. 생략은 예약 전이다. 예약 시각 `bookAt`이나 숙박 연결 `bookingId`에서 완료 상태를 추론하지 않는다.
- `officialURL`: 사용자가 확인해 입력한 https 링크. 링크를 입력/열었다고 실제 공식 운영자임을 검증했다거나 예약이 끝났다고 간주하지 않는다.
- `checkedAt`: 사용자가 명시적으로 확인한 ISO 시각. 서버는 저장 시각을 자동 입력하지 않는다.
- `note`: 1000자 이하. `people`: 정수 1~100.

서버 문서 저장은 이 구조를 검증하고, 웹/iOS 왕복 정규화에서도 보존한다. 외부 응답을 이 사용자 입력 영역으로 자동 저장하지 않는다. 참고 가격은 여행 비용과 별개이며 사용자가 금액·통화·인원을 확인한 별도 비용 편집에서만 반영한다. 범위의 중간값을 확정 금액으로 선택하거나 정보 없음을 0원으로 처리하지 않는다.

## 실제 데이터 확인 결과 — 2026-09-16

로컬 환경과 NAS `deploy/.env`의 **변수 이름만** 확인했다. NAS에는 `GOOGLE_ROUTES_API_KEY`, `KAKAO_REST_API_KEY`가 있고 명소 티켓 제공처의 설정은 없었다. 키 값은 출력하거나 복사하지 않았다. 기존 서버 Google 키는 프로젝트 문서상 Routes API 전용이므로 Places나 티켓 조회에 재사용하지 않았다.

| 제공처 | 확인한 범위 | 현재 적용 판단 |
|---|---|---|
| 카카오 로컬 | 장소 이름·좌표·주소·장소 ID·상세 페이지 링크를 제공하지만 기본 검색 응답에는 입장료·예약 필수 규정이 없다. | 지도 식별에 사용. 명소 규정이나 티켓 가격으로 확장 추정하지 않는다. |
| Google Places | `reservable`은 예약 지원 여부이며 `priceRange`는 장소의 일반 가격 범위다. | 특정 날짜·권종의 입장료 또는 예약 필수 근거로 사용하지 않는다. |
| Viator Partner API | 단일 상품의 가격 일정·성인/어린이 구분·권종/인원 조건을 조회하는 경로가 있다. Basic 계정과 더 높은 접근 등급의 지원 범위가 다르다. | 별도 파트너 자격증명과 정확한 장소→상품 매칭이 필요하다. 현재 계정/키/상품 매핑이 없어 연동하지 않았다. |

근거: [카카오 로컬 REST 문서](https://developers.kakao.com/docs/ko/local/dev-guide), [Google Place 필드 정의](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places), [Viator 접근 등급](https://partnerresources.viator.com/travel-commerce/levels-of-access/), [Viator 가격 조건](https://partnerresources.viator.com/travel-commerce/pricing/).

Google 장소 데이터는 저장·표시·출처 조건을 따라야 하며, Place ID 저장 허용을 가격/세부 콘텐츠 전체의 무기한 보존 허용으로 해석하지 않는다. [Google Places 정책](https://developers.google.com/maps/documentation/places/web-service/policies)

Viator의 단일 상품 일정 조회는 선택한 상품을 필요할 때 요청하는 방식이며, 기술 가이드는 해당 응답 캐시를 최대 1시간으로 설명한다. 실시간 가격 확인은 날짜와 인원 구성 등 실제 입력과 해당 접근 권한이 필요하다. Google/Kakao 장소 ID를 Viator 상품 코드로 가정할 수 없다. [Viator 기술 가이드](https://partnerresources.viator.com/travel-commerce/technical-guide/)

## 연결을 완료하려면

1. 사용할 제공처와 해당 파트너 계정의 실제 API 권한·상업 조건을 확인한다. 별도 계정 가입이나 유료 계약은 이 변경에서 수행하지 않았다.
2. 명소 자체와 티켓 상품을 구분해 정확한 상품 코드를 매칭하고 사용자가 권종·날짜·인원 조건을 선택하게 한다. 비슷한 이름의 투어 최저가를 명소 입장료로 표시하지 않는다.
3. 허용된 최소 단일 상품 조회를 연결하고, 무료/미상·범위/확정·일반가/선택 날짜 가격을 나눠 표시한다. 공급처 규정과 캐시·출처 조건을 적용한다.
4. 실제 제공처를 통한 성공·무결과·권한 실패 검증을 별도로 남긴다. 지금 통과한 모의 API/정규화 테스트를 실제 가격 연동 완료로 보고하지 않는다.

기존의 공식 페이지 확인과 직접 입력은 자동 조회 연결 전에도 사용할 수 있다. 새 DB 테이블이나 명소 가격 대량 수집은 추가하지 않았다.
