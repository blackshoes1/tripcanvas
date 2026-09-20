// `collab.js`의 **갈린 후보 → 세 선택지 → 분리 계획** 규칙을 픽스처로 굳혀 iOS 복사본(`CollabModel`)과 맞춘다.
//
// ⚠️ 규칙을 바꾸려면 `collab.js`를 먼저 고친다. 그러면 이 테스트가 픽스처를 새로 쓰고
// iOS 테스트가 깨진다 — 그게 목적이다(복사본은 조용히 갈라진다).
//
// 특히 **장소 세 줄의 모양**까지 굳힌다. 웹과 앱이 같은 문서를 쓰므로 키가 하나만 달라도
// 한쪽이 만든 분리를 다른 쪽이 못 읽는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import collab from '@legacy/collab.js';

const SPLIT_ID = 'sp1';

const members = [
  { user_id: 'me', display_name: '나야', me: true },
  { user_id: 'u2', display_name: '지민', me: false },
  { user_id: 'u3', display_name: '현우', me: false }
];

// ⚠️ `me`는 **언제나** 실린다 — 서버 `list_trip_candidates`가 `r.user_id=auth.uid()`를 그대로 넣는다.
// 픽스처에서 빠뜨리면 앱의 `ReactionEntry`(비옵셔널 `me`) 디코딩이 깨진다.
type Rx = { user_id?: string; name: string; reaction: string; me: boolean };

function candidate(over: Record<string, unknown>, reactions: Rx[]) {
  const count = (r: string) => reactions.filter((x) => x.reaction === r).length;
  return {
    id: 1,
    title: '캄프 누',
    place_id: null,
    lat: null,
    lng: null,
    addr: null,
    note: null,
    url: null,
    status: 'PROPOSED',
    scheduled_ref: null,
    proposed_by_label: '나야',
    mine: true,
    my_reaction: reactions.find((r) => r.me)?.reaction ?? null,
    must_count: count('MUST'),
    ok_count: count('OK'),
    pass_count: count('PASS'),
    reactions,
    comment_count: 0,
    created_at: '2026-09-01T00:00:00.000Z',
    ...over
  };
}

const cases = [
  {
    name: '갈렸고 누가 어느 쪽인지 안다 — 나눌 수 있다',
    memberCount: 3,
    candidate: candidate({ lat: 41.38, lng: 2.12, addr: '바르셀로나', note: '경기 보고 싶어' }, [
      { user_id: 'me', name: '나야', reaction: 'MUST', me: true },
      { user_id: 'u3', name: '현우', reaction: 'OK', me: false },
      { user_id: 'u2', name: '지민', reaction: 'PASS', me: false }
    ])
  },
  {
    name: '갈렸지만 id가 없는 옛 응답 — 이름은 있어도 가를 수 없다',
    memberCount: 3,
    candidate: candidate({}, [
      { name: '나야', reaction: 'MUST', me: true },
      { name: '지민', reaction: 'PASS', me: false }
    ])
  },
  {
    name: '반대가 없으면 충돌이 아니다 — 선택지도 계획도 없다',
    memberCount: 3,
    candidate: candidate({}, [
      { user_id: 'me', name: '나야', reaction: 'MUST', me: true },
      { user_id: 'u3', name: '현우', reaction: 'OK', me: false }
    ])
  },
  {
    name: '좌표도 주소도 없는 후보 — 위치 없는 장소로 들어간다',
    memberCount: 2,
    candidate: candidate({ title: '   이름 앞뒤 공백   ' }, [
      { user_id: 'me', name: '나야', reaction: 'MUST', me: true },
      { user_id: 'u2', name: '지민', reaction: 'PASS', me: false }
    ])
  }
];

describe('갈린 후보의 분리 — collab.js가 단일 출처', () => {
  it('iOS 픽스처를 실제 규칙으로 갱신한다', () => {
    const rows = cases.map((c) => {
      const conflict = collab.candidateConflict(c.candidate, c.memberCount);
      return {
        name: c.name,
        memberCount: c.memberCount,
        candidate: c.candidate,
        conflict,
        options: collab.conflictOptions(conflict),
        plan: collab.buildSplitPlan(c.candidate, members, { splitId: SPLIT_ID })
      };
    });

    // 나눌 수 있는 후보는 분리도 실제 동작이다 — 안내로 끝나지 않는다(§24)
    const splittable = rows[0].plan;
    if (!splittable) throw new Error('양쪽에 사람이 있으면 계획이 나와야 한다');
    expect(rows[0].options.map((o) => o.action)).toEqual(['SCHEDULE', 'SPLIT', 'REJECT']);
    expect(splittable.spots.map((s) => s.name)).toEqual(['캄프 누', '자유시간', '다시 만나기']);
    expect(splittable.goers).toEqual(['me', 'u3']);
    expect(splittable.others).toEqual(['u2']);
    // id가 없으면 만들 수 없으니 권하지도 않는다
    expect(rows[1].options[1].action).toBeNull();
    expect(rows[1].plan).toBeNull();
    // 충돌이 아니면 선택지가 없다
    expect(rows[2].conflict).toBeNull();
    expect(rows[2].options).toEqual([]);
    // 합류는 묶음 밖이다 — 다 모인 뒤다
    expect('split' in splittable.spots[2]).toBe(false);
    expect(splittable.spots[2].reunion).toBe(true);
    // 이름표에 이메일이 섞이지 않는다(§69)
    expect(JSON.stringify(rows)).not.toMatch(/@/);
    // ⚠️ 앱의 `ReactionEntry`는 `me`가 비옵셔널이다 — 하나라도 빠지면 픽스처 전체 디코딩이 깨지고
    //    그 사고는 iOS CI까지 아무도 모른다(2026-09-20). 서버도 늘 싣는 값이라 여기서 지킨다.
    for (const row of rows) {
      for (const rx of row.candidate.reactions) expect(typeof rx.me).toBe('boolean');
    }

    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'split-plan.json'),
                  JSON.stringify({ splitId: SPLIT_ID, members, cases: rows }, null, 2) + String.fromCharCode(10));
  });
});
