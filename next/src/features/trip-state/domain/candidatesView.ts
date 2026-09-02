// 후보 보드를 **계약 모양으로** 만든다. todayView.ts가 Today에 하는 일을 함께하기에 하는 자리다.
//
// 판단은 전부 `collab.js`가 한다 — 묶음(groupCandidates) · 배지 문장(candidateVerdict) ·
// 충돌 선택지(candidateConflict/conflictOptions) · 그룹 제안(buildGroupProposal) · 취향 요약(groupContext).
// 여기서 규칙을 새로 만들면 웹과 iOS의 답이 갈린다(§8). 이 파일은 이름만 바꿔 담는다.
//
// ⚠️ 합의 점수(0~100)는 **내보내지 않는다**(§21·§22). 계약에 필드 자체가 없고, 테스트가 문장에 숫자가 없음을 확인한다.
import collab from '@legacy/collab.js';

import type {
  ActivityEntry, ActivityListResponse, CandidateBoardResponse, CandidateComment, CandidateConflict,
  CandidateGroup, CandidateGroupKey, CandidateReactor, CommentListResponse, GroupProposal,
  MemberPreference, MemberPreferenceRow, PreferenceResponse, ReactionKind, TripCandidate
} from './contract';
import { CONTRACT_SCHEMA_VERSION } from './contract';

/** list_trip_candidates 한 줄 (RPC가 주는 그대로) */
export interface CandidateRow {
  id: number | string;
  title?: string | null;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  addr?: string | null;
  note?: string | null;
  url?: string | null;
  status?: string | null;
  scheduled_ref?: string | null;
  proposed_by_label?: string | null;
  mine?: boolean;
  my_reaction?: string | null;
  must_count?: number;
  ok_count?: number;
  pass_count?: number;
  reactions?: Array<{ name?: string | null; reaction?: string | null; me?: boolean }> | null;
  comment_count?: number;
  created_at?: string;
}

/** list_candidate_comments 한 줄 */
export interface CommentRow {
  id: number | string;
  body?: string | null;
  author_label?: string | null;
  mine?: boolean;
  created_at?: string;
}

/** list_trip_preferences 한 줄 */
export interface PrefRow {
  label?: string | null;
  mine?: boolean;
  prefs?: unknown;
}

/** list_trip_activity 한 줄 */
export interface ActivityRow {
  id: number | string;
  kind?: string | null;
  mine?: boolean;
  actor_label?: string | null;
  member_label?: string | null;
  subject?: unknown;
  created_at?: string;
}

/** 일정에서 그룹 제안이 어느 날을 고를지 볼 때 쓰는 최소 모양 */
export interface ProposalDay {
  spots?: Array<{ name?: string; lat?: number | null; lng?: number | null } | null>;
}

const GROUP_TITLE: Record<CandidateGroupKey, string> = {
  NEEDS_OPINION: '의견이 필요해요',
  LOVED: '다들 좋아해요',
  RESTING: '아직 끌리는 사람이 없어요',
  SCHEDULED: '일정에 넣었어요',
  REJECTED: '이번엔 뺐어요'
};

/** 보드의 순서. **결정하지 못한 것이 맨 위다** — 순위가 아니라 어디에 한마디가 필요한지다(§57·§58) */
const GROUP_ORDER: CandidateGroupKey[] = ['NEEDS_OPINION', 'LOVED', 'RESTING', 'SCHEDULED', 'REJECTED'];

function str(v: unknown): string { return v == null ? '' : String(v); }
function nullableStr(v: unknown): string | null { const s = str(v).trim(); return s || null; }

function statusOf(row: CandidateRow): TripCandidate['status'] {
  const s = str(row.status).toUpperCase();
  return s === 'SCHEDULED' || s === 'REJECTED' ? s : 'PROPOSED';
}

function reactorsOf(row: CandidateRow): CandidateReactor[] {
  const list = Array.isArray(row.reactions) ? row.reactions : [];
  const out: CandidateReactor[] = [];
  for (const r of list) {
    const kind = collab.normReaction(r?.reaction);
    if (!kind) continue;
    out.push({ name: str(r?.name).trim() || '멤버', reaction: kind as ReactionKind, me: !!r?.me });
  }
  return out;
}

/** 좌표는 둘 다 있을 때만 — 반쪽 좌표로 지도에 점을 찍지 않는다 */
function locationOf(row: CandidateRow) {
  const lat = Number(row.lat), lng = Number(row.lng);
  if (row.lat == null || row.lng == null || !isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng };
}

function conflictOf(row: CandidateRow, memberCount: number): CandidateConflict | null {
  const c = collab.candidateConflict(row, memberCount);
  if (!c) return null;
  return { must: c.must, ok: c.ok, pass: c.pass, options: collab.conflictOptions(c) };
}

/** 한 후보를 계약 모양으로. role은 '뺄 수 있는가'를 가르는 데만 쓴다(역할이 아니라 누가 냈는가가 기준이다) */
export function toCandidate(row: CandidateRow, memberCount: number, role: string | null): TripCandidate {
  const verdict = collab.candidateVerdict(row, memberCount);
  return {
    id: String(row.id),
    title: str(row.title).trim() || '후보',
    placeId: nullableStr(row.place_id),
    location: locationOf(row),
    addr: nullableStr(row.addr),
    note: nullableStr(row.note),
    url: nullableStr(row.url),
    status: statusOf(row),
    scheduledRef: nullableStr(row.scheduled_ref),
    proposedBy: collab.candidateAttribution(row),
    mine: !!row.mine,
    myReaction: (collab.normReaction(row.my_reaction) as ReactionKind | null) ?? null,
    reactionSummary: collab.reactionSummary(row, memberCount),
    reactors: reactorsOf(row),
    commentCount: Math.max(0, Number(row.comment_count) || 0),
    verdict: { text: verdict.text, tone: verdict.tone },
    conflict: conflictOf(row, memberCount),
    createdAt: str(row.created_at),
    canRemove: collab.canRemoveCandidate(role, row)
  };
}

function proposalOf(rows: CandidateRow[], days: ProposalDay[], memberCount: number, prefRows: PrefRow[]): GroupProposal | null {
  const ctx = collab.groupContext(prefRows, memberCount);
  const built = collab.buildGroupProposal(rows, days, memberCount, { walking: ctx.walking }, 3);
  if (!built) return null;
  return {
    headline: built.headline,
    picks: built.picks.map((p) => ({
      candidateId: String(p.candidate.id),
      title: str(p.candidate.title).trim() || '후보',
      dayIndex: p.di,
      distanceKm: p.km,
      reasons: p.reasons
    }))
  };
}

export interface BoardInput {
  tripId: string;
  rows: CandidateRow[];
  prefRows: PrefRow[];
  days: ProposalDay[];
  role: string | null;
  memberCount: number;
}

/**
 * 보드 하나. 묶음·배지·충돌·제안·취향 요약을 한 번에 준다 — 여행 중 왕복 횟수가 곧 체감 속도다.
 * 정렬은 `sortCandidates`의 최근 순 하나만 쓴다: '관심 순'은 화면의 선택이고 계약이 정할 일이 아니다(§12).
 */
export function buildCandidateBoard(input: BoardInput): CandidateBoardResponse {
  const memberCount = Math.max(1, Number(input.memberCount) || 1);
  const role = input.role;
  const sorted = collab.sortCandidates(input.rows, 'recent', memberCount) as CandidateRow[];
  const grouped = collab.groupCandidates(sorted, memberCount);
  const bucket: Record<CandidateGroupKey, CandidateRow[]> = {
    NEEDS_OPINION: grouped.needsOpinion as CandidateRow[],
    LOVED: grouped.loved as CandidateRow[],
    RESTING: grouped.resting as CandidateRow[],
    SCHEDULED: grouped.scheduled as CandidateRow[],
    REJECTED: grouped.rejected as CandidateRow[]
  };
  const groups: CandidateGroup[] = [];
  for (const key of GROUP_ORDER) {
    const rows = bucket[key];
    if (!rows.length) continue;                       // 빈 묶음은 내보내지 않는다 — 화면에 빈 제목만 남는다
    groups.push({ key, title: GROUP_TITLE[key], candidates: rows.map((r) => toCandidate(r, memberCount, role)) });
  }
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    tripId: input.tripId,
    role: (collab.normRole(role) as CandidateBoardResponse['role']) ?? null,
    memberCount,
    canPropose: role == null ? true : collab.canPropose(role),
    canReact: role == null ? true : collab.canReact(role),
    groups,
    proposal: proposalOf(sorted, input.days, memberCount, input.prefRows),
    groupContext: collab.groupContextText(collab.groupContext(input.prefRows, memberCount))
  };
}

export function buildComments(candidateId: string, rows: CommentRow[], role: string | null): CommentListResponse {
  const comments: CandidateComment[] = (Array.isArray(rows) ? rows : []).filter(Boolean).map((r) => ({
    id: String(r.id),
    body: str(r.body),
    authorLabel: str(r.author_label).trim() || '멤버',
    mine: !!r.mine,
    createdAt: str(r.created_at),
    canDelete: collab.canDeleteComment(role, r)
  }));
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    candidateId,
    canComment: role == null ? true : collab.canComment(role),
    comments
  };
}

/** 서버가 아는 값만 남은 취향을 계약 모양으로. 빈 배열과 없는 값은 null·[]로 고르게 편다 */
export function toPreference(raw: unknown): MemberPreference {
  const p = collab.normPrefs(raw);
  return {
    pace: p.pace ?? null,
    walking: p.walking ?? null,
    morning: typeof p.morning === 'boolean' ? p.morning : null,
    night: typeof p.night === 'boolean' ? p.night : null,
    interests: p.interests ?? [],
    dislikes: p.dislikes ?? [],
    note: p.note ?? null
  };
}

export function buildPreferences(rows: PrefRow[], memberCount: number): PreferenceResponse {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const members: MemberPreferenceRow[] = list.map((r) => ({
    name: r.mine ? '나' : (str(r.label).trim() || '멤버'),
    mine: !!r.mine,
    summary: collab.prefsText(r.prefs),
    prefs: toPreference(r.prefs)
  }));
  const mineRow = list.find((r) => r.mine);
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    mine: toPreference(mineRow?.prefs),
    members,
    groupContext: collab.groupContextText(collab.groupContext(list, memberCount))
  };
}

/**
 * 활동 피드. 묶기(condenseActivity)와 문장 만들기(activityText)를 서버에서 끝낸다 —
 * 같은 목록을 웹과 iOS가 다르게 읽으면 안 된다. 문장을 못 만드는 종류는 아예 뺀다(§37).
 */
export function buildActivity(rows: ActivityRow[], now: number): ActivityListResponse {
  const condensed = collab.condenseActivity(rows, undefined) as ActivityRow[];
  const entries: ActivityEntry[] = [];
  for (const ev of condensed) {
    const text = collab.activityText(ev);
    if (!text) continue;
    entries.push({
      id: String(ev.id),
      text,
      mine: !!ev.mine,
      at: str(ev.created_at),
      relative: collab.relativeTime(ev.created_at, now)
    });
  }
  return { schemaVersion: CONTRACT_SCHEMA_VERSION, entries };
}
