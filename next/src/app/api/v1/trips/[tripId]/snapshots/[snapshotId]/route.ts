// GET /api/v1/trips/:tripId/snapshots/:snapshotId — 그 버전의 여행 문서
import { snapshotRoutes } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; snapshotId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId, snapshotId } = await ctx.params;
  return snapshotRoutes.load(request, tripId, snapshotId);
}
