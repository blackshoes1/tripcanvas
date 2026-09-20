// `collab.js`의 **권한 거절 문구** 규칙을 픽스처로 굳혀 iOS 복사본(`CollabModel`)과 맞춘다.
//
// ⚠️ 규칙을 바꾸려면 `collab.js`를 먼저 고친다. 그러면 이 테스트가 픽스처를 새로 쓰고
// iOS 테스트가 깨진다 — 그게 목적이다(복사본은 조용히 갈라진다).
//
// 서버가 실제로 보내는 문장(`next/src/server/api/errors.ts`의 기본값과 각 서비스의 message)을
// 그대로 넣는다 — 화면이 그걸 뭉개지 않는지가 이 규칙의 요점이다.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import collab from '@legacy/collab.js';

type Role = 'OWNER' | 'EDITOR' | 'VIEWER';

/** `api.js`의 `toError`가 만드는 모양 — hint는 싣지 않는다. */
const api = (message: string) => ({ code: '42501', apiCode: 'FORBIDDEN', status: 403, message });

const cases: { name: string; err: unknown; role: Role }[] = [
  { name: '주최자가 나가려 함', role: 'OWNER',
    err: api('주최자는 나갈 수 없습니다 — 여행을 삭제하거나 다른 사람에게 넘겨 주세요.') },
  { name: '나갔거나 내보내진 여행', role: 'EDITOR',
    err: api('이 여행에서 나갔거나 내보내졌습니다.') },
  { name: '초대 링크는 주최자만', role: 'EDITOR',
    err: api('초대 링크는 주최자만 만들 수 있습니다.') },
  { name: '남의 코멘트는 못 지운다', role: 'EDITOR',
    err: api('코멘트는 쓴 사람과 주최자만 지울 수 있습니다.') },
  { name: '보기 권한의 후보 추가 — 서버가 더 구체적이다', role: 'VIEWER',
    err: api('보기 권한으로는 후보를 추가할 수 없습니다.') },
  { name: '서버 기본 FORBIDDEN 문장', role: 'VIEWER',
    err: api('이 여행을 바꿀 권한이 없습니다 — 주최자에게 편집 권한을 요청해 주세요.') },
  { name: '문장이 없을 때 보기 권한', role: 'VIEWER', err: api('') },
  { name: '문장이 없을 때 편집 권한', role: 'EDITOR', err: api('') },
  { name: '레거시 코드 — OWNER_CANNOT_LEAVE', role: 'OWNER', err: { message: 'OWNER_CANNOT_LEAVE' } },
  { name: '레거시 토큰 — 사람에게 쓴 말이 아니다', role: 'EDITOR', err: { message: 'TRIP_FORBIDDEN' } },
  { name: '원시 Postgres 영문은 보이지 않는다', role: 'EDITOR',
    err: { message: 'permission denied for table trips' } }
];

describe('권한 거절 문구 — collab.js가 단일 출처', () => {
  it('iOS 픽스처를 실제 규칙으로 갱신한다', () => {
    const rows = cases.map((c) => ({
      name: c.name,
      message: String((c.err as { message?: unknown }).message ?? ''),
      role: c.role,
      text: collab.forbiddenText(c.err, c.role)
    }));

    // 서버가 말한 이유는 그대로 전해진다 — 일반 문장으로 뭉개지 않는다
    expect(rows[0].text).toBe('주최자는 나갈 수 없습니다 — 여행을 삭제하거나 다른 사람에게 넘겨 주세요.');
    expect(rows[2].text).toBe('초대 링크는 주최자만 만들 수 있습니다.');
    // 서버가 아무 말도 없을 때만 역할로 짐작한다
    expect(rows[6].text).toMatch(/편집 권한을 요청/);
    expect(rows[7].text).toBe('이 여행을 바꿀 권한이 없어요');
    // 기계용 토큰·원시 Postgres 영문은 사용자에게 보이지 않는다
    expect(rows[9].text).toBe('이 여행을 바꿀 권한이 없어요');
    expect(rows[10].text).toBe('이 여행을 바꿀 권한이 없어요');
    // 어떤 경우에도 영문 내부 토큰이 화면 문장에 새지 않는다
    for (const row of rows) expect(row.text).not.toMatch(/FORBIDDEN|permission denied|_[A-Z]/);

    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'forbidden-text.json'),
                  JSON.stringify({ cases: rows }, null, 2) + String.fromCharCode(10));
  });
});
