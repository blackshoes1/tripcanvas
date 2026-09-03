// POST /api/v1/invites/:token/accept — { displayName? } 여기서만 멤버십이 생긴다. 멱등
import { collabRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  return collabRoutes.acceptInvite(request, token);
}
