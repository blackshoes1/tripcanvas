// POST /api/v1/trips/:tripId/suggestions/(accept|skip)  body: { suggestionId, expectedRevision? }
// 제안 id는 결정적 키라 경로에 넣기 어려운 문자를 포함한다 → 본문으로 받는다.
import { handlers } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string; action: string }> }) {
  const { tripId, action } = await ctx.params;
  return handlers.suggestionAction(request, tripId, action);
}
