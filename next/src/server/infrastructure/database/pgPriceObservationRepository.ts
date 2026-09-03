// 가격 관측 Repository — append-only. 판정(확정/잠재 절약)은 price.js가 한다. 가짜 가격을 만들지 않는다: 없으면 빈 배열.
import { and, asc, eq } from 'drizzle-orm';

import type { PriceObservationRecord, PriceObservationRepository } from '../../repositories/types';
import type { Db } from './db';
import { hotelPriceSnapshots } from './schema';

export class PgPriceObservationRepository implements PriceObservationRepository {
  constructor(private readonly db: Db) {}

  async listForTrip(userId: string, tripClientId: string): Promise<PriceObservationRecord[]> {
    const rows = await this.db.select().from(hotelPriceSnapshots)
      .where(and(eq(hotelPriceSnapshots.userId, userId), eq(hotelPriceSnapshots.tripClientId, tripClientId)))
      .orderBy(asc(hotelPriceSnapshots.observedAt)).limit(500);
    return rows.map((r) => ({
      booking_id: r.bookingId, seller: r.seller, price: r.price == null ? null : Number(r.price), currency: r.currency,
      quality: r.quality, verified: r.verified, offers: Array.isArray(r.offers) ? (r.offers as unknown[]) : null,
      observed_at: r.observedAt.toISOString()
    }));
  }

  async append(userId: string, tripClientId: string, obs: Omit<PriceObservationRecord, 'observed_at'> & { observed_at?: string; ptoken?: string | null }): Promise<void> {
    await this.db.insert(hotelPriceSnapshots).values({
      userId, tripClientId, bookingId: obs.booking_id, seller: obs.seller, price: obs.price == null ? null : String(obs.price),
      currency: obs.currency, quality: obs.quality, verified: obs.verified, ptoken: obs.ptoken ?? null, offers: obs.offers,
      ...(obs.observed_at ? { observedAt: new Date(obs.observed_at) } : {})
    });
  }
}
