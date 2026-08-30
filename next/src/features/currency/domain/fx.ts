// 환율 도메인 — 순수(§9). 네트워크·저장소는 services가 맡는다.
// 레거시 loadFx와 같은 판정을 유지한다(§28): USD 기준 시세를 받아 '통화 1단위 = ? 원'으로 바꾼다.
import type { CurrencyCode } from '@/features/trip/domain/types';

/** 앱이 다루는 통화 — 레거시 CUR와 같은 목록 */
export const FX_CURRENCIES: readonly CurrencyCode[] = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];

/** 네트워크 실패 시 근사값 (레거시와 같은 수치) */
export const FX_FALLBACK: Readonly<Record<CurrencyCode, number>> =
  Object.freeze({ KRW: 1, USD: 1380, EUR: 1500, JPY: 9.1, CNY: 192 });

export interface FxCache {
  /** 마지막으로 받은 날 YYYY-MM-DD */
  day: string;
  rates: Record<string, number>;
}

/**
 * 캐시는 기본값 **위에 덮어쓴다** — 통째로 갈아끼우면, 나중에 통화가 추가됐을 때
 * 옛 캐시에 없는 통화가 undefined가 되어 환산이 1:1로 깨진다(레거시가 같은 이유로 이렇게 한다).
 */
export function mergeRates(cached: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = { ...FX_FALLBACK };
  for (const [k, v] of Object.entries(cached ?? {})) {
    if (typeof v === 'number' && isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

/**
 * 다시 받아야 하나 — 하루 한 번. 단, **오늘치라도 통화가 빠져 있으면 다시 받는다**
 * (통화가 추가된 뒤의 옛 캐시는 오늘 날짜여도 불완전하다).
 */
export function needsRefresh(cache: FxCache | null, today: string): boolean {
  if (!cache || cache.day !== today) return true;
  return !FX_CURRENCIES.every(c => typeof cache.rates?.[c] === 'number' && cache.rates[c] > 0);
}

/**
 * open.er-api.com USD 기준 응답 → '통화 1단위 = ? 원'.
 * 하나라도 빠지거나 이상하면 통째로 버린다 — 반쪽 환율은 틀린 금액을 자신 있게 보여준다.
 */
export function ratesFromApi(json: unknown): Record<CurrencyCode, number> | null {
  const j = json as { result?: string; rates?: Record<string, unknown> } | null;
  if (!j || j.result !== 'success' || !j.rates) return null;
  const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v > 0 ? v : NaN);
  const KRW = num(j.rates.KRW), EUR = num(j.rates.EUR), JPY = num(j.rates.JPY), CNY = num(j.rates.CNY);
  if ([KRW, EUR, JPY, CNY].some(n => !isFinite(n))) return null;
  return { KRW: 1, USD: KRW, EUR: KRW / EUR, JPY: KRW / JPY, CNY: KRW / CNY };
}
