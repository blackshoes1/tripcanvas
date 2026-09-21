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

/** 참여자를 **고를 수 있는** 역할. 의견이 아니라 편집이다(§12) — 보기 권한은 못 고른다. */
const roles = ['OWNER', 'EDITOR', 'VIEWER'];

/** 칩 하나를 켜고 끄는 규칙(`pickWho`). 멤버는 위의 `members` 순서(u1 · me · u3)다. */
const pickCases = [
  { name: '아무도 없을 때 하나 고르기', who: [] as string[], toggle: 'me' },
  { name: '고른 것을 다시 누르면 모두', who: ['me'], toggle: 'me' },
  { name: '전원을 고르면 모두', who: ['u1', 'me'], toggle: 'u3' },
  { name: '고른 순서가 아니라 멤버 순서로 담는다', who: ['u3'], toggle: 'u1' },
  { name: '나간 사람의 id는 떨어진다', who: ['ghost'], toggle: 'u1' },
  { name: '전원에서 하나를 빼면 나머지가 남는다', who: [], toggle: 'u1' }
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
    const assign = Object.fromEntries(roles.map((r) => [r, collab.canAssignWho(r)]));
    const allIds = members.map((m) => m.user_id);
    const picks = pickCases.map((c) => ({
      name: c.name,
      who: c.who,
      toggle: c.toggle,
      allIds,
      next: collab.pickWho(c.who, c.toggle, allIds)
    }));

    // 참여자 지정은 편집이다 — 보기 권한은 의견만 낸다(§12).
    expect(assign).toEqual({ OWNER: true, EDITOR: true, VIEWER: false });
    // 전원을 고르면 '모두'로 되돌아간다 — 그러지 않으면 whoKey가 갈라 하루가 분리된 것처럼 보인다.
    expect(picks.find((p) => p.name === '전원을 고르면 모두')?.next).toEqual([]);

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
                  JSON.stringify({ members, cases: rows, canAssignWho: assign, picks }, null, 2)
                    + String.fromCharCode(10));
  });
});
