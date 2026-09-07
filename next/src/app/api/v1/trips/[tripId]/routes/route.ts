// GET /api/v1/trips/:tripId/routes — 여행 전체 동선. 로직은 features/trip-state/services/handlers.ts.
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await context.params;
  return handlers.tripRoutes(request, tripId);
}
