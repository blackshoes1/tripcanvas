import { describe, expect, it, vi } from 'vitest';
import { createFxProvider } from './serverFx';

const start = Date.parse('2026-09-17T00:00:00Z');
const payload = () => ({ result: 'success', base_code: 'USD', time_last_update_unix: start / 1000,
  time_next_update_unix: start / 1000 + 86400, rates: { USD: 1, KRW: 1400, EUR: 0.8, JPY: 140, CNY: 7 } });
describe('server exchange rates', () => {
  it('converts all currencies, shares in-flight work and refreshes the next daily publication', async () => {
    let now = start + 1000;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload()));
    const get = createFxProvider(fetcher, () => now);
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toEqual({ rates: { KRW: 1, USD: 1400, EUR: 1750, JPY: 10, CNY: 200 }, source: 'LATEST', asOf: new Date(start).toISOString() });
    expect(b).toEqual(a);
    await get(); expect(fetcher).toHaveBeenCalledTimes(1);
    now += 86400000;
    fetcher.mockResolvedValueOnce(Response.json({ ...payload(), time_last_update_unix: (start + 86400000) / 1000, time_next_update_unix: (start + 172800000) / 1000 }));
    expect((await get()).source).toBe('LATEST');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('retains last good rates on failure, marks stale and throttles retries', async () => {
    let now = start + 1000;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(payload())).mockRejectedValue(new Error('offline'));
    const get = createFxProvider(fetcher, () => now);
    await get(); now += 86400000;
    const stale = await get();
    expect(stale.source).toBe('STALE'); expect(stale.rates.USD).toBe(1400);
    await get(); expect(fetcher).toHaveBeenCalledTimes(2);
    now += 300000; await get(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    { ...payload(), rates: { USD: 1, KRW: 1400 } },
    { ...payload(), time_last_update_unix: null },
    { ...payload(), time_last_update_unix: (start + 86400000) / 1000 },
    { ...payload(), base_code: 'EUR' },
  ])('rejects incomplete or invalid data without claiming it is current', async body => {
    const get = createFxProvider(vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)), () => start + 1000);
    expect(await get()).toMatchObject({ source: 'FALLBACK', asOf: null });
  });
  it('marks an expired provider response stale even when HTTP succeeds', async () => {
    const get = createFxProvider(vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload())), () => start + 172800000);
    expect((await get()).source).toBe('STALE');
  });
});
