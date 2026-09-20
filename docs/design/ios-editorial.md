# iOS 매거진 디자인

승인된 시안의 종이색·잉크·올리브 색을 공통 팔레트에 적용한다. 나의 여행은 사진을 중심으로, 하루 일정은 사진 없이 시간·장소·이동 순서가 읽히는 목록으로 구성한다.

- 여행 목록: 대표 사진, 명조 제목, 날짜·도시, 기존 여행 열기·삭제/나가기 동작 유지.
- 하루 일정: 밑줄 날짜 탭, 명조 하루 제목, 올리브 타임라인, 얇은 이동 구분선, 장소 추가 버튼. 기존 스와이프 판정·탭 취소·재정렬·보기 권한을 그대로 유지한다.
- 사진은 첫 번째 유효한 도시의 한국어 Wikipedia 항목에서 찾는다. 좌표가 없거나 동음이의어인 항목은 쓰지 않는다. Wikimedia Commons의 저작자·공개 라이선스가 확인된 JPEG/PNG/WebP만 사용하고 출처 링크를 표시한다. 미조회·실패 때는 도시명이 있는 표지를 표시한다. 여행 이름·일정·로그인 토큰은 외부 사진 서비스에 보내지 않는다.
- 나눔명조 Regular는 앱에 번들로 포함하며 Dynamic Type에 따라 커진다. 본문·시간·버튼은 시스템 글꼴을 유지한다. 다크 모드도 지원한다.

서체 원본: https://github.com/google/fonts/tree/main/ofl/nanummyeongjo
라이선스: 앱 번들의 NanumMyeongjo-OFL.txt (SIL OFL 1.1).
사진 API: https://www.mediawiki.org/wiki/Extension:PageImages 및 https://www.mediawiki.org/wiki/Extension:CommonsMetadata

서버·DB·배포 설정은 이 디자인 변경에 포함하지 않는다. 사용자 표지 사진의 저장 범위는 별도 선택을 반영한다.
