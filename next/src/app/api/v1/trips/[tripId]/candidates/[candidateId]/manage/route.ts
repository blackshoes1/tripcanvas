// POST /api/v1/trips/:tripId/candidates/:candidateId/manage
// REMOVE · SCHEDULE · UNSCHEDULE · REJECT · REOPEN. 어떤 역할이 무엇을 할 수 있는지는 DB가 정한다.
import { handlers } from '../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string; candidateId: string }> }) {
  const { tripId, candidateId } = await ctx.params;
  return handlers.manageCandidate(request, tripId, candidateId);
}
