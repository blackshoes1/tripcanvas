// 통화 표기 — 레거시 app.js costLabel/toKRW/fmtMoney와 같은 규칙.
// 환율은 레거시가 갱신하는 tripcanvas_fx 캐시를 읽고, 없으면 같은 폴백 근사를 쓴다.
import type { CurrencyCode } from '@/features/trip/domain/types';

const FX_KEY = 'tripcanvas_fx';
const FALLBACK: Record<CurrencyCode, number> = { KRW: 1, USD: 1380, EUR: 1500, JPY: 9.1, CNY: 192 };
const SYMBOL: Record<CurrencyCode, string> = { KRW: '₩', USD: '$', EUR: '€', JPY: '¥', CNY: '¥' };

export function fxRates(): Record<string, number> {
  if (typeof window === 'undefined') return { ...FALLBACK };
  try {
    const c = JSON.parse(window.localStorage.getItem(FX_KEY) ?? 'null') as { rates?: Record<string, number> } | null;
    // 기본값 '위에 덮어쓰기' — 캐시에 없는 통화가 1:1로 깨지지 않게 (레거시와 동일)
    return { ...FALLBACK, ...(c?.rates ?? {}) };
  } catch {
    return { ...FALLBACK };
  }
}

export function krwRateOf(cur?: string): number {
  return fxRates()[cur ?? 'KRW'] ?? 1;
}

export function toKRW(amount: number, cur?: string): number {
  return Math.round((+amount || 0) * krwRateOf(cur));
}

export function fmtMoney(n: number): string {
  return Math.round(+n || 0).toLocaleString('en-US');
}

/** 통화 기호 — 알 수 없는 통화는 null (호출부가 KRW 폴백) */
export function currencySymbol(cur?: string): string | null {
  return SYMBOL[(cur ?? 'KRW') as CurrencyCode] ?? null;
}

/** KRW면 "₩68,000", 아니면 "€300 ≈ ₩450,000". 알 수 없는 통화는 KRW 폴백(렌더 크래시 방지) */
export function costLabel(amount: number, cur?: string): string {
  const c = (cur ?? 'KRW') as CurrencyCode;
  const sym = SYMBOL[c];
  if (!sym || c === 'KRW') return `₩${fmtMoney(amount)}`;
  return `${sym}${fmtMoney(amount)} ≈ ₩${fmtMoney(toKRW(amount, c))}`;
}
