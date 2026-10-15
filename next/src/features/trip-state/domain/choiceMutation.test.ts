import { describe, expect, it } from 'vitest';

import { applyActivityStatus } from './mutations';
import type { TripDoc } from './todayView';

describe('choice slot execution boundary', () => {
  const pending = (): TripDoc => ({ days: [{ spots: [{ name: '미술관', choice: {
    version: 1, state: 'PENDING', alternative: { name: '강변 산책' }
  } }] }] });
  it('미정인 장소를 완료하거나 건너뛰지 않고 선택 화면으로 안내할 수 있는 이유를 보낸다', () => {
    for (const status of ['COMPLETED', 'SKIPPED'] as const) {
      const doc = pending();
      const result = applyActivityStatus(doc, 'd0s0', status, '미술관');
      expect(result).toMatchObject({ ok: false, applied: false, error: 'CHOICE_PENDING' });
      expect(result.trip).toBe(doc);
      expect(doc.days![0].spots![0].status).toBeUndefined();
    }
  });
  it('선택한 장소는 정상적으로 완료하고 다른 선택지는 보존한다', () => {
    const doc = pending();
    doc.days![0].spots![0].choice!.state = 'SELECTED';
    const result = applyActivityStatus(doc, 'd0s0', 'COMPLETED', '미술관');
    expect(result).toMatchObject({ ok: true, applied: true });
    expect(result.trip.days![0].spots![0]).toMatchObject({ status: 'COMPLETED', choice: { state: 'SELECTED', alternative: { name: '강변 산책' } } });
    expect(doc.days![0].spots![0].status).toBeUndefined();
  });
  it('선택지 미정이어도 상태 초기화는 멱등이고 이름이 바뀌면 이전 요청을 받지 않는다', () => {
    const doc = pending();
    expect(applyActivityStatus(doc, 'd0s0', 'PLANNED')).toMatchObject({ ok: true, alreadyApplied: true });
    expect(applyActivityStatus(doc, 'd0s0', 'COMPLETED', '옛 이름')).toMatchObject({ ok: false, error: 'NAME_MISMATCH' });
  });
});
