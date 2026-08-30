import { describe, expect, it } from 'vitest';

import type { PriceRecord } from './types';
import { mergePriceSnapshots, trackedHotelIds, type PriceSnapshotRow } from './priceSync';

const rec = (over: Partial<PriceRecord> = {}): PriceRecord =>
  ({ obs: [], offers: [], at: null, err: null, basis: null, ...over });

const row = (over: Partial<PriceSnapshotRow> = {}): PriceSnapshotRow => ({
  booking_id: 'b1', seller: '아고다', price: 180000, currency: 'KRW',
  quality: 'EXACT', verified: true, offers: null, observed_at: '2026-10-01T09:00:00Z', ...over
});

describe('mergePriceSnapshots', () => {
  it('없던 관측을 받아 시간순으로 넣는다', () => {
    const r = mergePriceSnapshots(rec(), [
      row({ observed_at: '2026-10-02T09:00:00Z', price: 170000 }),
      row({ observed_at: '2026-10-01T09:00:00Z', price: 180000 })
    ]);
    expect(r.changed).toBe(true);
    expect(r.rec.obs.map(o => o.price)).toEqual([180000, 170000]);
    expect(r.rec.obs[0].seller).toBe('아고다');
    expect(r.rec.obs[0].verified).toBe(true);
  });

  // 서버 cron과 여러 기기가 각각 남기므로, 그대로 합치면 같은 날이 여러 번 쌓여
  // '하루 한 점' 전제가 깨지고 절약 판단이 흔들린다
  it('같은 날 관측이 이미 있으면 넣지 않는다', () => {
    const existing = rec({ obs: [{ price: 180000, cur: 'KRW', seller: '기존', at: '2026-10-01T02:00:00Z' }] as PriceRecord['obs'] });
    const r = mergePriceSnapshots(existing, [row({ observed_at: '2026-10-01T23:00:00Z', price: 999 })]);
    expect(r.changed).toBe(false);
    expect(r.rec).toBe(existing);            // 불변 — 원본 그대로
    expect(r.rec.obs).toHaveLength(1);
  });

  it('바꾼 게 없으면 원본 객체를 그대로 돌려준다', () => {
    const before = rec();
    expect(mergePriceSnapshots(before, []).rec).toBe(before);
    expect(mergePriceSnapshots(before, []).changed).toBe(false);
  });

  it('원본을 건드리지 않는다', () => {
    const before = rec();
    mergePriceSnapshots(before, [row()]);
    expect(before.obs).toHaveLength(0);
  });

  it('더 최근 관측의 오퍼 목록으로 갈아끼운다', () => {
    const before = rec({ at: '2026-10-01T00:00:00Z', offers: [{ seller: '옛것' }] as PriceRecord['offers'] });
    const r = mergePriceSnapshots(before, [
      row({ observed_at: '2026-10-02T09:00:00Z', offers: [{ seller: '새것' }] })
    ]);
    expect(r.changed).toBe(true);
    expect((r.rec.offers as { seller: string }[])[0].seller).toBe('새것');
    expect(r.rec.at).toBe('2026-10-02T09:00:00Z');
  });

  // 오래된 조회 결과가 최신을 덮으면 화면이 지난 가격을 지금 값처럼 보여준다
  it('오래된 관측의 오퍼는 최신을 덮지 않는다', () => {
    const before = rec({ at: '2026-10-05T00:00:00Z', offers: [{ seller: '최신' }] as PriceRecord['offers'] });
    const r = mergePriceSnapshots(before, [
      row({ observed_at: '2026-10-02T09:00:00Z', offers: [{ seller: '옛것' }] })
    ]);
    expect((r.rec.offers as { seller: string }[])[0].seller).toBe('최신');
    expect(r.rec.at).toBe('2026-10-05T00:00:00Z');
  });

  it('최신 조회가 성공하면 지난 오류를 지운다', () => {
    const before = rec({ at: null, err: { code: 'PROVIDER_ERROR', at: '2026-09-30T00:00:00Z' } as PriceRecord['err'] });
    const r = mergePriceSnapshots(before, [row({ offers: [{ seller: 'x' }] })]);
    expect(r.rec.err).toBeNull();
  });

  it('오퍼는 12개까지만 들고 있는다', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ seller: `s${i}` }));
    const r = mergePriceSnapshots(rec(), [row({ offers: many })]);
    expect(r.rec.offers).toHaveLength(12);
  });

  it('이상한 행은 건너뛴다', () => {
    const r = mergePriceSnapshots(rec(), [
      null as unknown as PriceSnapshotRow,
      row({ observed_at: '' }),
      row({ price: null, currency: null, seller: null, quality: null, verified: null })
    ]);
    expect(r.changed).toBe(true);
    expect(r.rec.obs).toHaveLength(1);
    expect(r.rec.obs[0].price).toBe(0);
    expect(r.rec.obs[0].cur).toBe('KRW');       // 통화를 모르면 원화로 본다
    expect(r.rec.obs[0].quality).toBe('SIMILAR');
  });
});

describe('trackedHotelIds', () => {
  it('숙박 예약 id만 모은다 — 가격 추적이 붙는 종류', () => {
    const trips = [
      { bookings: [{ id: 'h1', type: 'hotel' }, { id: 'c1', type: 'car' }] },
      { bookings: [{ id: 'h2', type: 'hotel' }] },
      { bookings: undefined }
    ];
    expect(trackedHotelIds(trips)).toEqual(['h1', 'h2']);
  });
  it('없으면 빈 배열', () => {
    expect(trackedHotelIds([])).toEqual([]);
    expect(trackedHotelIds([{ bookings: [] }])).toEqual([]);
  });
});
