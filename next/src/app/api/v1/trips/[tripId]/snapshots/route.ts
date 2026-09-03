// GET /api/v1/trips/:tripId/snapshots — 내 버전 이력(최근 15개) · POST — 지금 저장된 문서를 떠 둔다
import { snapshotRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return snapshotRoutes.list(request, tripId);
}

export async function POST(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return snapshotRoutes.create(request, tripId);
}
