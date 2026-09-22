// 공유 키(§57) — **같은 내용이면 앱과 서버가 같은 키를 만들어야 한다.** 다르면 같은 공유가
// 두 번 처리된다. 규칙은 `intake.js`의 `shareIdempotencyKey` 하나이고 iOS의
// `SharedTravelInput.makeId`가 복사본이다.
//
// ⚠️ 2026-09-21 전에는 이 파리티가 **Swift 소스에서 문자열을 grep**하는 것이었다
// (`hash = ((hash &* 33) ^ UInt32(unit))`가 있는가). 알고리즘이 그 자리에 적혀 있는지만 봤지
// **같은 입력에 같은 키가 나오는지는 보지 않았다.** 그래서 실제로 갈라져 있던 것을 못 잡았다:
//
//   - 본문을 Swift는 `prefix(500)`(**문자** = grapheme 묶음)로, JS는 `slice(0,500)`(**UTF-16
//     코드 단위**)로 잘랐다 → 이모지가 섞인 500자 넘는 글에서 키가 달라졌다. 붙여넣는 일정 글에
//     이모지는 흔하다(§`stripDecor`).
//   - 앞뒤 공백을 Swift는 `.whitespacesAndNewlines`로 벗겨 U+FEFF(BOM)를 남기고 U+0085(NEL)를
//     벗겼다 → JS와 반대다.
//
// 지금은 여기서 실제 키를 만들어 fixture로 떨어뜨리고 Swift 테스트가 같은 파일을 읽어 맞춘다.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import intake from '@legacy/intake.js';

const FIXTURE = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures/share-key.json');

/** UTF-16 코드 단위를 그대로 쓰는 경우와 **문자**로 세는 경우가 갈리는 글(앞뒤 공백은 없다). */
const EMOJI_LONG = '🌍 마드리드 → 세비야 · '.repeat(40).trim();
/** 정확히 500번째 코드 단위가 서로게이트 쌍의 앞쪽이 되게 만든 글 — 자르면 반쪽만 남는다. */
const SURROGATE_CUT = `${'a'.repeat(499)}😀 뒤에 더 있는 글`;

const cases: { name: string; url: string | null; title: string | null; text: string | null }[] = [
  { name: '평범한 예약 공유', url: 'https://www.booking.com/hotel/es/cap-rocat.html', title: 'Cap Rocat | Booking.com', text: '예약 번호: ABC12345' },
  { name: '아무것도 없는 공유', url: null, title: null, text: null },
  { name: '주소만', url: 'https://example.test/a', title: null, text: null },
  { name: '앞뒤 공백과 줄바꿈은 벗긴다', url: '  https://example.test/a\n', title: '\t제목 ', text: '\r\n본문\n\n' },
  { name: 'BOM으로 시작하는 제목 — JS는 벗긴다', url: null, title: '\uFEFF Cap Rocat', text: 'x' },
  { name: 'NEL(U+0085)은 JS가 벗기지 않는다', url: null, title: '제목\u0085', text: 'x' },
  { name: '줄 구분자(U+2028)는 벗긴다', url: null, title: '\u2028제목\u2029', text: 'x' },
  { name: '이모지가 섞인 500자 넘는 글 — UTF-16 단위로 자른다', url: null, title: null, text: EMOJI_LONG },
  { name: '자르는 자리가 서로게이트 쌍 가운데', url: null, title: null, text: SURROGATE_CUT },
  { name: '한글만', url: null, title: '세비야 대성당', text: '입장 09:00' },
  { name: '구분자(|)가 내용에 들어 있어도 자리가 밀리지 않는다', url: 'a|b', title: 'c|d', text: 'e|f' }
];

describe('공유 키 파리티 — 같은 내용이면 같은 키', () => {
  it('실제 키를 fixture로 남긴다', () => {
    const rows = cases.map((c) => ({
      name: c.name,
      url: c.url,
      title: c.title,
      text: c.text,
      key: intake.shareIdempotencyKey({ url: c.url ?? undefined, title: c.title ?? undefined, text: c.text ?? undefined })
    }));

    // 키는 언제나 이 모양이다 — 앱이 이걸 파일 이름·딕셔너리 키로 쓴다
    rows.forEach((r) => expect(r.key, r.name).toMatch(/^sh[0-9a-z]+$/));

    // 내용이 같으면 키가 같고, 다르면 다르다(적어도 이 표본에서는 — 해시라 보장은 아니지만
    // 같은 키가 나오면 표본을 잘못 고른 것이다)
    expect(new Set(rows.map((r) => r.key)).size, '표본끼리 키가 겹치면 대조가 의미를 잃는다').toBe(rows.length);

    // 자르기가 **UTF-16 코드 단위**라는 것을 값으로 못박는다. 문자(grapheme)로 자르면
    // 이모지가 섞인 글에서 500단위 뒤의 내용까지 남아 키가 달라진다.
    expect(EMOJI_LONG.length, '표본이 500 코드 단위보다 길어야 자르기를 본다').toBeGreaterThan(500);
    expect(intake.shareIdempotencyKey({ text: EMOJI_LONG }),
           '500 코드 단위 뒤에 무엇을 붙여도 키는 그대로다')
      .toBe(intake.shareIdempotencyKey({ text: `${EMOJI_LONG} 이 꼬리는 키에 들어가지 않는다` }));

    mkdirSync(path.dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify({ cases: rows }, null, 2)}\n`);
  });
});
