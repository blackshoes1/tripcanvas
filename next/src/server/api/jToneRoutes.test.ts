import { expect, it } from 'vitest';
import { createJToneRoutes } from './jToneRoutes';
import { JToneService, type JTone } from '../application/account/jToneService';
import type { TokenVerifier } from '../auth/types';

const rows = new Map<string, JTone>();
const verifier: TokenVerifier = { async verify(token) {
  return token === 'a' || token === 'b' ? { userId: token, email: null, legacySupabaseUserId: token, sessionId: null, tokenSource: 'supabase' } : null;
} };
const routes = createJToneRoutes({ verifier, serviceFor: async (ctx) => new JToneService({
  read: async (id) => rows.get(id) ?? 'FRIENDLY', save: async (id, tone) => { rows.set(id, tone); }
}, ctx.userId) });
const request = (token: string, body?: unknown) => new Request('http://api.test/api/v1/me/preferences', {
  method: body === undefined ? 'GET' : 'PUT', headers: { authorization: `Bearer ${token}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

it('토큰으로만 설정 주인을 정하고 사용자별로 분리한다', async () => {
  expect((await routes.preferences(request('bad', { jTone: 'CASUAL' }))).status).toBe(401);
  expect((await routes.preferences(request('a', { jTone: 'CASUAL' }))).status).toBe(200);
  expect(await (await routes.preferences(request('a'))).json()).toEqual({ jTone: 'CASUAL' });
  expect(await (await routes.preferences(request('b'))).json()).toEqual({ jTone: 'FRIENDLY' });
  expect((await routes.preferences(request('a', { jTone: 'POLITE', userId: 'b' }))).status).toBe(400);
});

it('모르는 값·누락·잘못된 JSON·큰 본문을 저장하지 않는다', async () => {
  for (const body of [{ jTone: 'BOSS' }, {}, null, [], { jTone: 3 }]) {
    expect((await routes.preferences(request('b', body))).status).toBe(400);
  }
  const malformed = new Request('http://api.test/api/v1/me/preferences', { method: 'PUT', headers: { authorization: 'Bearer b' }, body: '{' });
  expect((await routes.preferences(malformed)).status).toBe(400);
  expect((await routes.preferences(request('b', { jTone: 'x'.repeat(2000) }))).status).toBe(400);
  expect(rows.has('b')).toBe(false);
});
