# 점진적 모듈 구조

Trip Canvas는 빌드 단계 없이 classic script를 순서대로 로드한다. 의존성 방향은 아래와 같다.

1. `lib.js`: 데이터 정규화, 시간, 거리, 앵커, 타임라인 같은 순수 도메인 함수
2. `adaptive.js`: 판단 엔진(오늘·제안·재구성·출발 안내). DOM·네트워크·현재시각을 모르고 전부 인자로 받는다 — **웹과 iOS가 같은 답을 받는 단일 출처**이고 `/api/v1`이 그대로 import한다
3. `collab.js` · `intake.js` · `price.js`: 협업 판정 · 유입 파싱 · 가격 계산 (전부 순수)
4. `sync.js`: revision 병합과 삭제/undo 상태 전이
5. `routing.js`: Google/Kakao HTTP transport와 fallback; `lib.js` 함수와 `fetch`는 factory 인자로 주입
6. `api.js` · `auth.js`: TripCanvas API·인증 클라이언트. `{data,error}`를 돌려주고 예외를 던지지 않으며, 제공자별 실패를 **코드**로 옮겨 화면이 제공자를 모르게 한다
7. `app.js`: 위 모듈을 조합하고 DOM, 지도 SDK, localStorage를 담당

`routing.js`는 지도나 DOM 전역을 직접 읽지 않아 mock fetch로 단위 테스트할 수 있다. `sync.js`의 병합 함수도 네트워크 없이 테스트한다. 이 경계 덕분에 네트워크 실패와 UI 렌더링 실패를 서로 분리해 진단할 수 있다.

현재 `app.js`의 기존 호출부를 작게 유지하기 위해 factory 결과의 `fetchLeg`을 같은 이름의 lexical shim으로 노출한다. 다음 단계에서 `app.js` 자체를 ES module로 전환할 때 명시적 import로 바꾸고 이 shim을 제거한다. 지도 SDK·inline handler가 전역 함수에 의존하므로 한 번에 module 전환하지 않는다.
