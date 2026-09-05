// 실시간 이벤트 → 무엇을 다시 읽는가. **규칙은 `collab.js`의 `liveEffects` 하나**이고
// iOS의 `CollabModel.liveEffects`는 그 복사본이다(§39·§40).
//
// 복사본은 조용히 갈라진다. 그래서 여기서 **모든 kind × mine 조합**의 답을 JS로 만들어
// fixture로 떨어뜨리고, Swift 테스트가 같은 파일을 읽어 맞춰 본다.
// 규칙을 바꿀 때는 `collab.js`를 먼저 고친다 — 그러면 fixture가 바뀌고 Swift 테스트가 깨진다.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import collab from '@legacy/collab.js';

const FIXTURE = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures/live-effects.json');

describe('liveEffects 파리티', () => {
  it('모든 kind × mine의 답을 fixture로 남긴다', () => {
    // 모르는 kind도 넣는다 — 서버가 새 활동을 추가해도 앱이 이상하게 굴지 않아야 한다.
    const kinds = [...collab.ACTIVITY_KINDS, 'UNKNOWN_KIND', ''];
    const cases = kinds.flatMap((kind) =>
      [false, true].map((mine) => ({ kind, mine, effects: collab.liveEffects({ kind, mine }) }))
    );

    // 규칙이 실제로 무엇을 말하는지 몇 가지는 여기서도 못 박는다 — fixture만 있으면
    // 둘 다 같이 틀린 채로 통과할 수 있다.
    const of = (kind: string, mine = false) => cases.find((c) => c.kind === kind && c.mine === mine)!.effects;
    expect(of('REACTION').candidates, '반응은 후보 보드를 다시 읽는다').toBe(true);
    expect(of('MEMBER_JOINED').members).toBe(true);
    expect(of('MEMBER_JOINED').notify, '새 멤버는 알린다').toBe(true);
    expect(of('SCHEDULE_CHANGED').pull, '남의 저장은 문서를 당긴다').toBe(true);
    expect(of('SCHEDULE_CHANGED', true).pull, '내 저장은 당기지 않는다').toBe(false);
    expect(of('CANDIDATE_PROPOSED', true).notify, '내가 담은 것은 알리지 않는다').toBe(false);
    expect(of('UNKNOWN_KIND').activity, '모르는 활동은 목록을 다시 읽지 않는다').toBe(false);

    mkdirSync(path.dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify({ cases }, null, 2)}\n`);
  });
});
