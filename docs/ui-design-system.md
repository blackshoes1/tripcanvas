# Trip Canvas UI 디자인 시스템

## 원칙

- 지도는 작업 공간, 일정 패널은 편집 표면으로 분리한다.
- 기본 작업은 한 화면에서 짧게 끝내고 비용·예약·숙박 같은 상세 설정은 필요할 때만 펼친다.
- 상태는 색상만으로 전달하지 않는다. 활성 필터는 배경색과 굵기, 일정은 `Day N` 텍스트, 경고는 아이콘과 설명을 함께 사용한다.
- 모바일 터치 대상은 최소 44×44px, 키보드 포커스는 3px focus ring으로 표시한다.

## 토큰

CSS custom property는 `style.css`의 `:root`를 단일 기준으로 사용한다.

- Primary: `#e53935`, hover/dark: `#c62828`
- Gray 900 / 본문: `#111827`
- Gray 600 / 보조 텍스트: `#4b5563`
- Border: `#e5e7eb`
- Focus: `#2563eb`
- 도시·일자 색상은 primary action 색과 분리된 palette를 사용한다.
- 본문 14px, 일정/장소 핵심 정보 13.5~16px, caption 11~12px를 기준으로 한다.

## 핵심 컴포넌트

- Header: 여행명 dropdown trigger / 일정 붙여넣기 / 여행 모드 / 더보기.
- Filter bar: 전체, 오늘, D1…Dn과 `보기 설정` popover.
- Day card: 날짜·시간대·이동수단·장소를 보여주고 편집·이동·복사·삭제 같은 보조 작업은 `⋮` 메뉴로 감춘다.
- Place modal: 기본 정보와 접을 수 있는 상세 설정으로 나눈다.
- Mobile itinerary sheet: `collapsed` 15dvh, `half` 45dvh, `expanded` 88dvh.
- Travel mode: 현재 장소 → 다음 장소 → 전체 일정 순서로 정보를 배치한다.

와이어프레임은 정보 구조와 우선순위의 기준이다. 지도 SDK의 실제 컨트롤, 긴 다국어 장소명, 브라우저 safe area에 따라 픽셀 위치는 유동적으로 조정한다.
