import { describe, expect, it } from 'vitest';

import { FX_CURRENCIES, FX_FALLBACK, mergeRates, needsRefresh, ratesFromApi } from './fx';

describe('mergeRates', () => {
  it('캐시가 없으면 폴백 그대로', () => {
    expect(mergeRates(null)).toEqual({ ...FX_FALLBACK });
    expect(mergeRates(undefined)).toEqual({ ...FX_FALLBACK });
  });

  it('캐시는 기본값 위에 덮어쓴다 — 빠진 통화가 1:1로 깨지지 않게', () => {
    // 옛 캐시에 CNY가 없다고 해서 CNY 환산이 1이 되면, 위안 금액이 원화로 그대로 찍힌다
    const r = mergeRates({ KRW: 1, USD: 1400, EUR: 1520, JPY: 9.3 });
    expect(r.USD).toBe(1400);
    expect(r.CNY).toBe(FX_FALLBACK.CNY);
    expect(r.CNY).not.toBe(1);
  });

  it('이상한 값은 무시하고 폴백을 지킨다', () => {
    const r = mergeRates({ USD: 0, EUR: -5, JPY: NaN, CNY: Infinity, KRW: 1 } as Record<string, number>);
    expect(r.USD).toBe(FX_FALLBACK.USD);
    expect(r.EUR).toBe(FX_FALLBACK.EUR);
    expect(r.JPY).toBe(FX_FALLBACK.JPY);
    expect(r.CNY).toBe(FX_FALLBACK.CNY);
  });

  it('숫자가 아닌 값도 걸러낸다 (외부 유입 캐시)', () => {
    const r = mergeRates({ USD: '1400' } as unknown as Record<string, number>);
    expect(r.USD).toBe(FX_FALLBACK.USD);
  });
});

describe('needsRefresh', () => {
  const full = Object.fromEntries(FX_CURRENCIES.map(c => [c, 1])) as Record<string, number>;

  it('캐시가 없으면 받는다', () => {
    expect(needsRefresh(null, '2026-08-30')).toBe(true);
  });
  it('어제 것이면 받는다', () => {
    expect(needsRefresh({ day: '2026-08-29', rates: full }, '2026-08-30')).toBe(true);
  });
  it('오늘 것이고 다 있으면 받지 않는다', () => {
    expect(needsRefresh({ day: '2026-08-30', rates: full }, '2026-08-30')).toBe(false);
  });
  it('오늘 것이어도 통화가 빠졌으면 받는다 — 통화가 추가된 뒤의 옛 캐시', () => {
    const missing = { ...full };
    delete missing.CNY;
    expect(needsRefresh({ day: '2026-08-30', rates: missing }, '2026-08-30')).toBe(true);
  });
  it('오늘 것이어도 값이 0이면 받는다', () => {
    expect(needsRefresh({ day: '2026-08-30', rates: { ...full, JPY: 0 } }, '2026-08-30')).toBe(true);
  });
});

describe('ratesFromApi', () => {
  const ok = { result: 'success', rates: { KRW: 1400, EUR: 0.92, JPY: 150, CNY: 7.2, USD: 1 } };

  it('USD 기준 시세를 원 환산율로 바꾼다', () => {
    const r = ratesFromApi(ok)!;
    expect(r.KRW).toBe(1);
    expect(r.USD).toBe(1400);                 // 1달러 = 1400원
    expect(r.EUR).toBeCloseTo(1400 / 0.92, 6);  // 1유로 = ? 원
    expect(r.JPY).toBeCloseTo(1400 / 150, 6);
    expect(r.CNY).toBeCloseTo(1400 / 7.2, 6);
  });

  it('엔은 원보다 작다 — 뒤집히면 금액이 100배 틀린다', () => {
    const r = ratesFromApi(ok)!;
    expect(r.JPY).toBeGreaterThan(1);
    expect(r.JPY).toBeLessThan(r.USD);
  });

  it('실패 응답은 버린다', () => {
    expect(ratesFromApi({ result: 'error', rates: ok.rates })).toBeNull();
  });

  it('통화가 하나라도 빠지면 통째로 버린다 — 반쪽 환율은 틀린 금액을 자신 있게 보여준다', () => {
    for (const drop of ['KRW', 'EUR', 'JPY', 'CNY']) {
      const rates = { ...ok.rates } as Record<string, unknown>;
      delete rates[drop];
      expect(ratesFromApi({ result: 'success', rates })).toBeNull();
    }
  });

  it('0·음수·숫자 아님은 버린다', () => {
    expect(ratesFromApi({ result: 'success', rates: { ...ok.rates, JPY: 0 } })).toBeNull();
    expect(ratesFromApi({ result: 'success', rates: { ...ok.rates, EUR: -1 } })).toBeNull();
    expect(ratesFromApi({ result: 'success', rates: { ...ok.rates, CNY: '7.2' } })).toBeNull();
  });

  it('모양이 아예 다르면 버린다', () => {
    expect(ratesFromApi(null)).toBeNull();
    expect(ratesFromApi({})).toBeNull();
    expect(ratesFromApi('nope')).toBeNull();
  });
});
