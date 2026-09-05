// 협업 라우트 경계 — 인증(미리보기만 익명 허용) · 본문/경로 검증 · CollabApi 호출 인자 · 오류 계약.
// CollabApi는 가짜다(규칙은 collabService.test.ts가 PGlite에서 검증한다).
import { describe, expect, it } from 'vitest';

import { ApiError } from './errors';
import type { CollabApi } from '../application/collaboration/types';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { createCollabRoutes } from './collabRoutes';

const A: RequestContext = { userId: 'u-a', legacySupabaseUserId: 'u-a', email: null, sessionId: null, tokenSource: 'supabase' };
const verifier: TokenVerifier = { async verify(token) { return token === 'tok-a' ? A : null; } };

function fakeApi(calls: unknown[][]): CollabApi {
  const rec = <T,>(name: string, value: T) => (...args: unknown[]) => { calls.push([name, ...args]); return Promise.resolve(value); };
  return {
    listMembers: rec('listMembers', []), manageMember: rec('manageMember', true), leave: rec('leave', true),
    createInvite: rec('createInvite', { id: 1, token: 't'.repeat(32), role: 'EDITOR', expires_at: '2026-01-01T00:00:00.000Z' }),
    listInvites: rec('listInvites', []), revokeInvite: rec('revokeInvite', true),
    previewInvite: rec('previewInvite', { valid: true, reason: 'OK', trip_name: '스페인', start_date: '', day_count: 2, role: 'EDITOR', expires_at: null, already_member: false }),
    acceptInvite: rec('acceptInvite', { ok: true, reason: 'OK', client_id: 'trip1', trip_name: '스페인', role: 'EDITOR', already_member: false }),
    listCandidates: rec('listCandidates', []), addCandidate: rec('addCandidate', 7), reactToCandidate: rec('reactToCandidate', true),
    manageCandidate: async () => { throw new ApiError('FORBIDDEN'); },
    listComments: rec('listComments', []), addComment: rec('addComment', 9), deleteComment: rec('deleteComment', false),
    listActivity: rec('listActivity', []), listPreferences: rec('listPreferences', []), setPreference: rec('setPreference', { pace: 'RELAXED' })
  };
}

const req = (method: string, path: string, token: string | null, body?: unknown) =>
  new Request(`http://api.test${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

function setup() {
  const calls: unknown[][] = [];
  const routes = createCollabRoutes({ verifier, apiFor: async () => fakeApi(calls) });
  return { calls, routes };
}

describe('인증', () => {
  it('멤버·후보·활동은 401, 미리보기는 익명으로 통과하고 ctx null을 넘긴다', async () => {
    const { calls, routes } = setup();
    expect((await routes.listMembers(req('GET', '/x', null), 'trip1')).status).toBe(401);
    expect((await routes.addCandidate(req('POST', '/x', 'bad', { title: 'x' }), 'trip1')).status).toBe(401);
    const preview = await routes.previewInvite(req('GET', '/x', null), 'tokentokentokentoken');
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview.trip_name).toBe('스페인');
    expect(calls).toEqual([['previewInvite', 'tokentokentokentoken', null]]);
  });

  it('미리보기에 유효한 토큰이 있으면 ctx를 넘긴다(already_member 판정용)', async () => {
    const { calls, routes } = setup();
    await routes.previewInvite(req('GET', '/x', 'tok-a'), 'tokentokentokentoken');
    expect(calls[0][2]).toEqual(A);
  });
});

describe('검증과 인자 전달', () => {
  it('멤버 관리: action 열거형 · memberId 정수', async () => {
    const { calls, routes } = setup();
    expect((await routes.manageMember(req('PATCH', '/x', 'tok-a', { action: 'PROMOTE' }), 'trip1', '3')).status).toBe(400);
    expect((await routes.manageMember(req('PATCH', '/x', 'tok-a', { action: 'RENAME', value: '영희' }), 'trip1', 'abc')).status).toBe(400);
    const res = await routes.manageMember(req('PATCH', '/x', 'tok-a', { action: 'RENAME', value: '영희' }), 'trip1', '3');
    expect(await res.json()).toMatchObject({ ok: true });
    expect(calls.at(-1)).toEqual(['manageMember', A, 'trip1', 3, 'RENAME', '영희']);
  });

  it('초대 만들기는 201, 역할·시간·횟수를 그대로 넘긴다', async () => {
    const { calls, routes } = setup();
    const res = await routes.createInvite(req('POST', '/x', 'tok-a', { role: 'VIEWER', hours: 48 }), 'trip1');
    expect(res.status).toBe(201);
    expect((await res.json()).invite.token).toHaveLength(32);
    expect(calls.at(-1)).toEqual(['createInvite', A, 'trip1', 'VIEWER', 48, null]);
    expect((await routes.createInvite(req('POST', '/x', 'tok-a', { role: 'OWNER' }), 'trip1')).status).toBe(400);
  });

  it('수락은 displayName을 넘기고 결과를 감싼다', async () => {
    const { calls, routes } = setup();
    const res = await routes.acceptInvite(req('POST', '/x', 'tok-a', { displayName: '영희' }), 'tokentokentokentoken');
    expect((await res.json()).result.role).toBe('EDITOR');
    expect(calls.at(-1)).toEqual(['acceptInvite', A, 'tokentokentokentoken', '영희']);
  });

  it('후보 추가 201 · 반응 null 허용 · 서비스의 FORBIDDEN은 403으로', async () => {
    const { calls, routes } = setup();
    const added = await routes.addCandidate(req('POST', '/x', 'tok-a', { title: '사그라다', lat: 41.4, lng: 2.17 }), 'trip1');
    expect(added.status).toBe(201);
    expect((await added.json()).id).toBe(7);
    await routes.react(req('PUT', '/x', 'tok-a', { reaction: null }), 'trip1', '7');
    expect(calls.at(-1)).toEqual(['reactToCandidate', A, 'trip1', 7, null]);
    const res = await routes.manageCandidate(req('PATCH', '/x', 'tok-a', { action: 'REJECT' }), 'trip1', '7');
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });

  it('활동 limit는 정수만, 아니면 null(기본값)', async () => {
    const { calls, routes } = setup();
    await routes.listActivity(req('GET', '/x?limit=20', 'tok-a'), 'trip1');
    await routes.listActivity(req('GET', '/x?limit=all', 'tok-a'), 'trip1');
    expect(calls.map((c) => c[3])).toEqual([20, null]);
  });

  it('취향은 객체만 받고 정규화된 결과를 돌려준다', async () => {
    const { routes } = setup();
    expect((await routes.setPreference(req('PUT', '/x', 'tok-a', { prefs: 'RELAXED' }), 'trip1')).status).toBe(400);
    const res = await routes.setPreference(req('PUT', '/x', 'tok-a', { prefs: { pace: 'RELAXED' } }), 'trip1');
    expect(await res.json()).toMatchObject({ prefs: { pace: 'RELAXED' } });
  });
});

// ── 그룹 제안 (§28·§29·§35) ────────────────────────────────────────────────
//
// 판정은 collab.js가 하고(그쪽 테스트가 규칙을 본다) 여기서 지키는 것은 경계다:
// 저장하지 않는가 · 점수가 새지 않는가 · 재료가 없을 때 억지로 만들지 않는가.

const CAND = (id: number, title: string, lat: number, lng: number) => ({
  id, title, status: 'PROPOSED', lat, lng, must_count: 3, ok_count: 0, pass_count: 0,
  my_reaction: 'MUST', proposed_by_label: '민수', mine: false, created_at: '2026-01-01',
  reactions: [{ user_id: 'u1', name: '민수', reaction: 'MUST', me: true },
              { user_id: 'u2', name: '영희', reaction: 'MUST', me: false },
              { user_id: 'u3', name: '철수', reaction: 'MUST', me: false }]
});

const DAYS = [
  { title: '', spots: [{ name: '광장', lat: 41.387, lng: 2.170 }, { name: '대성당', lat: 41.384, lng: 2.176 }] },
  { title: '', spots: [{ name: '해변', lat: 41.378, lng: 2.192 }] }
];

function proposalSetup(over: Partial<{ candidates: unknown[]; days: unknown[] | null; members: unknown[] }> = {}) {
  const calls: unknown[][] = [];
  const base = fakeApi(calls);
  const api: CollabApi = {
    ...base,
    listCandidates: async (...a: unknown[]) => { calls.push(['listCandidates', ...a]); return (over.candidates ?? [CAND(1, '카사 바트요', 41.392, 2.165)]) as never; },
    listMembers: async (...a: unknown[]) => { calls.push(['listMembers', ...a]); return (over.members ?? [{}, {}, {}]) as never; }
  };
  const routes = createCollabRoutes({
    verifier, apiFor: async () => api,
    tripDocFor: async () => {
      const days = over.days === undefined ? DAYS : over.days;
      return days ? { days, start: '2026-09-01', bookings: [] } : null;
    }
  });
  return { calls, routes };
}

describe('그룹 제안', () => {
  it('반대 없는 후보를 어느 날에 넣을지 문장으로 준다 — 저장은 하지 않는다', async () => {
    const { calls, routes } = proposalSetup();
    const res = await routes.groupProposal(req('GET', '/x', 'tok-a'), 'trip1');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.proposal.summary).toContain('다들 좋아해요');
    expect(body.proposal.picks).toHaveLength(1);
    expect(body.proposal.picks[0].candidateId).toBe(1);
    expect(body.proposal.picks[0].dayLabel).toBe('Day 1');
    expect(body.proposal.picks[0].reasons.length).toBeGreaterThan(0);
    expect(body.proposal.impact).toEqual({ spotsAdded: 1, daysTouched: 1 });
    expect(body.proposal.options.map((o: { key: string }) => o.key)).toEqual(['ACCEPT', 'ADJUST', 'DISMISS']);

    // 읽기만 한다 — 후보를 바꾸는 호출이 하나도 나가지 않는다(§79)
    const names = calls.map((c) => c[0]);
    expect(names).not.toContain('manageCandidate');
    expect(names).not.toContain('addCandidate');
    expect(names).not.toContain('reactToCandidate');
  });

  /** §21·§22 — 합의 점수(0~100)는 내부값이다. 계약 어디에도 실리지 않는다. */
  it('점수를 내보내지 않는다', async () => {
    const { routes } = proposalSetup();
    const body = await (await routes.groupProposal(req('GET', '/x', 'tok-a'), 'trip1')).json();
    const json = JSON.stringify(body);
    expect(json).not.toContain('score');
    expect(json).not.toContain('consensus');
    for (const r of body.proposal.picks[0].reasons as string[]) expect(r).not.toMatch(/점수/);
  });

  it('일정이 없으면 제안하지 않는다 — 넣을 날을 추측하지 않는다', async () => {
    const { routes } = proposalSetup({ days: [] });
    const body = await (await routes.groupProposal(req('GET', '/x', 'tok-a'), 'trip1')).json();
    expect(body.proposal).toBeNull();
  });

  it('여행 문서를 못 읽으면 제안하지 않는다', async () => {
    const routes = createCollabRoutes({
      verifier, apiFor: async () => fakeApi([]),
      tripDocFor: async () => { throw new Error('upstream'); }
    });
    const body = await (await routes.groupProposal(req('GET', '/x', 'tok-a'), 'trip1')).json();
    expect(body.proposal).toBeNull();
  });

  it('후보가 없으면 억지로 만들지 않는다', async () => {
    const { routes } = proposalSetup({ candidates: [] });
    const body = await (await routes.groupProposal(req('GET', '/x', 'tok-a'), 'trip1')).json();
    expect(body.proposal).toBeNull();
  });

  it('로그인하지 않으면 거절한다', async () => {
    const { routes } = proposalSetup();
    const res = await routes.groupProposal(req('GET', '/x', null), 'trip1');
    expect(res.status).toBe(401);
  });
});
