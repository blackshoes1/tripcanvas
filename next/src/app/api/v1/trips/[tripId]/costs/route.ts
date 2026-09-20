// GET /api/v1/trips/:tripId/costs — 여행 전체 비용. 로직은 features/trip-state/services/handlers.ts.
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await context.params;
  return handlers.tripCosts(request, tripId);
}
