# 시스템 구성 개선 검토 — 2026-09-08

기준 커밋은 `9c7599acff6346489d5bc4f75ee9d2ba06dcb247`이다. 공통 엔진·단일 API를 유지하고 배포·복구 도구와 현재 구조 문서를 보완했다. 운영은 읽기 전용으로 상태를 확인했으며 데이터 변경·서비스 이전·배포·merge는 수행하지 않았다. 사용자가 Next를 최종 웹으로 선택했으므로 단계적 전환을 진행한다.

## 이관 분기의 실제 의미

| 설정·영역 | LEGACY | DUAL_READ | NEW_BACKEND / 실제 결정 조건 |
|---|---|---|---|
| TRIP | Supabase Repository·RPC | 두 목록 합침, 같은 clientId는 새 DB 우선; 상세는 새 DB → 레거시; 기존 행 쓰기는 읽은 저장소, 생성은 새 DB | PostgreSQL Repository·서비스 권한·CAS |
| COLLAB | Supabase RPC | 새 DB와 동일. 별도 합치기 없음 | PostgreSQL `CollabService` |
| ADAPTIVE | 레거시 Gateway | 거절·알림 키 합집합, 기록은 새 항목 우선 병합; 쓰기는 새 DB | PostgreSQL feedback·notification·device·memory 저장소 |
| PRICING | 레거시 Gateway | 관측 목록을 합쳐 정렬, 쓰기는 새 DB | PostgreSQL 가격 관측 저장소 |
| AUTH | 이름은 등록돼 있으나 해당 플래그로 인증 분기하지 않음 | 동일 | `DATABASE_URL` + 유효한 `AUTH_SECRET`이 자체 Auth를 활성화; 레거시 검증기와 함께 조립 |
| REALTIME | 이름은 등록돼 있으나 해당 플래그로 제공자 선택하지 않음 | 동일 | `/me`가 COLLAB=LEGACY면 Supabase, 아니면 `REALTIME_URL` 유무로 TRIPCANVAS/NONE 선택 |
| BOOKING | 별도 분기 소비처 없음 | 동일 | 예약은 여행 문서에 포함되므로 TRIP 경로를 따름 |
| STORAGE | 별도 분기 소비처 없음 | 동일 | 원본 사진 저장 미구현; 식별자 기반 기록과 혼동하지 않음 |

근거: `next/src/server/config/migrationRegistry.ts`, `next/src/app/api/v1/route-deps.ts`, `next/src/server/repositories/dualRead.ts`, `next/src/server/api/composeGateway.ts`, `next/src/server/api/meRoutes.ts`, `next/src/server/auth/instance.ts`.

설정이 없거나 모르는 값이면 LEGACY, DB URL이 없어도 LEGACY로 떨어진다. 잘못된 값은 경고하지만, 값 누락은 현재 기본 동작이다. 운영 설정을 확인하기 전 기본값을 바꾸거나 경로를 삭제하면 다른 배포를 깨뜨릴 수 있어 이번에 유지했다. `getEnv()`는 프로세스 캐시를 사용하므로 설정 변경에는 프로세스 재시작이 필요하다.

### 제거 조건

| 대상 | 제거 전에 필요한 근거 | 현재 판단 |
|---|---|---|
| Trip dual read·Supabase Repository | 운영 읽기·쓰기 위치 확인, 전수 이관 대조, 구형 클라이언트 사용 종료, 데이터 복구 계획 | 미확인 → 유지 |
| 레거시 인증 검증기 | API·실시간 양쪽의 토큰 사용 확인, 사용자 재인증 전환, 자체 인증 장애 복구 | 미확인 → 유지 |
| Adaptive·Pricing 레거시 Gateway | 누락된 이력 이관 확인, 신규 저장소 사용 확인, 중복 제안·가격 관측 검증 | 미확인 → 유지 |
| 선언만 남은 플래그 | 배포 환경·스크립트·문서 소비처 확인, 대체 설정 안내 | 동작 없음만으로 즉시 삭제하지 않음 |
| Next 웹 Supabase 직접 경로 | 최종 웹 결정, 자체 인증·API 동기화·버전 이력·가격 경로 이관 및 검증 | 웹 결정 후 수행 |

관찰 기간은 임의로 고정하지 않았다. 활성 클라이언트·사용 주기와 복귀 요구를 확인한 뒤 종료 날짜와 책임자를 정한다. “새 코드가 있다”와 “옛 코드가 더는 사용되지 않는다”는 별개의 증거다.

## 웹 구현 비교

| 기능 | 정적 웹 | Next 웹 | 전환에 필요한 검증 |
|---|---|---|---|
| 지도·검색·경로 | `app.js`, `routing.js` | `features/map`, `search`, `routing` | 실키 국내·해외 검색, POI, 경로 실패·폴백, 외부 키 제한 |
| 일정·드래그·재생 | 기존 DOM 배선 | `features/itinerary`, `playback` | 출발점·연박·수단·예약시각·드래그·재생 시나리오 |
| 예약·가격 | `price.js` + API 관측 | `features/booking`, `pricing` | 관측 저장소 일치, 미연결 표기, 확정/잠재 절약 구분 |
| 인증·동기화·이력 | `auth.js`·`api.js` → NAS API | `features/cloud` → Supabase 직접 | 자체 인증, 두 기기 충돌·삭제·권한·이력 필드 보존 |
| 협업 | API 멤버·초대·후보·실시간 | 동등한 전용 기능 디렉터리 미확인 | 전체 사용자 흐름·VIEWER 차단·실시간 재조회 |
| 가져오기·공유·붙여넣기 | 기존 정규화와 미리보기 | `features/share`, `paste`, `export` | 외부 입력 확인 전 미저장, URL·XSS·알 수 없는 필드 보존 |
| 실행 취소·설정 | 기존 저장·상태 전이 | `features/trip/hooks/useUndo.ts`, `features/settings` | 동기화 중 undo·삭제 복원·새로고침 |
| PWA·오프라인 | `sw.js`의 셸 캐시와 로컬 편집 | 별도 동등한 셸 캐시 미확인 | 설치·업데이트·오프라인 재시작·온라인 복귀 |

파일 존재와 순수 테스트는 기능 동등성 완료가 아니다. 현재 `e2e/`는 정적 웹을 검증하므로 Next 화면의 브라우저 검증으로 읽지 않는다.

### 추천과 선택지

- **당분간 정적 PWA 유지:** 현재 NAS 경로와 PWA를 보존하면서 중복 기능 추가를 멈춘다. 큰 `app.js`의 유지보수 부담은 남는다. 운영 안정화가 우선일 때 추천한다.
- **Next를 최종 웹으로 선택:** 현재 컴포넌트 구조를 활용하되, 인증·저장 API 전환과 협업·PWA 동등성을 먼저 확보한다. 즉시 교체 가능한 상태는 아니다.

Next를 선택하면 ① 자체 인증·API 동기화·가격·이력 → ② 지도·일정·협업 시나리오 → ③ PWA·오프라인·업데이트 → ④ Preview에서 두 기기·실키 검증 → ⑤ 기존 웹 복귀 경로를 유지한 전환 → ⑥ 관찰 후 정적 UI 제거 순서다. 루트의 공통 순수 엔진은 UI 제거 대상이 아니다. 관찰 중에는 새 문서를 기존 웹도 읽을 수 있게 유지한다.

사용자 결정: Next를 최종 웹으로 선택했다. 인증·API 동기화부터 단계적으로 전환하고, 동등성 검증 전까지 기존 PWA를 운영한다. 호스팅 이전과 웹 프레임워크 선택은 독립된 결정이다.

## 공통 엔진·데이터 모델

`TripService`의 정규화·권한 검사, PostgreSQL CAS·tombstone, `swiftParity.test.ts`의 응답 필드 검사, Swift JSONValue 편집·디코딩 테스트를 기존 게이트로 검증한다. 새로운 도메인 엔진·CRDT·장소 단위 저장 API를 추가하지 않았다.

검토에서 확인한 입력 차이는 [구성 문서의 비교표](architecture.md#같은-엔진-다른-입력)에 있다. 기기 시간대와 여행 시간대 중 어느 것을 우선할지, 기기별 거절을 계정 전체로 공유할지는 동작 정책 결정이 필요하다. 현재 차이를 공통 엔진의 결함이라고 단정하지 않았다.

## 이번 변경과 검증 범위

- 현재 구조·이관 이력을 구분하고 AGENTS의 API-only 배포 안내, 서버 캐시·실시간·인가 설명을 수정했다.
- 커밋 차이에 따른 배포 대상 확인 도구와 NAS 이미지 커밋 라벨을 추가했다.
- Docker 컨텍스트에서 비밀·백업·로컬 생성물을 제외했다. Docker 데몬이 없는 환경이므로 실제 이미지 빌드·Compose 기동은 미검증이다.
- 백업 파일 최신성 healthcheck와 실제 백업 스크립트를 사용하는 합성 복구 리허설을 추가했다. 외부 알림·복제 연결은 운영 설정 확인이 필요하다.
- 게이트의 SKIP 성공 오표시, 잘못된 범위 성공, RLS 파이프라인 실패 유실을 수정했다. PostgreSQL 실행 중 재사용과 TAP 출력 고정으로 재실행을 지원한다.
- 합성 PostgreSQL 17 복구: 성공. 백업 약 60KB, dump·restore·migration·전체 내용/시퀀스 비교 약 1초. 운영 규모 RTO가 아니다.

운영 도구·문서 단계의 `npm run verify:all` 최종 실행은 19개 단계 PASS(종료 0)다. 실제 PostgreSQL RLS, Playwright, Next lint·타입·테스트·build·tools:build, iOS XCTest 244개·Release 빌드를 포함한다. 실키가 필요한 개별 테스트의 미실행은 별도 제한으로 남긴다. 운영 API·실기기·실키·Docker 검증을 통과한 것으로 간주하지 않는다.

## 다음 실행 순서

1. 이번 도구·문서 변경을 검토하고 필수 CI 결과를 확인한다. 배포·merge에는 별도 승인이 필요하다.
2. 운영 담당자가 이미지 버전·스키마·실제 플래그·최신 백업·외부 복제와 감시 알림을 확인한다.
3. 허용 데이터 손실과 복구 시간 목표를 정하고, 승인된 운영 덤프로 격리된 staging 복구를 검증한다.
4. 최종 웹 방향을 선택하고 위 전환 기준에 따라 구현한다.
5. 확인된 종료 조건을 만족하는 레거시 분기부터 제거한다.

## 운영 읽기 전용 확인 기록

2026-09-08 SSH 읽기 전용 확인: API 약 5시간, realtime 약 41시간 기동 상태였으며 둘 다 healthy였다. PostgreSQL도 healthy, backup은 Up이었다. 이미지 커밋 라벨은 두 이미지 모두 없어 커밋 일치를 확인할 수 없었다. 기동 시간이 다른 것만으로 코드 불일치를 단정하지 않는다.

- TRIP·COLLAB·ADAPTIVE·PRICING은 NEW_BACKEND였다. REALTIME_URL은 설정되어 있고 AUTH_SECRET은 최소 길이 조건을 만족했다. 값 자체는 출력하지 않았다.
- DB 마이그레이션은 10개, 마지막 created_at=1788712807375로 로컬 0009_leg_cache journal과 일치했다. 각 migration 내용의 해시 전수 대조는 수행하지 않았다.
- backup 컨테이너에서 최근 26시간 덤프 파일 1개를 확인했다. 내용·오프사이트 복제·운영 덤프 복원은 미확인이다.
- Docker 로컬 데몬 부재 때문에 새 이미지 빌드는 하지 않았다. NAS에서 새 이미지 빌드·배포도 실행하지 않았다.
