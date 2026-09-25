// 협업 use case(§40·§41) — Supabase RPC 21종의 판정을 application으로 옮겼다. 규칙 하나하나가 그 RPC 본문과 같다:
//   보기 권한은 의견만 낸다(반응·코멘트·취향) · 후보 추가/결정은 OWNER·EDITOR · 후보 빼기는 제안자/주최자 ·
//   초대는 소유자만 만들고 취소한다 · 수락은 멱등 · 내보내진 사람은 그 전 링크로 못 돌아온다 · 소유자는 못 나간다.
// 남의 여행은 '없음'(NOT_FOUND)이다 — 존재를 흘리지 않는다. 권한이 모자라면 FORBIDDEN, 값이 틀리면 VALIDATION_ERROR.
import collab from '@legacy/collab.js';
import { createHash, randomBytes } from 'node:crypto';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type { CollabRepository, MemberRole, TripRepository, TripView } from '../../repositories/types';
import type { PgCollabRepository } from '../../infrastructure/database/pgCollabRepository';
import { CANDIDATE_CATEGORIES } from './types';
import type {
  ActivityView, CandidateAction, CandidateCategory, CandidateInput, CandidateView, CollabApi, CommentView, InviteAccept, InviteCreated,
  InvitePreview, InviteView, MemberAction, MemberView, PreferenceView
} from './types';

const ROLES = ['EDITOR', 'VIEWER'];
const REACTIONS = ['MUST', 'OK', 'PASS'];
const canEdit = (role: string) => role === 'OWNER' || role === 'EDITOR';

const trimTo = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null;
};

/** 모르는 분류는 null이 된다 — 담기가 분류 하나 때문에 실패하지 않게. 소문자로 보내도 받는다. */
function normalizeCandidateCategory(v: unknown): CandidateCategory | null {
  const s = String(v ?? '').trim().toUpperCase();
  return (CANDIDATE_CATEGORIES as readonly string[]).includes(s) ? (s as CandidateCategory) : null;
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface CollabServiceDeps {
  trips: TripRepository;
  collab: CollabRepository & Pick<PgCollabRepository, 'findActiveMembership'>;
}

export class CollabService implements CollabApi {
  constructor(private readonly deps: CollabServiceDeps) {}

  /** 내가 볼 수 있고 삭제되지 않은 여행(소유한 쪽 우선). 아니면 NOT_FOUND */
  private async tripFor(ctx: RequestContext, clientId: string): Promise<TripView> {
    const view = await this.deps.trips.findVisible(ctx.userId, clientId);
    if (!view || view.record.deletedAt) throw new ApiError('NOT_FOUND');
    return view;
  }

  // ── 멤버 ──

  async listMembers(ctx: RequestContext, clientId: string): Promise<MemberView[]> {
    const view = await this.tripFor(ctx, clientId);
    return this.deps.collab.listMembers(view.record.id, ctx.userId);
  }

  async manageMember(ctx: RequestContext, clientId: string, memberId: number, action: MemberAction, value: string | null): Promise<boolean> {
    const view = await this.tripFor(ctx, clientId);
    const member = await this.deps.collab.findMember(memberId);
    if (!member || member.tripId !== view.record.id) return false;
    const owner = view.record.ownerId;
    if (action === 'RENAME') {
      if (ctx.userId !== owner && ctx.userId !== member.userId) throw new ApiError('FORBIDDEN', { message: '이름은 본인이나 주최자만 바꿀 수 있습니다.' });
      await this.deps.collab.renameMember(member.id, trimTo(value, 40));
      return true;
    }
    if (ctx.userId !== owner) throw new ApiError('FORBIDDEN', { message: '역할 변경과 내보내기는 주최자만 할 수 있습니다.' });
    if (member.role === 'OWNER') throw new ApiError('FORBIDDEN', { message: '주최자 자신의 역할은 바꾸거나 내보낼 수 없습니다.' });
    if (action === 'SET_ROLE') {
      if (!value || !ROLES.includes(value)) throw new ApiError('VALIDATION_ERROR', { message: '역할은 EDITOR 또는 VIEWER입니다.' });
      await this.deps.collab.setMemberRole(member.id, value as MemberRole);
      return true;
    }
    if (action === 'REMOVE') {
      if (member.status !== 'REMOVED') await this.deps.collab.setMemberStatus(member.id, 'REMOVED', ctx.userId);
      return true;
    }
    throw new ApiError('VALIDATION_ERROR', { message: 'action은 SET_ROLE · REMOVE · RENAME 중 하나입니다.' });
  }

  async leave(ctx: RequestContext, clientId: string): Promise<boolean> {
    const m = await this.deps.collab.findActiveMembership(ctx.userId, clientId);
    if (!m) return true;
    if (m.ownerId === ctx.userId) throw new ApiError('FORBIDDEN', { message: '주최자는 나갈 수 없습니다 — 여행을 삭제하거나 소유권을 넘겨 주세요.' });
    await this.deps.collab.setMemberStatus(m.id, 'LEFT', ctx.userId);
    return true;
  }

  // ── 초대 ──

  async createInvite(ctx: RequestContext, clientId: string, role: string, hours: number | null, maxUses: number | null): Promise<InviteCreated> {
    if (!ROLES.includes(role)) throw new ApiError('VALIDATION_ERROR', { message: '초대 역할은 EDITOR 또는 VIEWER입니다.' });
    if (maxUses != null && (!Number.isInteger(maxUses) || maxUses <= 0)) throw new ApiError('VALIDATION_ERROR', { message: 'maxUses는 1 이상의 정수입니다.' });
    const view = await this.tripFor(ctx, clientId);
    if (view.role !== 'OWNER') throw new ApiError('FORBIDDEN', { message: '초대 링크는 주최자만 만들 수 있습니다.' });
    const h = Math.min(Math.max(Number.isFinite(Number(hours)) && hours != null ? Number(hours) : 168, 1), 24 * 30);
    // 192비트 난수 → URL-safe base64 32자. 저장은 sha256뿐 — DB가 새어도 링크를 재구성할 수 없다
    const token = randomBytes(24).toString('base64url');
    const created = await this.deps.collab.createInvite({
      tripId: view.record.id, tokenHash: sha256(token), role, createdBy: ctx.userId,
      expiresAt: new Date(Date.now() + h * 3600_000).toISOString(), maxUses
    });
    return { id: created.id, token, role, expires_at: created.expiresAt };
  }

  async listInvites(ctx: RequestContext, clientId: string): Promise<InviteView[]> {
    const view = await this.tripFor(ctx, clientId);
    if (view.role !== 'OWNER') throw new ApiError('FORBIDDEN', { message: '초대 목록은 주최자만 봅니다.' });
    return this.deps.collab.listInvites(view.record.id);
  }

  async revokeInvite(ctx: RequestContext, clientId: string, inviteId: number): Promise<boolean> {
    const view = await this.tripFor(ctx, clientId);
    if (view.role !== 'OWNER') throw new ApiError('FORBIDDEN', { message: '초대 취소는 주최자만 할 수 있습니다.' });
    return this.deps.collab.revokeInvite(inviteId, view.record.id);
  }

  async previewInvite(token: string, ctx: RequestContext | null): Promise<InvitePreview> {
    const none: InvitePreview = { valid: false, reason: 'INVALID', trip_name: null, start_date: null, day_count: null, role: null, expires_at: null, already_member: false };
    if (!token || token.length < 16 || token.length > 128) return none;
    const inv = await this.deps.collab.findInviteByHash(sha256(token));
    if (!inv) return none;
    const now = Date.now();
    const exhausted = inv.maxUses != null && inv.useCount >= inv.maxUses;
    const reason: InvitePreview['reason'] = inv.trip.deletedAt ? 'TRIP_DELETED' : inv.revokedAt ? 'REVOKED'
      : new Date(inv.expiresAt).getTime() <= now ? 'EXPIRED' : exhausted ? 'EXHAUSTED' : 'OK';
    let alreadyMember = false;
    if (ctx) {
      const m = inv.trip.ownerId === ctx.userId ? null : await this.deps.collab.findMembership(inv.tripId, ctx.userId);
      alreadyMember = inv.trip.ownerId === ctx.userId || m?.status === 'ACTIVE';
    }
    return {
      valid: reason === 'OK', reason, trip_name: inv.trip.name, start_date: inv.trip.start, day_count: inv.trip.dayCount,
      role: inv.role, expires_at: inv.expiresAt, already_member: alreadyMember
    };
  }

  async acceptInvite(ctx: RequestContext, token: string, displayName: string | null): Promise<InviteAccept> {
    // 유효성을 미리 읽으면 마지막 자리·취소와 경합한다. 판정과 저장은 잠근 행을 보는 같은 트랜잭션에서 한다.
    return this.deps.collab.acceptInvite({ tokenHash: sha256(token ?? ''), userId: ctx.userId, displayName: trimTo(displayName, 40) });
  }

  // ── 후보 ──

  async listCandidates(ctx: RequestContext, clientId: string): Promise<CandidateView[]> {
    const view = await this.tripFor(ctx, clientId);
    return this.deps.collab.listCandidates(view.record.id, ctx.userId);
  }

  async addCandidate(ctx: RequestContext, clientId: string, input: CandidateInput): Promise<number> {
    const title = trimTo(input?.title, 120);
    if (!title) throw new ApiError('VALIDATION_ERROR', { message: '후보에는 이름이 있어야 합니다.' });
    const view = await this.tripFor(ctx, clientId);
    if (!canEdit(view.role)) throw new ApiError('FORBIDDEN', { message: '보기 권한으로는 후보를 추가할 수 없습니다.' });
    // 누락된 좌표는 둘 다 null이다. 빈 문자열·불리언을 0으로 바꿔 실제 위치처럼 저장하지 않는다.
    const hasLocation = input.lat != null || input.lng != null;
    if (hasLocation && (typeof input.lat !== 'number' || !Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90 ||
      typeof input.lng !== 'number' || !Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180)) {
      throw new ApiError('VALIDATION_ERROR', { message: '후보의 위치가 올바르지 않습니다.' });
    }
    const provider = input.provider ?? null;
    const providerId = input.providerId ?? null;
    if (input.clientKey != null && (typeof input.clientKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.clientKey))) {
      throw new ApiError('VALIDATION_ERROR', { message: '담기 요청 키는 UUID여야 합니다.' });
    }
    const clientKey = input.clientKey?.toLowerCase() ?? null;
    if ((provider !== null && provider !== 'kakao' && provider !== 'google') ||
      (providerId !== null && (typeof providerId !== 'string' || !provider ||
        !(provider === 'kakao' ? /^\d{1,20}$/ : /^[A-Za-z0-9_-]{5,200}$/).test(providerId)))) {
      throw new ApiError('VALIDATION_ERROR', { message: '장소 제공자와 장소 ID가 올바르지 않습니다.' });
    }
    const placeId = trimTo(input.place_id, 200);
    if ((provider === 'kakao' && placeId) || (provider === 'google' && providerId && placeId && placeId !== providerId)) {
      throw new ApiError('VALIDATION_ERROR', { message: '장소 제공자별 ID가 서로 맞지 않습니다.' });
    }
    return this.deps.collab.addCandidate(view.record.id, ctx.userId, {
      title, provider, providerId, clientKey, place_id: provider === 'google' ? providerId ?? placeId : placeId,
      lat: input.lat ?? null, lng: input.lng ?? null,
      addr: trimTo(input.addr, 200), note: trimTo(input.note, 300), url: trimTo(input.url, 500),
      category: normalizeCandidateCategory(input.category)
    });
  }

  private async candidateIn(view: TripView, candidateId: number) {
    const c = await this.deps.collab.findCandidate(candidateId);
    return c && c.tripId === view.record.id ? c : null;
  }

  async reactToCandidate(ctx: RequestContext, clientId: string, candidateId: number, reaction: string | null): Promise<boolean> {
    const view = await this.tripFor(ctx, clientId);
    if (!(await this.candidateIn(view, candidateId))) throw new ApiError('NOT_FOUND', { message: '그 후보를 찾을 수 없습니다.' });
    const r = String(reaction ?? '').trim().toUpperCase() || null;
    if (r && !REACTIONS.includes(r)) throw new ApiError('VALIDATION_ERROR', { message: '반응은 MUST · OK · PASS 중 하나입니다.' });
    await this.deps.collab.setReaction(candidateId, ctx.userId, r);
    return true;
  }

  async manageCandidate(ctx: RequestContext, clientId: string, candidateId: number, action: CandidateAction, value: string | null): Promise<boolean> {
    const view = await this.tripFor(ctx, clientId);
    const c = await this.candidateIn(view, candidateId);
    if (!c) return false;
    if (action === 'REMOVE') {
      if (ctx.userId !== c.proposedBy && ctx.userId !== view.record.ownerId) throw new ApiError('FORBIDDEN', { message: '후보는 제안한 사람이나 주최자만 지울 수 있습니다.' });
      await this.deps.collab.removeCandidate(c.id);
      return true;
    }
    if (!canEdit(view.role)) throw new ApiError('FORBIDDEN', { message: '보기 권한으로는 후보 상태를 바꿀 수 없습니다.' });
    if (action === 'SCHEDULE') { await this.deps.collab.setCandidateStatus(c.id, 'SCHEDULED', trimTo(value, 40), ctx.userId); return true; }
    if (action === 'UNSCHEDULE' || action === 'REOPEN') { await this.deps.collab.setCandidateStatus(c.id, 'PROPOSED', null, ctx.userId); return true; }
    if (action === 'REJECT') { await this.deps.collab.setCandidateStatus(c.id, 'REJECTED', null, ctx.userId); return true; }
    if (action === 'CATEGORY') {
      // 빈 값은 '아직 고르지 않음'으로 되돌린다. 모르는 값은 조용히 삼키지 않고 거절한다 —
      // 담을 때와 달리 여기서는 분류가 요청의 전부라, 떨어뜨리면 아무 일도 안 한 것이 된다.
      const raw = (value ?? '').trim();
      const category = raw === '' ? null : normalizeCandidateCategory(raw);
      if (raw !== '' && category === null) throw new ApiError('VALIDATION_ERROR', { message: '모르는 분류입니다.' });
      await this.deps.collab.setCandidateCategory(c.id, category);
      return true;
    }
    throw new ApiError('VALIDATION_ERROR', { message: 'action은 REMOVE · SCHEDULE · UNSCHEDULE · REJECT · REOPEN · CATEGORY 중 하나입니다.' });
  }

  // ── 코멘트 ──

  async listComments(ctx: RequestContext, clientId: string, candidateId: number): Promise<CommentView[]> {
    const view = await this.tripFor(ctx, clientId);
    if (!(await this.candidateIn(view, candidateId))) throw new ApiError('NOT_FOUND', { message: '그 후보를 찾을 수 없습니다.' });
    return this.deps.collab.listComments(candidateId, ctx.userId);
  }

  async addComment(ctx: RequestContext, clientId: string, candidateId: number, body: string): Promise<number> {
    const text = trimTo(body, 500);
    if (!text) throw new ApiError('VALIDATION_ERROR', { message: '빈 코멘트는 남길 수 없습니다.' });
    const view = await this.tripFor(ctx, clientId);
    if (!(await this.candidateIn(view, candidateId))) throw new ApiError('NOT_FOUND', { message: '그 후보를 찾을 수 없습니다.' });
    return this.deps.collab.addComment(view.record.id, candidateId, ctx.userId, text);
  }

  async deleteComment(ctx: RequestContext, clientId: string, commentId: number): Promise<boolean> {
    const view = await this.tripFor(ctx, clientId);
    const cm = await this.deps.collab.findComment(commentId);
    if (!cm || cm.tripId !== view.record.id) return false;
    if (ctx.userId !== cm.userId && ctx.userId !== view.record.ownerId) throw new ApiError('FORBIDDEN', { message: '코멘트는 쓴 사람이나 주최자만 지울 수 있습니다.' });
    return this.deps.collab.deleteComment(commentId);
  }

  // ── 활동 · 취향 ──

  async listActivity(ctx: RequestContext, clientId: string, limit: number | null): Promise<ActivityView[]> {
    const view = await this.tripFor(ctx, clientId);
    return this.deps.collab.listActivity(view.record.id, ctx.userId, limit ?? 40);
  }

  async listPreferences(ctx: RequestContext, clientId: string): Promise<PreferenceView[]> {
    const view = await this.tripFor(ctx, clientId);
    return this.deps.collab.listPreferences(view.record.id, ctx.userId);
  }

  /** 화면(collab.js normPrefs)과 같은 화이트리스트 — 미리보기와 저장본이 갈리지 않는다 */
  async setPreference(ctx: RequestContext, clientId: string, prefs: unknown): Promise<Record<string, unknown>> {
    const view = await this.tripFor(ctx, clientId);
    const normalized = collab.normPrefs(prefs) as Record<string, unknown>;
    const ok = await this.deps.collab.setPreference(view.record.id, ctx.userId, normalized);
    if (!ok) throw new ApiError('FORBIDDEN', { message: '활성 멤버만 취향을 남길 수 있습니다.' });
    return normalized;
  }
}
