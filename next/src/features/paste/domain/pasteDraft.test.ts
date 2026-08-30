import { describe, expect, it } from 'vitest';

import type { Day, Trip } from '@/features/trip/domain/types';
import {
  applyDraft, draftFromAi, draftFromText, noLocCount, spotsNeedingCoords
} from './pasteDraft';

const IDS = { newId: 'tNEW', today: '2026-08-30' };

const SAMPLE = `여행이름: 경주 1박2일
시작일: 2026-08-01

[Day 1] 도착
이동: 🚄 서울 → 경주
- 경주역 | 경주 | KTX | 35.7965,129.1349
- (숙소) 힐튼 경주 | 경주

[Day 2] 둘째날
- 불국사 | 경주`;

const existing = (): Trip => ({
  id: 't1', name: '기존 여행', start: '2026-07-01',
  days: [{ title: '기존 Day', drive: '', note: '', mode: 'car', spots: [
    { name: '기존 장소', city: '서울', desc: '', lat: 37.5, lng: 127.0 }
  ] }]
});

describe('draftFromText', () => {
  it('직접 형식을 읽어 초안을 만든다', () => {
    const r = draftFromText(SAMPLE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.name).toBe('경주 1박2일');
      expect(r.draft.start).toBe('2026-08-01');
      expect(r.draft.days).toHaveLength(2);
      expect(r.draft.days[0].drive).toBe('🚄 서울 → 경주');
      expect(r.draft.days[0].spots[0].lat).toBeCloseTo(35.7965, 4);
      expect(r.draft.days[0].spots[1].stay).toBe(true);
    }
  });

  it('빈 입력은 이유를 말한다', () => {
    expect(draftFromText('   ').ok).toBe(false);
  });

  it('일자를 하나도 못 읽으면 초안이 아니다', () => {
    // 머리말만 있고 장소·일자가 없는 글
    const r = draftFromText('여행이름: 이름만 있음\n시작일: 2026-08-01');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/형식/);
  });

  it('이름이 없으면 기본 이름을 붙인다', () => {
    const r = draftFromText('- 어딘가 | 서울');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.name).toBe('붙여넣은 여행');
  });
});

describe('draftFromAi', () => {
  it('자유로운 모양도 눕혀서 받는다', () => {
    const r = draftFromAi({
      name: 'AI 여행', start: '2026-09-01',
      days: [{ title: '1일', mode: '순간이동', startAt: '아침',
        spots: [{ name: '경복궁', city: '서울', at: '10:00', cost: '3000' }] }]
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.days[0].mode).toBe('car');       // 알 수 없는 수단 → 기본값
      expect(r.draft.days[0].startAt).toBe('09:00');
      expect(r.draft.days[0].spots[0].at).toBe('10:00');
      expect(r.draft.days[0].spots[0].cost).toBe(3000);
    }
  });

  it('일자가 없으면 거절한다', () => {
    expect(draftFromAi({ name: 'x', days: [] }).ok).toBe(false);
    expect(draftFromAi(null).ok).toBe(false);
    expect(draftFromAi('그냥 문자열').ok).toBe(false);
  });

  it('장소 이름이 없는 항목은 조용히 버린다', () => {
    const r = draftFromAi({ days: [{ title: 'x', spots: [{ name: '' }, { name: '남대문' }] }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.days[0].spots).toHaveLength(1);
  });
});

describe('spotsNeedingCoords / noLocCount', () => {
  it('좌표 없는 장소를 골라낸다', () => {
    const r = draftFromText(SAMPLE);
    if (!r.ok) throw new Error('초안 실패');
    const need = spotsNeedingCoords(r.draft.days);
    expect(need.map(s => s.name)).toEqual(['힐튼 경주', '불국사']);
    expect(noLocCount(r.draft.days)).toBe(2);
  });

  it('좌표가 채워지면 대상에서 빠진다', () => {
    const days: Day[] = [{ title: '', drive: '', note: '', mode: 'car', spots: [
      { name: 'A', city: 'x', desc: '', lat: 1, lng: 2 },
      { name: 'B', city: 'x', desc: '', lat: null, lng: null }
    ] }];
    expect(spotsNeedingCoords(days).map(s => s.name)).toEqual(['B']);
  });
});

describe('applyDraft', () => {
  const draft = () => {
    const r = draftFromText(SAMPLE);
    if (!r.ok) throw new Error('초안 실패');
    return r.draft;
  };

  it('새 여행으로 — 새 id와 이름·시작일을 가져간다', () => {
    const r = applyDraft(existing(), draft(), 'new', IDS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trip.id).toBe('tNEW');
      expect(r.trip.name).toBe('경주 1박2일');
      expect(r.trip.start).toBe('2026-08-01');
      expect(r.trip.days).toHaveLength(2);
    }
  });

  it('여행이 없어도 새 여행은 만들 수 있다', () => {
    const r = applyDraft(null, draft(), 'new', IDS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trip.days).toHaveLength(2);
  });

  it('시작일이 없으면 오늘로', () => {
    const r = applyDraft(null, { name: 'x', start: '', days: draft().days }, 'new', IDS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trip.start).toBe('2026-08-30');
  });

  it('덧붙이기 — 기존 일자 뒤에 붙고 id·이름·시작일은 그대로', () => {
    const cur = existing();
    const r = applyDraft(cur, draft(), 'append', IDS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trip.id).toBe('t1');
      expect(r.trip.name).toBe('기존 여행');
      expect(r.trip.start).toBe('2026-07-01');       // 기존 시작일이 이긴다
      expect(r.trip.days).toHaveLength(3);
      expect(r.trip.days[0].spots[0].name).toBe('기존 장소');
      expect(r.trip.days[1].spots[0].name).toBe('경주역');
    }
  });

  it('덧붙이기 — 기존 시작일이 비었으면 초안 것을 쓴다', () => {
    const cur = { ...existing(), start: '' };
    const r = applyDraft(cur, draft(), 'append', IDS);
    if (r.ok) expect(r.trip.start).toBe('2026-08-01');
  });

  it('바꾸기 — 일자만 갈아끼우고 여행은 그대로 (id 유지)', () => {
    const cur = existing();
    const r = applyDraft(cur, draft(), 'overwrite', IDS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trip.id).toBe('t1');
      expect(r.trip.days).toHaveLength(2);
      expect(r.trip.days[0].spots[0].name).toBe('경주역');
      expect(r.trip.name).toBe('경주 1박2일');       // 초안 이름이 있으면 그것
    }
  });

  it('원본을 건드리지 않는다', () => {
    const cur = existing();
    applyDraft(cur, draft(), 'append', IDS);
    applyDraft(cur, draft(), 'overwrite', IDS);
    expect(cur.days).toHaveLength(1);
    expect(cur.name).toBe('기존 여행');
  });

  it('여행이 없으면 덧붙이기·바꾸기도 새 여행이 된다', () => {
    for (const t of ['append', 'overwrite'] as const) {
      const r = applyDraft(null, draft(), t, IDS);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.trip.id).toBe('tNEW');
    }
  });

  it('합친 결과가 한도를 넘으면 반쪽이 아니라 통째로 거절한다', () => {
    // 일자 한도(90)를 넘기도록 덧붙인다 — 부분 적용되면 여행이 조용히 잘린다
    const cur: Trip = { ...existing(), days: Array.from({ length: 88 }, () => ({
      title: '', drive: '', note: '', mode: 'car' as const, spots: []
    })) };
    const big = { name: 'x', start: '', days: Array.from({ length: 10 }, () => ({
      title: '', drive: '', note: '', mode: 'car' as const, spots: []
    })) };
    const r = applyDraft(cur, big, 'append', IDS);
    expect(r.ok).toBe(false);
    expect(cur.days).toHaveLength(88);            // 원본은 그대로
  });
});
