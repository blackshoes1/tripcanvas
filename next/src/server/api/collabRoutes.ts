// 협업 API 라우트(§40) — HTTP 관심사만: 인증 → 본문·경로 검증(zod) → CollabApi → 응답/오류 계약.
// 초대 미리보기만 로그인 없이 부를 수 있다(링크가 유출돼도 이름·기간·역할까지만 보인다).
import { z } from 'zod';

import { CONTRACT_SCHEMA_VERSION } from '@/features/trip-state/domain/contract';
import { buildGroupProposalView } from '@/features/trip-state/domain/groupProposalView';
import type { CollabApi } from '../application/collaboration/types';
import { authenticate, bearerToken } from '../auth/authenticate';
import type { RequestContext, TokenVerifier } from '../auth/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';

export interface CollabRouteDeps {
  verifier: TokenVerifier;
  /** 레지스트리에 따라 새 DB(CollabService) 또는 Supabase RPC 어댑터. ctx가 null이면 로그인 전(미리보기) */
  apiFor(ctx: RequestContext | null, token: string): Promise<CollabApi>;
  /**
   * 그룹 제안이 "어느 날 어느 자리에 넣을지"를 정하려면 여행 문서가 필요하다 —
   * 일자와 그 날 마지막 장소뿐 아니라 시작일(요일→운영시간)과 예약까지 본다(§63).
   * 후보는 CollabApi에 있고 일정은 여행 문서에 있어서, 문서를 읽는 길만 따로 받는다.
   * 없거나 실패하면 제안을 만들지 않는다(null) — 틀린 날을 추측하지 않는다.
   */
  tripDocFor?(ctx: RequestContext, token: string, tripId: string):
    Promise<{ days?: unknown[]; start?: string; bookings?: unknown[] } | null>;
}

const MemberBody = z.object({ action: z.enum(['SET_ROLE', 'REMOVE', 'RENAME']), value: z.string().max(200).nullable().optional() });
const InviteBody = z.object({ role: z.enum(['EDITOR', 'VIEWER']), hours: z.number().int().min(1).max(720).nullable().optional(), maxUses: z.number().int().min(1).nullable().optional() });
const AcceptBody = z.object({ displayName: z.string().max(200).nullable().optional() });
const CandidateBody = z.object({
  title: z.string().max(1000), place_id: z.string().max(500).nullable().optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(),
  addr: z.string().max(1000).nullable().optional(), note: z.string().max(2000).nullable().optional(), url: z.string().max(2000).nullable().optional()
});
const CandidateActionBody = z.object({ action: z.enum(['REMOVE', 'SCHEDULE', 'UNSCHEDULE', 'REJECT', 'REOPEN']), value: z.string().max(200).nullable().optional() });
const ReactionBody = z.object({ reaction: z.string().max(20).nullable() });
const CommentBody = z.object({ body: z.string().max(5000) });
const PrefsBody = z.object({ prefs: z.record(z.string(), z.unknown()) });

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try { raw = await request.json(); } catch { throw new ApiError('VALIDATION_ERROR', { message: '본문이 JSON이 아닙니다.' }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', { details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  return parsed.data;
}

function intParam(raw: string, name: string): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n)) throw new ApiError('VALIDATION_ERROR', { message: `${name}이(가) 올바르지 않습니다.` });
  return n;
}

function ok(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ schemaVersion: CONTRACT_SCHEMA_VERSION, ...body }), { status, headers: JSON_HEADERS });
}

export function createCollabRoutes(deps: CollabRouteDeps) {
  async function withApi<T>(request: Request, fn: (ctx: RequestContext, api: CollabApi) => Promise<T>): Promise<T | Response> {
    try {
      const ctx = await authenticate(request, deps.verifier);
      return await fn(ctx, await deps.apiFor(ctx, bearerToken(request) ?? ''));
    } catch (e) {
      if (!(e instanceof ApiError)) console.error('[tripcanvas-api] collab route failed:', e instanceof Error ? e.message : e);
      return errorResponse(e);
    }
  }

  return {
    // ── 멤버 ──
    listMembers: (request: Request, tripId: string) => withApi(request, async (ctx, api) => ok({ members: await api.listMembers(ctx, tripId) })),
    manageMember: (request: Request, tripId: string, memberId: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, MemberBody);
      return ok({ ok: await api.manageMember(ctx, tripId, intParam(memberId, 'memberId'), body.action, body.value ?? null) });
    }),
    leave: (request: Request, tripId: string) => withApi(request, async (ctx, api) => ok({ ok: await api.leave(ctx, tripId) })),
    listPreferences: (request: Request, tripId: string) => withApi(request, async (ctx, api) => ok({ preferences: await api.listPreferences(ctx, tripId) })),
    setPreference: (request: Request, tripId: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, PrefsBody);
      return ok({ prefs: await api.setPreference(ctx, tripId, body.prefs) });
    }),

    // ── 초대 ──
    listInvites: (request: Request, tripId: string) => withApi(request, async (ctx, api) => ok({ invites: await api.listInvites(ctx, tripId) })),
    createInvite: (request: Request, tripId: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, InviteBody);
      return ok({ invite: await api.createInvite(ctx, tripId, body.role, body.hours ?? null, body.maxUses ?? null) }, 201);
    }),
    revokeInvite: (request: Request, tripId: string, inviteId: string) => withApi(request, async (ctx, api) =>
      ok({ ok: await api.revokeInvite(ctx, tripId, intParam(inviteId, 'inviteId')) })),
    /** 로그인 전에도 — 토큰이 없거나 틀리면 익명으로 본다 */
    previewInvite: async (request: Request, token: string) => {
      try {
        const bearer = bearerToken(request);
        const ctx = bearer ? await deps.verifier.verify(bearer) : null;
        const api = await deps.apiFor(ctx, bearer ?? '');
        return ok({ preview: await api.previewInvite(token, ctx) });
      } catch (e) {
        return errorResponse(e);
      }
    },
    acceptInvite: (request: Request, token: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, AcceptBody);
      return ok({ result: await api.acceptInvite(ctx, token, body.displayName ?? null) });
    }),

    // ── 후보 ──
    listCandidates: (request: Request, tripId: string) => withApi(request, async (ctx, api) => ok({ candidates: await api.listCandidates(ctx, tripId) })),
    addCandidate: (request: Request, tripId: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, CandidateBody);
      return ok({ id: await api.addCandidate(ctx, tripId, body) }, 201);
    }),
    manageCandidate: (request: Request, tripId: string, candidateId: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, CandidateActionBody);
      return ok({ ok: await api.manageCandidate(ctx, tripId, intParam(candidateId, 'candidateId'), body.action, body.value ?? null) });
    }),
    react: (request: Request, tripId: string, candidateId: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, ReactionBody);
      return ok({ ok: await api.reactToCandidate(ctx, tripId, intParam(candidateId, 'candidateId'), body.reaction) });
    }),

    // ── 코멘트 ──
    listComments: (request: Request, tripId: string, candidateId: string) => withApi(request, async (ctx, api) =>
      ok({ comments: await api.listComments(ctx, tripId, intParam(candidateId, 'candidateId')) })),
    addComment: (request: Request, tripId: string, candidateId: string) => withApi(request, async (ctx, api) => {
      const body = await parseBody(request, CommentBody);
      return ok({ id: await api.addComment(ctx, tripId, intParam(candidateId, 'candidateId'), body.body) }, 201);
    }),
    deleteComment: (request: Request, tripId: string, commentId: string) => withApi(request, async (ctx, api) =>
      ok({ ok: await api.deleteComment(ctx, tripId, intParam(commentId, 'commentId')) })),

    // ── 활동 ──
    /**
     * GET /api/v1/trips/:tripId/group-proposal — 반대 없는 후보를 어느 날에 넣을지 **미리보기**.
     *
     * 판정은 `collab.js`의 `buildGroupProposal` 하나가 한다 — 앱이 같은 규칙을 다시 만들지 않게(§35).
     * **아무것도 저장하지 않는다.** 수락은 사람이 누르고, 그때 문서 저장과 후보 표시가 따로 일어난다(§79).
     * 제안할 것이 없으면 `proposal: null`로 정직하게 답한다.
     */
    groupProposal: (request: Request, tripId: string) => withApi(request, async (ctx, api) => {
      // 문서 전체가 필요하다 — days만으로는 요일(운영시간)도 예약도 몰라 '그 날 어디에'를 말할 수 없다(§63).
      const trip = deps.tripDocFor ? await deps.tripDocFor(ctx, bearerToken(request) ?? '', tripId).catch(() => null) : null;
      if (!trip || !Array.isArray(trip.days) || !trip.days.length) return ok({ proposal: null });
      const [candidates, members, preferences] = await Promise.all([
        api.listCandidates(ctx, tripId),
        api.listMembers(ctx, tripId),
        // 취향은 있으면 좋고 없어도 제안은 나간다 — 하나가 죽어서 전부 막히지 않게
        api.listPreferences(ctx, tripId).catch(() => [] as unknown[])
      ]);
      return ok({
        proposal: buildGroupProposalView({
          candidates: candidates as unknown[], trip,
          memberCount: (members as unknown[]).length, preferences: preferences as unknown[]
        })
      });
    }),

    listActivity: (request: Request, tripId: string) => withApi(request, async (ctx, api) => {
      const raw = new URL(request.url).searchParams.get('limit');
      const limit = raw && /^\d+$/.test(raw) ? Number(raw) : null;
      return ok({ activity: await api.listActivity(ctx, tripId, limit) });
    })
  };
}
