// GET    /api/v1/trips/:tripId — 여행 문서 전체 + revision + 역할
// PUT    /api/v1/trips/:tripId — { trip, expectedRevision, force? } revision CAS 저장 (stale이면 409 STALE_VERSION)
// DELETE /api/v1/trips/:tripId?expectedRevision=N — tombstone. 소유자만
import { tripRoutes } from '../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return tripRoutes.get(request, tripId);
}

export async function PUT(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return tripRoutes.update(request, tripId);
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return tripRoutes.remove(request, tripId);
}
