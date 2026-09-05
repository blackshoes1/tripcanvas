// 협업(함께하기) API 계약 — 라우트가 보는 유일한 인터페이스. 구현이 둘이다:
//   CollabService              새 PostgreSQL. 인가는 application이 판정한다(§41)
//   LegacySupabaseCollabService Supabase RPC 1:1. 판정은 아직 RPC(security definer)가 한다
// 응답 모양은 RPC 반환형과 같다(snake_case) — 웹이 RPC에서 API로 옮겨 탈 때 화면 코드가 바뀌지 않게.
import type { RequestContext } from '../../auth/types';

export interface MemberView {
  id: number; user_id: string; role: string; status: string; display_name: string | null; joined_at: string | null; me: boolean;
}
export type MemberAction = 'SET_ROLE' | 'REMOVE' | 'RENAME';

export interface InviteView {
  id: number; role: string; expires_at: string; use_count: number; max_uses: number | null; created_at: string; active: boolean;
}
export interface InviteCreated { id: number; token: string; role: string; expires_at: string }
export type InviteReason = 'OK' | 'INVALID' | 'TRIP_DELETED' | 'REVOKED' | 'EXPIRED' | 'EXHAUSTED' | 'REMOVED';
export interface InvitePreview {
  valid: boolean; reason: InviteReason; trip_name: string | null; start_date: string | null; day_count: number | null;
  role: string | null; expires_at: string | null; already_member: boolean;
}
export interface InviteAccept {
  ok: boolean; reason: InviteReason; client_id: string | null; trip_name: string | null; role: string | null; already_member: boolean;
}

export interface CandidateInput {
  title: string; place_id?: string | null; lat?: number | null; lng?: number | null; addr?: string | null; note?: string | null; url?: string | null;
}
export interface CandidateView {
  id: number; title: string; place_id: string | null; lat: number | null; lng: number | null; addr: string | null; note: string | null;
  url: string | null; status: string; scheduled_ref: string | null; proposed_by_label: string; mine: boolean; my_reaction: string | null;
  must_count: number; ok_count: number; pass_count: number;
  /** user_id는 분리 일정이 누가 어느 쪽인지 가르는 데 쓴다(이름으로 가르면 동명이인이 섞인다). 이메일은 없다(§69) */
  reactions: { user_id: string; name: string; reaction: string; me: boolean }[];
  comment_count: number; created_at: string;
}
export type CandidateAction = 'REMOVE' | 'SCHEDULE' | 'UNSCHEDULE' | 'REJECT' | 'REOPEN';
export type Reaction = 'MUST' | 'OK' | 'PASS';

export interface CommentView { id: number; body: string; author_label: string; mine: boolean; created_at: string }

export interface ActivityView {
  id: number; kind: string; actor_label: string; mine: boolean; member_label: string | null; subject: Record<string, unknown>; created_at: string;
}

export interface PreferenceView { user_id: string; label: string; role: string; mine: boolean; prefs: Record<string, unknown> }

export interface CollabApi {
  listMembers(ctx: RequestContext, clientId: string): Promise<MemberView[]>;
  /** SET_ROLE·REMOVE는 소유자만, RENAME은 본인이나 소유자. 소유자 행은 잠겨 있다. 없는 멤버면 false */
  manageMember(ctx: RequestContext, clientId: string, memberId: number, action: MemberAction, value: string | null): Promise<boolean>;
  /** 소유자가 아닌 멤버만. 이미 나갔거나 멤버가 아니면 그대로 true */
  leave(ctx: RequestContext, clientId: string): Promise<boolean>;

  createInvite(ctx: RequestContext, clientId: string, role: string, hours: number | null, maxUses: number | null): Promise<InviteCreated>;
  listInvites(ctx: RequestContext, clientId: string): Promise<InviteView[]>;
  revokeInvite(ctx: RequestContext, clientId: string, inviteId: number): Promise<boolean>;
  /** 로그인 전에도 부른다 — 이름·시작일·일수·역할까지만 */
  previewInvite(token: string, ctx: RequestContext | null): Promise<InvitePreview>;
  acceptInvite(ctx: RequestContext, token: string, displayName: string | null): Promise<InviteAccept>;

  listCandidates(ctx: RequestContext, clientId: string): Promise<CandidateView[]>;
  addCandidate(ctx: RequestContext, clientId: string, input: CandidateInput): Promise<number>;
  /** null이면 거두기. 활성 멤버 전원(VIEWER 포함) */
  reactToCandidate(ctx: RequestContext, clientId: string, candidateId: number, reaction: string | null): Promise<boolean>;
  manageCandidate(ctx: RequestContext, clientId: string, candidateId: number, action: CandidateAction, value: string | null): Promise<boolean>;

  listComments(ctx: RequestContext, clientId: string, candidateId: number): Promise<CommentView[]>;
  addComment(ctx: RequestContext, clientId: string, candidateId: number, body: string): Promise<number>;
  deleteComment(ctx: RequestContext, clientId: string, commentId: number): Promise<boolean>;

  listActivity(ctx: RequestContext, clientId: string, limit: number | null): Promise<ActivityView[]>;

  listPreferences(ctx: RequestContext, clientId: string): Promise<PreferenceView[]>;
  setPreference(ctx: RequestContext, clientId: string, prefs: unknown): Promise<Record<string, unknown>>;
}
