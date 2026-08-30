// 통화 표기 — 레거시 app.js costLabel/toKRW/fmtMoney와 같은 규칙.
// 환율 캐시(tripcanvas_fx)의 읽기·갱신은 features/currency가 맡고, 여기서는 그 값을 쓰기만 한다.
import { getFxSnapshot } from '@/features/currency/services/fxStore';
import type { CurrencyCode } from '@/features/trip/domain/types';

// 기호는 레거시 CUR와 같아야 한다 — 같은 데이터를 두 앱이 다르게 표기하면 같은 여행으로 안 보인다
const SYMBOL: Record<CurrencyCode, string> = { KRW: '₩', USD: '$', EUR: '€', JPY: '¥', CNY: '元' };

export function fxRates(): Record<string, number> {
  return getFxSnapshot();
}

/** 통화 1단위 = ? 원 */
export type FxRates = Record<string, number>;

export function krwRateOf(cur?: string, rates: FxRates = fxRates()): number {
  return rates[cur ?? 'KRW'] ?? 1;
}

// 환율을 인자로 받는 이유: 이 값이 바뀌면 화면의 환산액도 다시 계산돼야 하는데,
// 모듈 전역에서 몰래 읽으면 호출측 memo가 그 사실을 알 수 없어 옛 금액이 그대로 남는다.
export function toKRW(amount: number, cur?: string, rates: FxRates = fxRates()): number {
  return Math.round((+amount || 0) * krwRateOf(cur, rates));
}

export function fmtMoney(n: number): string {
  return Math.round(+n || 0).toLocaleString('en-US');
}

/** 통화 기호 — 알 수 없는 통화는 null (호출부가 KRW 폴백) */
export function currencySymbol(cur?: string): string | null {
  return SYMBOL[(cur ?? 'KRW') as CurrencyCode] ?? null;
}

/** KRW면 "₩68,000", 아니면 "€300 ≈ ₩450,000". 알 수 없는 통화는 KRW 폴백(렌더 크래시 방지) */
export function costLabel(amount: number, cur?: string, rates: FxRates = fxRates()): string {
  const c = (cur ?? 'KRW') as CurrencyCode;
  const sym = SYMBOL[c];
  if (!sym || c === 'KRW') return `₩${fmtMoney(amount)}`;
  return `${sym}${fmtMoney(amount)} ≈ ₩${fmtMoney(toKRW(amount, c, rates))}`;
}
