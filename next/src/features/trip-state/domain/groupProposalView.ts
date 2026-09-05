// 그룹 제안을 계약 모양으로(§28·§29·§35).
//
// **판정은 여기서 하지 않는다.** `collab.js`의 `buildGroupProposal`이 단일 출처이고, 이 파일은 그 결과를
// 계약 모양으로 옮기기만 한다 — `todayView.ts`가 `adaptive.js`에 대해 하는 일과 같다(§엔진은 하나다).
// Swift로 같은 규칙을 다시 만들면 웹과 앱이 같은 상황에서 서로 다른 답을 말하게 된다.
//
// ⚠️ 합의 점수(0~100)는 **내부값**이다(§21·§22) — 계약에 싣지 않는다. 나가는 것은 `reasons` 문장뿐이다.
// ⚠️ 이것은 **미리보기**다. 여기서는 아무것도 저장하지 않고, 사람이 수락해야 일정이 된다(§79).
import collab from '@legacy/collab.js';

import type { GroupProposalOption, GroupProposalPick, GroupProposalView } from './contract';

export interface ProposalInput {
  /** list_trip_candidates가 준 행 그대로 */
  candidates: unknown[];
  /** 여행 문서의 days — 좌표가 있는 마지막 장소로 가까운 날을 고른다 */
  days: unknown[];
  memberCount: number;
  /** trip_members.prefs 행. 없으면 취향 요약이 비어 나간다 */
  preferences?: unknown[];
  /** 한 번에 제안할 최대 개수. 기본 3 — 한 화면에 판단할 수 있는 만큼만(§79) */
  max?: number;
}

/** 사람이 빠져나갈 길은 늘 셋이다 — 자동 적용하지 않는다(§79·§36) */
const OPTIONS: GroupProposalOption[] = [
  { key: 'ACCEPT', label: '이대로 할래요' },
  { key: 'ADJUST', label: '조금 바꿀게요' },
  { key: 'DISMISS', label: '나중에' }
];

function pickOf(raw: { candidate: { id?: number | string; title?: string | null }; di: number; km: number | null; reasons: string[] }): GroupProposalPick | null {
  const id = Number(raw.candidate?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;   // id가 없으면 수락해도 표시를 되돌릴 수 없다
  return {
    candidateId: id,
    title: String(raw.candidate?.title ?? '').trim() || '가고 싶은 곳',
    dayIndex: raw.di,
    dayLabel: `Day ${raw.di + 1}`,
    reasons: (Array.isArray(raw.reasons) ? raw.reasons : []).map(String),
    distanceKm: raw.km == null ? null : Math.round(raw.km * 10) / 10
  };
}

/**
 * 제안할 것이 없으면 **null**이다 — 억지로 만들지 않는다(§79).
 * 반대가 있거나 한 명만 말한 후보는 `buildGroupProposal`이 애초에 걸러 낸다.
 */
export function buildGroupProposalView(input: ProposalInput): GroupProposalView | null {
  const members = Math.max(1, Number(input.memberCount) || 1);
  const ctx = collab.groupContext(input.preferences ?? [], members);
  const raw = collab.buildGroupProposal(input.candidates, input.days, members, ctx, input.max);
  if (!raw) return null;

  const picks = raw.picks.map(pickOf).filter((p): p is GroupProposalPick => p !== null);
  if (!picks.length) return null;

  return {
    summary: raw.headline,
    picks,
    impact: {
      spotsAdded: picks.length,
      daysTouched: new Set(picks.map((p) => p.dayIndex)).size
    },
    options: OPTIONS,
    // 취향을 아무도 남기지 않았으면 안내 문장 하나뿐이라 그건 싣지 않는다 — 제안 카드가 잔소리가 되지 않게.
    groupNotes: ctx.answered > 0 ? collab.groupContextText(ctx) : []
  };
}
