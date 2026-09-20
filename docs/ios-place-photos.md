# iOS 장소 대표 사진

지도 탐색에서 선택한 장소 카드, 일정의 장소 정보, 장소 편집 화면에서 Google Place ID로 연결된 사진 한 장을 표시한다. 목록 전체의 사진은 미리 조회하지 않는다.

- 기존 번들 ID 제한 Google iOS 키와 Places API (New)를 사용한다. 장소 상세 `photos`만 요청한 뒤 첫 사진의 media를 조회한다. 검색 결과의 사진 URL이나 여행 저장 데이터에 사진 참조를 추가하지 않는다.
- 사진 media는 `skipHttpRedirect=true`로 조회하고, 실제 이미지 요청에는 API 키와 번들 헤더를 전달하지 않는다.
- 사진 작성자·프로필 링크와 Google Maps 원본 사진 링크를 같은 카드에 표시한다. 출처 링크가 없는 사진은 표시하지 않는다.
- 세션은 ephemeral, URLCache는 nil이며 디스크 저장을 하지 않는다. 선택 변경·화면 닫기 시 요청이 취소되고 이전 사진이 다음 장소에 표시되지 않는다.
- 카카오 장소와 연결 ID 없는 수동 장소는 Google 이름 검색으로 추측 연결하지 않는다. 카카오 장소에는 원문 지도 링크를 제공한다. 카카오 지도 위에는 Google 사진을 연결하지 않는다.
- 사진 없음, 로딩 실패와 재시도를 구분한다. 사진 실패는 일정 보기·저장과 독립적이다.

서버·DB 변경과 새로운 외부 계정 설정은 없다. 장소 상세 및 사진 호출은 기존 Google 프로젝트의 사용량에 포함된다.

공식 계약과 표시 조건:
- https://developers.google.com/maps/documentation/places/web-service/place-photos
- https://developers.google.com/maps/documentation/places/web-service/policies

검증: HTTP 대역으로 상세→media→이미지 로딩, 사진 출처/작성자 보존, 이미지 요청의 키 미전달, 사진 없음/실패/다른 장소 참조 차단, 취소, 카카오·미연결 분기를 검사한다. 실제 제공처 사진 및 기기 화면 확인은 대역 테스트와 구분한다.
