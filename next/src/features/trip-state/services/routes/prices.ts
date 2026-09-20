// 예약 가격 관측 기록 — 여행과 같은 저장소·같은 권한이다.
import { CONTRACT_SCHEMA_VERSION } from '../../domain/contract';
import type { PriceObservation } from '../../domain/bookingsView';
import { fail, ok, type HandlerKit } from '../handlerKit';

export function createPricesHandlers(kit: HandlerKit) {
  const { deps, now, auth, loadTrip, withTrip, readBody } = kit;

  /**
   * GET /api/v1/trips/:tripId/prices — 그 여행의 가격 관측.
   * 기기 로컬 기록과 합치는 것은 클라이언트가 한다(웹은 예전부터 그랬다).
   */
  async function prices(request: Request, tripId: string): Promise<Response> {
    return withTrip(request, tripId, async ({ gateway, row }) => {
      let observations: PriceObservation[];
      try { observations = await gateway.listPriceObservations(tripId); } catch { return fail('UPSTREAM_ERROR'); }
      return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, observations });
    });
  }

  /**
   * POST /api/v1/trips/:tripId/prices — 관측 한 건.
   * ⚠️ 가격을 만들어 내지 않는다: 숫자가 아니면 거절하고, 없는 값은 null로 남긴다(§28).
   */
  async function createPrice(request: Request, tripId: string): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const bookingId = typeof body.bookingId === 'string' ? body.bookingId.trim() : '';
    const price = typeof body.price === 'number' && Number.isFinite(body.price) ? body.price : null;
    if (!bookingId || price == null) return fail('BAD_REQUEST');
    const row = await loadTrip(gateway, tripId);
    if (row instanceof Response) return row;
    const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);
    try {
      await gateway.savePriceObservation(tripId, {
        booking_id: bookingId.slice(0, 64),
        seller: str(body.seller, 120),
        price,
        currency: str(body.currency, 8),
        quality: str(body.quality, 20),
        verified: body.verified === true,
        // 원본 응답을 통째로 오래 보관하지 않는다(§28) — 상위 10개까지만
        offers: Array.isArray(body.offers) ? (body.offers as unknown[]).slice(0, 10) : null,
        ptoken: str(body.ptoken, 200)
      });
    } catch { return fail('UPSTREAM_ERROR'); }
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, saved: true }, 201);
  }

  return { prices, createPrice };
}
