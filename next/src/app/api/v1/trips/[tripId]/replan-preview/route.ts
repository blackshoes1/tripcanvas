// POST /api/v1/trips/:tripId/replan-preview — 미리보기만 만든다. 아무것도 저장하지 않는다.
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.replanPreview(request, tripId);
}
