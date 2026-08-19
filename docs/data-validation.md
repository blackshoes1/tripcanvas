# 외부 데이터 검증과 schema migration

가져오기, 압축 공유 링크, localStorage, Supabase 여행/스냅샷, AI 파싱 결과는 모두 `lib.js`의 공통 검증기를 거친다. 검증은 일부 필드를 조용히 버리고 계속하는 방식이 아니라 위험하거나 과도한 payload 전체를 거부한다. 검증을 통과한 뒤에만 현재 schema로 migration하고 렌더링용 정규화를 수행한다.

## 현재 제한

- 여행 JSON 2MB, localStorage 전체 10MB, 공유 hash 12,000자
- 저장소 100개 여행, 여행당 90일, 하루 200곳, 여행 전체 5,000곳
- 문자열 10,000자, 객체 키 100자, 중첩 20단계, 비용 1조 이하
- 위도 -90~90, 경도 -180~180, 시각 `HH:MM`, 예약 링크 `http`/`https`
- `__proto__`, `prototype`, `constructor` 키는 prototype pollution 위험 때문에 거부

안전한 알 수 없는 필드는 앞으로의 schema와 왕복 호환성을 위해 보존한다. `schemaVersion`이 없는 기존 문서는 v0으로 보고 순차 migration한 뒤 현재 v2를 기록한다. 새 버전은 `migrateTrip()`에 이전 버전별 변환을 추가하고, 과거 fixture·알 수 없는 필드 보존·중복 실행 안전성을 단위 테스트해야 한다.

제한을 바꿀 때는 정상적인 대형 여행 fixture와 공격성 fixture를 함께 시험하고 공유 URL의 실제 브라우저/메신저 길이 제한도 확인한다. 현재 압축 해제 라이브러리는 출력 도중 중단 기능이 없으므로 입력 hash를 먼저 12,000자로 제한하고 해제 직후 2MB 상한을 다시 검사한다.
