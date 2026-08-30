// 가격 관측 저장소 (§18) — 레거시와 같은 tripcanvas_prices_v1을 읽는다.
// 관측 갱신(메타서치 조회)은 레거시 앱/cron이 수행하고, Next UI는 기록·판단 표시를 담당한다
// (API 이관은 Phase 3 — 그 전에 Next에서 조회를 중복 구현하지 않는다).
import type { PriceRecord } from '@/features/pricing/domain/types';

const PRICE_KEY = 'tripcanvas_prices_v1';

export type PriceStore = Record<string, PriceRecord>;

const EMPTY: PriceStore = {};
let cacheRaw: string | null | undefined;
let cacheVal: PriceStore = EMPTY;
const listeners = new Set<() => void>();
let storageAttached = false;

function parse(text: string | null): PriceStore {
  try {
    const raw = JSON.parse(text ?? 'null') as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return EMPTY;
    const out: PriceStore = {};
    for (const [id, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const rec = v as Partial<PriceRecord>;
      out[id] = {
        obs: Array.isArray(rec.obs) ? rec.obs : [],
        offers: Array.isArray(rec.offers) ? rec.offers : [],
        at: rec.at ?? null,
        err: rec.err ?? null,
        basis: rec.basis ?? null,
        candidates: rec.candidates,
        alert: rec.alert
      };
    }
    return out;
  } catch {
    return EMPTY;
  }
}

export function getPriceStoreSnapshot(): PriceStore {
  if (typeof window === 'undefined') return EMPTY;
  const raw = window.localStorage.getItem(PRICE_KEY);
  if (cacheRaw === undefined || raw !== cacheRaw) {
    cacheRaw = raw;
    cacheVal = parse(raw);
  }
  return cacheVal;
}

export function getPriceStoreServerSnapshot(): PriceStore {
  return EMPTY;
}

function emit() {
  cacheRaw = undefined;
  listeners.forEach(l => l());
}

export function subscribePriceStore(cb: () => void): () => void {
  listeners.add(cb);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', e => { if (e.key === PRICE_KEY || e.key === null) emit(); });
  }
  return () => { listeners.delete(cb); };
}

/**
 * 관측 기록을 통째로 되쓴다 (클라우드에서 받아온 기록 병합).
 * 저장에 실패하면 false — 호출측이 화면만 바꿔 놓고 저장된 줄 알지 않게.
 */
export function replacePriceStore(next: PriceStore): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(PRICE_KEY, JSON.stringify(next));
    emit();
    return true;
  } catch {
    return false;   // 쿼터 초과 등
  }
}

/** 예약 삭제 시 관측 기록도 함께 정리 (골든: 참조 정리) */
export function deletePriceRecord(bookingId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PRICE_KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || !(bookingId in raw)) return;
    delete raw[bookingId];
    window.localStorage.setItem(PRICE_KEY, JSON.stringify(raw));
    emit();
  } catch { /* 기록 정리는 최선 노력 — 실패해도 예약 삭제는 유효 */ }
}
