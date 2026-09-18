// 서버 환율 — 하루 한 번 받아 앱 응답(하루치·전체 비용)에 싣는다.
//
// 2026-09-18까지 앱의 원화 환산은 코드에 박힌 근사값(USD 1380원…)이었다. 웹은 기기에서 하루 한 번 받았지만
// 서버는 받은 적이 없어, 같은 여행의 원화 합계가 웹과 앱에서 달랐고 앱 쪽은 시세와 동떨어져 갔다.
//
// 규칙은 웹 `loadFx`와 같다: open.er-api.com USD 기준 → '통화 1단위 = ? 원', UTC 날짜로 하루 한 번.
// 다른 점은 **실패했을 때**다 — 브라우저는 자기 캐시로 떨어지지만 서버는 DB에 마지막으로 받은 날을 두고
// 그것을 쓴다(출처 API·기준일은 그날). 그것도 없을 때만 근사값(FALLBACK)이다. 어느 쪽이든 응답에
// 출처와 기준일이 실려 앱이 "9월 18일 환율" 또는 "실시간 아님"이라고 말한다.
import {
  FX_FALLBACK_SNAPSHOT, type FxSnapshot, mergeRates, ratesFromApi
} from '@/features/currency/domain/fx';
import type { FxRateRepository } from '@/server/repositories/types';

export const FX_URL = 'https://open.er-api.com/v6/latest/USD';
/** 실패한 뒤 다시 시도하기까지 — 요청마다 죽은 곳을 두드리지 않는다 */
export const FX_RETRY_MS = 10 * 60 * 1000;
/** 상류가 느릴 때 응답을 이만큼 이상 늦추지 않는다 — 환율 하나 때문에 비용 화면이 멈추면 안 된다 */
export const FX_TIMEOUT_MS = 5000;

/** 핸들러가 보는 계약. 없으면(주입 안 됨) 근사값이고, 있으면 항상 값을 돌려준다 — 던지지 않는다 */
export interface FxSupport {
  read(): Promise<FxSnapshot>;
}

export interface ServerFxDeps {
  /** 없으면(DB 없음) 메모리에만 둔다 — 프로세스가 다시 뜨면 한 번 더 받는다 */
  repo?: FxRateRepository | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

/** UTC 날짜 — 웹 `loadFx`의 `toISOString().slice(0,10)`과 같은 기준이라 두 앱의 '오늘'이 같다 */
export function fxDayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function createServerFx(deps: ServerFxDeps = {}): FxSupport {
  const now = deps.now ?? (() => new Date());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? (() => {});
  /** 오늘치로 확인된 스냅샷 — 이 날짜 동안은 어디도 묻지 않는다 */
  let fresh: { day: string; snapshot: FxSnapshot } | null = null;
  /** 마지막 실패 — 그 뒤 FX_RETRY_MS 동안은 저장된 것·근사값으로 답한다 */
  let failedAt: number | null = null;
  let stale: FxSnapshot | null = null;
  /** 같은 순간에 들어온 요청들이 상류를 한 번만 두드리게 */
  let inflight: Promise<FxSnapshot> | null = null;

  async function fromStore(): Promise<{ day: string; rates: Record<string, number> } | null> {
    if (!deps.repo) return null;
    try {
      const row = await deps.repo.latest();
      return row ? { day: row.day, rates: mergeRates(row.rates) } : null;
    } catch (e) {
      log(`fx store read failed: ${(e as Error).message}`);
      return null;
    }
  }

  async function fetchToday(day: string): Promise<Record<string, number> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);
    try {
      const res = await fetchImpl(FX_URL, { signal: controller.signal });
      if (!res.ok) { log(`fx fetch failed: HTTP ${res.status}`); return null; }
      const rates = ratesFromApi(await res.json());
      if (!rates) { log('fx fetch failed: unexpected body'); return null; }
      if (deps.repo) {
        try { await deps.repo.put({ day, rates }); } catch (e) { log(`fx store write failed: ${(e as Error).message}`); }
      }
      return rates;
    } catch (e) {
      log(`fx fetch failed: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolve(day: string): Promise<FxSnapshot> {
    // 1) 이 프로세스가 오늘 이미 받았거나 확인했다
    if (fresh?.day === day) return fresh.snapshot;
    // 2) 다른 프로세스(또는 다시 뜨기 전의 나)가 오늘 받아 두었다
    const stored = await fromStore();
    if (stored?.day === day) {
      fresh = { day, snapshot: { rates: stored.rates, source: 'API', asOf: day } };
      return fresh.snapshot;
    }
    // 3) 방금 실패했으면 다시 두드리지 않는다 — 저장된 최근 날, 없으면 근사값
    const staleSnapshot: FxSnapshot = stored
      ? { rates: stored.rates, source: 'API', asOf: stored.day }
      : { ...FX_FALLBACK_SNAPSHOT, rates: { ...FX_FALLBACK_SNAPSHOT.rates } };
    if (failedAt !== null && now().getTime() - failedAt < FX_RETRY_MS) return stale ?? staleSnapshot;
    // 4) 오늘치를 받는다
    const rates = await fetchToday(day);
    if (rates) {
      failedAt = null; stale = null;
      fresh = { day, snapshot: { rates, source: 'API', asOf: day } };
      return fresh.snapshot;
    }
    failedAt = now().getTime();
    stale = staleSnapshot;
    return staleSnapshot;
  }

  return {
    async read() {
      const day = fxDayOf(now());
      if (fresh?.day === day) return fresh.snapshot;
      if (!inflight) {
        inflight = resolve(day).finally(() => { inflight = null; });
      }
      return inflight;
    }
  };
}
