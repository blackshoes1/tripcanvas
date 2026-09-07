// 붙여넣은 일정 읽기 — **파서를 복제하지 않는다**는 계약을 여기서 지킨다.
// 규칙 자체(시간 접두사·전각 구분자·날짜)는 `test/intake.test.js`가 본다.
// 여기서는 **경계**를 본다: 로그인 · 크기 · 계약 모양 · 저장하지 않음.
import { describe, expect, it } from 'vitest';

import type { ItineraryParseResponse } from '@/features/trip-state/domain/contract';

import { createItineraryRoutes } from './itineraryRoutes';

const CTX = {
  userId: 'u1', legacySupabaseUserId: null, email: 'a@example.com',
  sessionId: null, tokenSource: 'tripcanvas' as const
};
const verifier = { verify: async (token: string) => (token === 'good' ? CTX : null) };
const routes = createItineraryRoutes({ verifier, now: () => new Date('2026-09-07T00:00:00Z') });

const PASTED = [
  '[day1] 7월 21일(수) — 가루이자와 도착',
  '* 09:00~10:00｜쿠모바 연못 산책',
  '연못 주변 산책. [장소 안내](https://example.test/kumoba)',
  '* 08:00~09:00｜아침 식사'
].join('\n');

const call = (body: unknown, token = 'good') =>
  routes.parse(new Request('https://x/api/v1/itineraries/parse', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
    body: JSON.stringify(body)
  }));

describe('POST /api/v1/itineraries/parse', () => {
  it('로그인해야 부를 수 있다 — 우리 CPU를 공개해 두지 않는다', async () => {
    expect((await call({ text: PASTED }, '')).status).toBe(401);
    expect((await call({ text: PASTED }, 'bad')).status).toBe(401);
  });

  it('읽은 결과를 계약 모양으로 준다', async () => {
    const response = await call({ text: PASTED, year: 2026 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ItineraryParseResponse;

    expect(body.draft.start).toBe('2026-07-21');
    expect(body.draft.startAmbiguous).toBe(true);
    const [day] = body.draft.days;
    expect(day.index).toBe(0);
    expect(day.date).toBe('2026-07-21');

    const [pond, meal] = day.items;
    expect(pond).toMatchObject({
      name: '쿠모바 연못 산책', at: '09:00', endAt: '10:00', stayMinutes: 60,
      url: 'https://example.test/kumoba', kind: 'PLACE'
    });
    expect(pond.desc).toContain('연못 주변');
    // 장소가 아니어 보이는 줄도 **버리지 않는다** — 담을지는 사람이 고른다
    expect(meal.kind).toBe('ACTIVITY');
    expect(meal.reasons[0]).toContain('행동');
    expect(meal.raw).toContain('아침 식사');
  });

  it('분은 정수다 — 소수를 보내면 앱이 디코딩에서 죽는다', async () => {
    const body = (await (await call({ text: PASTED, year: 2026 })).json()) as ItineraryParseResponse;
    for (const item of body.draft.days.flatMap((d) => d.items)) {
      if (item.stayMinutes != null) expect(Number.isInteger(item.stayMinutes)).toBe(true);
    }
  });

  it('읽을 것이 없거나 너무 길면 이유를 말한다', async () => {
    expect((await call({ text: '   ' })).status).toBe(400);
    expect((await call({ text: 'ㅁ'.repeat(20001) })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });

  it('연도가 없는 글은 요청의 연도를, 그것도 없으면 올해를 쓴다', async () => {
    const asked = (await (await call({ text: '[day1] 7월 21일 도착\n- 어떤 곳', year: 2030 })).json()) as ItineraryParseResponse;
    expect(asked.draft.start).toBe('2030-07-21');

    const fallback = (await (await call({ text: '[day1] 7월 21일 도착\n- 어떤 곳' })).json()) as ItineraryParseResponse;
    expect(fallback.draft.start).toBe('2026-07-21');
  });
});
