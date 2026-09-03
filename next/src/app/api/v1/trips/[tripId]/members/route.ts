// GET /api/v1/trips/:tripId/members — 활성 멤버(주최자 먼저). 이름표만, 이메일은 없다
import { collabRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { tripId } = await ctx.params;
  return collabRoutes.listMembers(request, tripId);
}
