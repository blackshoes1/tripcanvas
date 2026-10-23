# With J 이야기 — 장소별 음성 해설

작성 2026-10-22. 상태: **설계 승인(2026-10-22) · 웹 1단계 구현 중**. 아래 '구현 메모'가 설계와 다른 점을 적는다.

## 무엇을 만드는가

With J가 미리 준비한 장소 해설을 일정의 장소에 **저절로** 붙인다. 사용자는 파일을 고르지 않는다.
세비야 대성당이 일정에 있으면 그 장소에 '🎧 With J 이야기'가 뜨고, 누르면 듣는다.

기존 '내 음성 파일 붙이기'(기기 전용·공유 업로드)와는 다른 기능이다. 그쪽은 사용자가 만든 파일이고,
이쪽은 With J가 쓰고 검수해 내보내는 콘텐츠다. 화면에서는 한 묶음(음성 가이드) 안에 두 칸으로 보인다:
위는 **With J 이야기**, 아래는 **내가 붙인 음성**.

첫 출시 콘텐츠(세비야 파일럿):

| 항목 | 종류 | 분량 |
|---|---|---|
| 세비야 | 도시 소개 | 2~3분 1편 |
| 스페인 광장 (Plaza de España, 세비야) | 장소 | 핵심 1~2분 + 더 듣기 |
| 레알 알카사르 (Real Alcázar, 세비야) | 장소 | 핵심 1~2분 + 더 듣기 |
| 세비야 대성당·히랄다 | 장소 + 관람 지점 | 기존 14곳 원고(01~12 기본, 13~14 선택) |

목소리: Google Cloud TTS Chirp 3 HD **Despina**, 쉼 추가 버전, 보통 속도(사용자 선택).

## 원칙

- **이름만으로 붙이지 않는다.** '스페인 광장'은 마드리드에도 있고, '알카사르'는 세고비아·코르도바·톨레도에도 있다.
  매칭은 Google placeId가 같거나, **좌표가 반경 안이면서** 이름이 맞을 때만 한다(아래 규칙).
- **자동 재생·위치 추적은 하지 않는다.** 기존 음성 가이드와 같다. 사람이 누를 때만 재생한다.
- **AI 음성이라고 밝힌다.** 플레이어 아래에 'AI 음성으로 읽었어요 · 출처 N건'을 표시한다. 출처 목록은 펼쳐서 본다.
- **사실 확인을 거친 원고만 내보낸다.** 원고마다 출처 ID를 달고, 검수 표시(`reviewedAt`)가 없는 트랙은 카탈로그에 넣지 않는다.
- **여행 문서에 넣지 않는다.** 카탈로그는 앱이 들고 있는 별도 콘텐츠다. 동기화·공유 링크·내보내기·실행취소와 상관이 없다.

## 콘텐츠를 어디에 두는가 — 정적 파일(Vercel)

```
stories/catalog.json            ← 장소·트랙 목록 (작다, 매번 새로 받는다)
stories/seville/city.mp3
stories/seville/plaza-espana-core.mp3 · plaza-espana-more.mp3
stories/seville/alcazar-core.mp3 · alcazar-more.mp3
stories/seville/cathedral-01.mp3 … cathedral-14.mp3
```

- 웹과 같은 출처(`tripcanvas-ai.vercel.app/stories/…`)에서 정적 파일로 내보낸다.
  **API·DB를 건드리지 않으므로 NAS 배포 순서(API 먼저)가 필요 없고, NAS가 꺼져도 들을 수 있다.**
- 음성은 64kbps 모노 MP3로 만든다. 3분짜리가 약 1.4MB, 파일럿 전체는 약 25MB로 예상한다.
- 서비스 워커의 앱 셸 사전 캐시에는 넣지 않는다(설치할 때마다 25MB를 받게 된다).
  **듣거나 '오프라인 저장'을 누르면** 별도 캐시(`withj-stories-v1`)에 담는다. 비행기 모드에서도 재생된다.
- iOS는 같은 주소에서 카탈로그와 MP3를 받아 Application Support에 담는다.

### catalog.json 모양

```json
{
  "version": 1,
  "updated": "2026-10-2x",
  "voice": { "engine": "Google Cloud TTS Chirp 3 HD", "name": "Despina", "disclosure": "AI 음성으로 읽었어요" },
  "places": [
    {
      "id": "seville-alcazar",
      "kind": "PLACE",
      "name": "레알 알카사르", "localName": "Real Alcázar de Sevilla", "city": "세비야",
      "placeIds": ["ChIJ…"],
      "lat": 37.3831, "lng": -5.9903, "radiusM": 300,
      "aliases": ["알카사르", "세비야 알카사르", "Alcázar"],
      "tracks": [
        { "id": "core", "role": "CORE", "title": "알카사르, 핵심만", "src": "seville/alcazar-core.mp3",
          "seconds": 104, "bytes": 0, "sha256": "…", "sources": ["S12", "S13"], "reviewedAt": "2026-10-2x" },
        { "id": "more", "role": "MORE", "title": "더 듣기 — …", "src": "…" }
      ]
    },
    { "id": "seville-city", "kind": "CITY", "name": "세비야", "lat": 37.3891, "lng": -5.9845, "radiusM": 8000, "tracks": [ … ] }
  ],
  "sources": { "S12": { "title": "…", "url": "https://…" } }
}
```

대성당은 `role:"STOP"` 트랙 14개이고, 각 트랙에 `stop`(번호·현장에서 찾는 단서·스페인어 이름)을 둔다.

## 장소 매칭 규칙 (`matchStories` — 순수 함수, 유닛 테스트 대상)

장소 하나(`spot`)에 대해:

1. `spot.placeId`가 어떤 PLACE의 `placeIds`에 있으면 그 장소다.
2. 없으면 `spot.lat/lng`가 PLACE의 `radiusM` 안이고, 이름이 `name`·`localName`·`aliases` 중 하나와 맞으면(`placeNameMatch`) 그 장소다.
3. 좌표가 없는 장소는 붙이지 않는다. **이름만 같은 것은 매칭하지 않는다.**

CITY는 장소가 아니라 **날**에 붙는다. 그날 위치 있는 장소 중 하나라도 반경 안이면 그 날 머리에 '🎧 세비야 이야기'가 하나 뜬다.

테스트에는 반드시 마드리드 스페인 광장(40.4233, -3.7122)과 세고비아 알카사르(40.9527, -4.1325)를 넣어 **붙지 않는 것**을 확인한다.

## 화면

**웹 (PWA)**

- 장소 행의 '♫ 음성 가이드'와 장소 정보의 '음성 가이드' 버튼: 이야기가 있는 장소면 이름이 '🎧 With J 이야기'가 된다.
- 음성 가이드 창 맨 위에 With J 이야기 칸을 둔다. 핵심 트랙이 먼저 나오고 '더 듣기'는 그 아래에 있다.
  대성당은 관람 지점 목록(번호·단서·스페인어 이름)을 보여 주고, 지점을 눌러 듣는다. 다녀온 지점은 기기에 표시만 해 둔다.
- 오프라인 저장: '이 장소 이야기 저장(약 N MB)'을 누르면 받는다. 저장되면 '✓ 오프라인에서도 들을 수 있어요'로 바뀐다.
- **지금** 화면: 지금 있거나 다음에 갈 장소에 이야기가 있으면 카드에 🎧 버튼을 둔다.
- 재생은 기존 공유 플레이어를 그대로 쓴다. 창을 닫아도 계속 듣고, 재생 위치를 기억한다.

**iOS**

- 장소 상세와 `지금`의 음성 가이드 화면(`AudioGuideView`) 위쪽에 같은 칸을 둔다. 카탈로그는 앱이 받아서 그리기만 하고,
  매칭 규칙은 `lib`의 픽스처(`story-match.json`)로 파리티를 검사한다(Swift 복사본).
- 배경 재생과 잠금 화면 명령은 이미 만든 `SharedGuidePlayer`를 쓴다.

## 콘텐츠 제작 과정 (저장소의 `scripts/stories/`)

```
원고(출처 ID 포함) → 사실 확인 → 듣기 좋게 다듬기 → 검수(reviewedAt) → TTS → 소리 크기 맞추기·MP3 → catalog.json(sha256·길이)
```

- TTS 키는 **저장소와 CI에 넣지 않는다.** 제작은 키가 있는 기기에서 사람이 돌린다. 이 클라우드 세션에는 Google Cloud 자격 증명이 없다.
  키를 환경 비밀값으로 넣어 주면 여기서도 만들 수 있다.
- 원고에서 메뉴 이름·출처 ID·파일 제목은 읽지 않는다. 발음 사전(`pronunciation-notes`)을 SSML로 적용한다.
- 무료 한도: 월 100만 자. 파일럿 전체는 약 3만 자로 예상한다.

## 출시 단계

1. **웹 PR** — 카탈로그·매칭(lib)·음성 가이드 창의 With J 칸·오프라인 캐시·지금 화면 버튼, 그리고 세비야 콘텐츠.
   서버 변경이 없으니 웹 PR 하나로 나간다. 게이트: `npm run verify:all`.
2. **iOS PR** — 같은 칸과 파리티 픽스처, TestFlight.
3. 현장 확인 — 실제 iPhone에서 비행기 모드 재생·잠금 화면·장시간 재생을 확인한다.

## 지금 작업 트리에 있는 미배포 기능과의 관계

이 브랜치에는 아직 커밋되지 않았던 **'내 음성 파일 붙이기'(기기 전용)**와 **공유 파일 업로드(`trip_files`, 마이그레이션 0019)**가 있다.

- 제안: With J 이야기는 **main에서 새로 갈라 독립 PR**로 만든다. 공유 업로드는 DB 마이그레이션이 있어 API 먼저 배포해야 하고,
  게이트 미통과 항목도 남아 있다(`docs/trip-files-verification.md`). 묶으면 이야기 기능까지 그 일정에 묶인다.
- 기기 전용 '내 음성' 칸은 이야기 창과 한 화면을 쓰므로, 이야기 PR에 함께 넣거나 이야기 칸만 먼저 낼지 정해야 한다.
- 이 브랜치의 대용량 작업 파일(`docs/seville-tripcanvas-handoff/` 안의 zip·wav·jpg 약 15MB, `proto/` 이미지)은 저장소에 커밋하지 않는 것을 제안한다.
  원고(txt·json)만 `scripts/stories/source/`로 옮긴다.

## 구현 메모 (웹 1단계)

- 코드: `stories.js`(순수 — 정규화·매칭) · `app.js`의 `openStory`·`loadStories`·`storyBlob` · `index.html`의 `#storyDialog`·`#storyBar` · `sw.js`.
- 플레이어는 브라우저 기본 `<audio controls>` 하나다. 창 안에 있다가 창을 닫으면 화면 아래 막대(`#storyBar`)로 옮겨 가 계속 들린다.
  재생 위치 기억은 같은 세션 안에서만이다(새 localStorage 키를 만들지 않았다).
- 음성은 누르면 통째로 받아 지문(sha256)을 확인하고 `withj-stories-v1` 캐시에 담은 뒤 Blob으로 재생한다.
  그래서 한 번 들은 이야기는 비행기 모드에서도 들린다. SW는 `/stories/`를 건드리지 않는다(Safari는 Range 요청에 통째 응답을 주면 재생하지 못한다).
- 대성당 '다녀온 지점 표시'는 첫 버전에서 뺐다. 지점 목록에는 번호·찾는 법·스페인어 이름이 있다.
- 카탈로그는 앱이 열릴 때 한 번 받는다(`no-cache` · Vercel 헤더 `max-age=0`). 못 받으면 지난번 사본을 쓴다.

## 제작 명령

```bash
node scripts/stories/build-stories.js --check   # 원고 검사(키 필요 없음 — 유닛 테스트도 같은 검사를 돈다)
GOOGLE_TTS_API_KEY=… node scripts/stories/build-stories.js --draft   # 검수 전 원고까지 stories-draft/에(올리지 않는다)
GOOGLE_TTS_API_KEY=… node scripts/stories/build-stories.js           # 검수한 원고만 stories/에 + catalog.json
```

원고는 `scripts/stories/source/seville/*.json`이다. 들어 보고 사실 확인 기록(`factCheck`)이 전부 `CONFIRMED`이거나, 확인하지 못한 사실마다
처리(`resolution` — 본문에서 뺐으면 `OMITTED`, 단정하지 않게 고쳤으면 `HEDGED`)가 적혀 있으면 그 장소에 `reviewedAt`을 적는다 — 검수 표시가 없는 트랙은 카탈로그에 들어가지 않는다. 같은 원고는 다시 합성하지 않는다(`build-state.json`).

## 하지 않는 것 (첫 버전)

- 도착하면 자동으로 재생하는 기능, 위치를 추적하는 기능
- 세비야 밖의 장소, 사용자가 해설을 요청하는 기능, 앱 안에서 음성을 만드는 기능
- 사진이 있는 현장 가이드(대성당 웹 가이드의 사진은 출처·권리를 정리한 뒤에 한다)
