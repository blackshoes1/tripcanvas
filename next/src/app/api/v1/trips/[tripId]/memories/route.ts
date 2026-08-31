// GET  /api/v1/trips/:tripId/memories?day=N   기록 + 일정과 나란히 놓은 타임라인
// POST /api/v1/trips/:tripId/memories         사진·메모 남기기 (어느 일정인지는 서버가 짚는다)
import { handlers } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.memories(request, tripId);
}

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  return handlers.createMemory(request, tripId);
}
