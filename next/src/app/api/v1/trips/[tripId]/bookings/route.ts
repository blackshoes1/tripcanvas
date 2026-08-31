// GET /api/v1/trips/:tripId/bookings — 읽기 전용. 자동 재예약은 하지 않는다.
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.bookings(request, tripId);
}
