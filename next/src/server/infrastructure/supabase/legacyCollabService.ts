// 레거시 경로(COLLAB=LEGACY) — Supabase RPC 21종을 CollabApi 모양으로 1:1 감싼다. 판정은 아직 RPC(security definer)가 하고,
// 여기서는 오류 코드만 계약으로 옮긴다: 42501 → FORBIDDEN(hint를 문장으로) · 22023 → VALIDATION_ERROR.
// 웹이 RPC에서 API로 옮겨 탈 때(PR12) 데이터가 아직 Supabase에 있어도 같은 계약으로 동작하게 하는 다리다.
// 차이 하나: RPC는 남의 여행을 '빈 목록'/42501로 답한다 — 새 backend의 NOT_FOUND와 다르다(문서화).
import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type {
  ActivityView, CandidateAction, CandidateInput, CandidateView, CollabApi, CommentView, InviteAccept, InviteCreated,
  InvitePreview, InviteView, MemberAction, MemberView, PreferenceView
} from '../../application/collaboration/types';
import { supabaseForToken } from './legacyTripRepository';

interface RpcError { code?: unknown; hint?: unknown; message?: unknown; status?: unknown }

function mapError(e: RpcError): ApiError {
  const code = String(e.code ?? '');
  const hint = typeof e.hint === 'string' && e.hint ? e.hint : undefined;
  if (code === '42501' || Number(e.status) === 403 || /TRIP_FORBIDDEN|OWNER_/.test(String(e.message ?? ''))) return new ApiError('FORBIDDEN', hint ? { message: hint } : {});
  if (code === '22023') return new ApiError('VALIDATION_ERROR', hint ? { message: hint } : {});
  return new ApiError('INTERNAL_ERROR');
}

export class LegacySupabaseCollabService implements CollabApi {
  private readonly sb: SupabaseClient;
  /** token이 비어 있으면 익명 클라이언트(초대 미리보기만 된다) */
  constructor(token: string, supabaseUrl: string) {
    this.sb = supabaseForToken(token, supabaseUrl);
  }

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(name, args);
    if (error) throw mapError(error as RpcError);
    return data as T;
  }
  private async rpcRow<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const data = await this.rpc<T | T[]>(name, args);
    const row = Array.isArray(data) ? data[0] : data;
    if (row == null) throw new ApiError('INTERNAL_ERROR');
    return row;
  }
  private async rpcList<T>(name: string, args: Record<string, unknown>): Promise<T[]> {
    const data = await this.rpc<T[] | null>(name, args);
    return Array.isArray(data) ? data : [];
  }

  listMembers(_ctx: RequestContext, clientId: string): Promise<MemberView[]> {
    return this.rpcList('list_trip_members', { p_client_id: clientId });
  }
  manageMember(_ctx: RequestContext, _clientId: string, memberId: number, action: MemberAction, value: string | null): Promise<boolean> {
    return this.rpc('manage_trip_member', { p_member_id: memberId, p_action: action, p_value: value });
  }
  leave(_ctx: RequestContext, clientId: string): Promise<boolean> {
    return this.rpc('leave_trip', { p_client_id: clientId });
  }

  createInvite(_ctx: RequestContext, clientId: string, role: string, hours: number | null, maxUses: number | null): Promise<InviteCreated> {
    return this.rpcRow('create_trip_invite', { p_client_id: clientId, p_role: role, p_hours: hours ?? 168, p_max_uses: maxUses });
  }
  listInvites(_ctx: RequestContext, clientId: string): Promise<InviteView[]> {
    return this.rpcList('list_trip_invites', { p_client_id: clientId });
  }
  revokeInvite(_ctx: RequestContext, _clientId: string, inviteId: number): Promise<boolean> {
    return this.rpc('revoke_trip_invite', { p_invite_id: inviteId });
  }
  previewInvite(token: string): Promise<InvitePreview> {
    return this.rpcRow('invite_preview', { p_token: token });
  }
  acceptInvite(_ctx: RequestContext, token: string, displayName: string | null): Promise<InviteAccept> {
    return this.rpcRow('accept_trip_invite', { p_token: token, p_display_name: displayName });
  }

  listCandidates(_ctx: RequestContext, clientId: string): Promise<CandidateView[]> {
    return this.rpcList('list_trip_candidates', { p_client_id: clientId });
  }
  addCandidate(_ctx: RequestContext, clientId: string, input: CandidateInput): Promise<number> {
    return this.rpc<number | string>('add_trip_candidate', {
      p_client_id: clientId, p_title: input.title, p_place_id: input.place_id ?? null, p_lat: input.lat ?? null, p_lng: input.lng ?? null,
      p_addr: input.addr ?? null, p_note: input.note ?? null, p_url: input.url ?? null
    }).then(Number);
  }
  reactToCandidate(_ctx: RequestContext, _clientId: string, candidateId: number, reaction: string | null): Promise<boolean> {
    return this.rpc('react_to_candidate', { p_candidate_id: candidateId, p_reaction: reaction });
  }
  manageCandidate(_ctx: RequestContext, _clientId: string, candidateId: number, action: CandidateAction, value: string | null): Promise<boolean> {
    return this.rpc('manage_trip_candidate', { p_candidate_id: candidateId, p_action: action, p_value: value });
  }

  listComments(_ctx: RequestContext, _clientId: string, candidateId: number): Promise<CommentView[]> {
    return this.rpcList('list_candidate_comments', { p_candidate_id: candidateId });
  }
  addComment(_ctx: RequestContext, _clientId: string, candidateId: number, body: string): Promise<number> {
    return this.rpc<number | string>('add_candidate_comment', { p_candidate_id: candidateId, p_body: body }).then(Number);
  }
  deleteComment(_ctx: RequestContext, _clientId: string, commentId: number): Promise<boolean> {
    return this.rpc('delete_candidate_comment', { p_comment_id: commentId });
  }

  listActivity(_ctx: RequestContext, clientId: string, limit: number | null): Promise<ActivityView[]> {
    return this.rpcList('list_trip_activity', { p_client_id: clientId, p_limit: limit ?? 40 });
  }
  listPreferences(_ctx: RequestContext, clientId: string): Promise<PreferenceView[]> {
    return this.rpcList('list_trip_preferences', { p_client_id: clientId });
  }
  async setPreference(_ctx: RequestContext, clientId: string, prefs: unknown): Promise<Record<string, unknown>> {
    const out = await this.rpc<unknown>('set_trip_preference', { p_client_id: clientId, p_prefs: prefs });
    return out && typeof out === 'object' ? (out as Record<string, unknown>) : {};
  }
}
