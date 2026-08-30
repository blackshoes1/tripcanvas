// 환율 캐시 — 레거시와 같은 localStorage 키(tripcanvas_fx)를 읽고 쓴다.
// 갱신은 하루 한 번. 두 앱 중 어느 쪽이 갱신하든 같은 캐시를 쓴다.
import { FX_FALLBACK, type FxCache, mergeRates, needsRefresh, ratesFromApi } from '../domain/fx';

const FX_KEY = 'tripcanvas_fx';
const FX_URL = 'https://open.er-api.com/v6/latest/USD';

const listeners = new Set<() => void>();
/** 스냅샷 캐시 — 값이 그대로면 같은 객체를 돌려준다(참조 안정성) */
let snapshot: Record<string, number> = { ...FX_FALLBACK };
let snapshotRaw: string | null | undefined;
/** 이 탭에서 이미 갱신을 시도했는지 — 매 렌더마다 네트워크를 두드리지 않게 */
let tried = false;

function readCache(): FxCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const c = JSON.parse(window.localStorage.getItem(FX_KEY) ?? 'null') as FxCache | null;
    return c && typeof c.day === 'string' && c.rates ? c : null;
  } catch {
    return null;
  }
}

/** 지금 쓰는 환율 — 캐시가 없거나 깨졌으면 폴백 근사 */
export function getFxSnapshot(): Record<string, number> {
  if (typeof window === 'undefined') return snapshot;
  const raw = window.localStorage.getItem(FX_KEY);
  if (snapshotRaw === undefined || raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = mergeRates(readCache()?.rates);
  }
  return snapshot;
}

/** SSR에는 저장소가 없다 — 폴백으로 그리고 hydration 후 실제 값으로 바뀐다 */
export function getFxServerSnapshot(): Record<string, number> {
  return snapshot;
}

export function subscribeFx(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * 하루 한 번 갱신. 실패하면 캐시·폴백을 그대로 둔다 — 환율을 못 받았다고
 * 금액을 못 보여줄 이유는 없다(근사라도 보여주는 편이 낫다).
 * @returns 새로 받아 저장했으면 true
 */
export async function refreshFx(
  today: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (typeof window === 'undefined' || tried) return false;
  tried = true;
  if (!needsRefresh(readCache(), today)) return false;
  try {
    const res = await fetchImpl(FX_URL);
    if (!res.ok) return false;
    const rates = ratesFromApi(await res.json());
    if (!rates) return false;
    window.localStorage.setItem(FX_KEY, JSON.stringify({ day: today, rates }));
    snapshotRaw = undefined;                 // 다음 스냅샷에서 다시 읽는다
    listeners.forEach(l => l());
    return true;
  } catch {
    return false;                            // 오프라인·차단 — 조용히 폴백 유지
  }
}

/** 테스트용 — 탭 단위 '이미 시도함' 표시를 되돌린다 */
export function _resetFxAttempt(): void {
  tried = false;
  snapshotRaw = undefined;
}
