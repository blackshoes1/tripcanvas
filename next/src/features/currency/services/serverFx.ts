import { FALLBACK_FX, ratesFromApi, type FxSnapshot } from '../domain/fx';

const URL = 'https://open.er-api.com/v6/latest/USD';
const RETRY = 300_000;

/** 서버 프로세스가 마지막 정상 응답을 공유한다. 재시작 후 조회 실패는 FALLBACK으로 명시한다. */
export function createFxProvider(fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: FxSnapshot | null = null;
  let expires = 0;
  let retryAt = 0;
  let pending: Promise<FxSnapshot> | null = null;
  const previous = (): FxSnapshot => cached ? { ...cached, source: 'STALE' } : FALLBACK_FX;
  return async function getFx(): Promise<FxSnapshot> {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    if (now() < retryAt) return previous();
    pending = (async () => {
      try {
        const response = await fetchImpl(URL, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error('FX unavailable');
        const body = await response.json();
        const rates = ratesFromApi(body);
        const updated = body.time_last_update_unix * 1000;
        const next = body.time_next_update_unix * 1000;
        if (typeof body.time_last_update_unix !== 'number' || typeof body.time_next_update_unix !== 'number' ||
            !rates || body.base_code !== 'USD' || body.rates.USD !== 1 ||
            !Number.isFinite(updated) || updated <= 0 || updated > now() ||
            !Number.isFinite(next) || next <= updated) throw new Error('Invalid FX response');
        // 오래된 응답이 마지막 정상 시세를 덮어쓰지 않게 한다.
        if (cached?.asOf && updated < Date.parse(cached.asOf)) throw new Error('Older FX response');
        expires = next;
        cached = { rates, source: 'LATEST', asOf: new Date(updated).toISOString() };
        retryAt = now() + RETRY;
        return now() < expires ? cached : previous();
      } catch {
        retryAt = now() + RETRY;
        return previous();
      } finally { pending = null; }
    })();
    return pending;
  };
}

export const getServerFx = createFxProvider();
