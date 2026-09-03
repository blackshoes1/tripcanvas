// GET /api/v1/trips/:tripId/invites — 초대 목록(주최자) · POST { role, hours?, maxUses? } — 토큰은 이 응답에만 한 번
import { collabRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.listInvites(request, tripId);
}

export async function POST(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.createInvite(request, tripId);
}
