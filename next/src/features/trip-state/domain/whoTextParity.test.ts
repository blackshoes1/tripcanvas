// `collab.js`의 참여자 이름표 규칙을 픽스처로 굳혀 iOS 복사본(`CollabModel`)과 맞춘다.
//
// ⚠️ 규칙을 바꾸려면 `collab.js`를 먼저 고친다. 그러면 이 테스트가 픽스처를 새로 쓰고
// iOS 테스트가 깨진다 — 그게 목적이다(복사본은 조용히 갈라진다).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import collab from '@legacy/collab.js';

const members = [
  { user_id: 'u1', display_name: '지민', me: false },
  { user_id: 'me', display_name: '나야', me: true },
  { user_id: 'u3', display_name: '   ', me: false }        // 이름이 비면 '멤버'
];

const cases = [
  { name: '비어 있으면 모두', who: [] as string[] },
  { name: '나는 맨 앞에 그리고 나로 부른다', who: ['u1', 'me'] },
  { name: '이름이 비면 멤버', who: ['u3'] },
  { name: '모르는 id도 멤버 (나간 사람일 수 있다)', who: ['ghost'] },
  { name: '나 혼자', who: ['me'] },
  { name: '섞임', who: ['ghost', 'me', 'u1', 'u3'] }
];

describe('참여자 이름표 — collab.js가 단일 출처', () => {
  it('iOS 픽스처를 실제 규칙으로 갱신한다', () => {
    const rows = cases.map((c) => ({
      name: c.name,
      who: c.who,
      text: collab.whoText({ who: c.who }, members),
      labels: collab.whoLabels(c.who, members),
      includesMe: collab.includesMe({ who: c.who }, 'me')
    }));

    // 비어 있으면 '모두'다 — 기본이 함께 다니는 것이라 저장되지도 않는다(§26)
    expect(rows[0].text).toBe('모두');
    expect(rows[0].includesMe).toBe(true);
    // 나는 늘 맨 앞
    expect(rows[1].labels[0]).toBe('나');
    // 이름표에 이메일이 섞이지 않는다(§69)
    expect(JSON.stringify(rows)).not.toMatch(/@/);

    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'who-text.json'),
                  JSON.stringify({ members, cases: rows }, null, 2) + String.fromCharCode(10));
  });
});
