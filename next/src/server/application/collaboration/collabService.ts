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
import type {
  ActivityView, CandidateAction, CandidateInput, CandidateView, CollabApi, CommentView, InviteAccept, InviteCreated,
  InvitePreview, InviteView, MemberAction, MemberView, PreferenceView
} from './types';

const ROLES = ['EDITOR', 'VIEWER'];
const REACTIONS = ['MUST', 'OK', 'PASS'];
const canEdit = (role: string) => role === 'OWNER' || role === 'EDITOR';

const trimTo = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null;
};
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
    const fail = (reason: InviteAccept['reason']): InviteAccept => ({ ok: false, reason, client_id: null, trip_name: null, role: null, already_member: false });
    const name = trimTo(displayName, 40);
    const inv = await this.deps.collab.findInviteByHash(sha256(token ?? ''));
    if (!inv) return fail('INVALID');
    if (inv.trip.deletedAt) return fail('TRIP_DELETED');
    const done = (role: string, already: boolean): InviteAccept => ({ ok: true, reason: 'OK', client_id: inv.trip.clientId, trip_name: inv.trip.name, role, already_member: already });
    if (inv.trip.ownerId === ctx.userId) return done('OWNER', true);   // 소유자가 제 링크를 열었다
    const mem = await this.deps.collab.findMembership(inv.tripId, ctx.userId);
    if (mem?.status === 'ACTIVE') return done(mem.role, true);
    // 링크의 유효성은 새 참여에만 따진다
    if (inv.revokedAt) return fail('REVOKED');
    if (new Date(inv.expiresAt).getTime() <= Date.now()) return fail('EXPIRED');
    if (inv.maxUses != null && inv.useCount >= inv.maxUses) return fail('EXHAUSTED');
    // 내보낸 사람은 그 전에 만든 링크로는 못 돌아온다(§70)
    if (mem?.status === 'REMOVED' && mem.updatedAt >= inv.createdAt) return fail('REMOVED');
    await this.deps.collab.acceptInvite({ inviteId: inv.id, tripId: inv.tripId, userId: ctx.userId, role: inv.role, displayName: name, invitedBy: inv.createdBy });
    return done(inv.role, false);
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
    const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    return this.deps.collab.addCandidate(view.record.id, ctx.userId, {
      title, place_id: trimTo(input.place_id, 200), lat: num(input.lat), lng: num(input.lng),
      addr: trimTo(input.addr, 200), note: trimTo(input.note, 300), url: trimTo(input.url, 500)
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
    throw new ApiError('VALIDATION_ERROR', { message: 'action은 REMOVE · SCHEDULE · UNSCHEDULE · REJECT · REOPEN 중 하나입니다.' });
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
