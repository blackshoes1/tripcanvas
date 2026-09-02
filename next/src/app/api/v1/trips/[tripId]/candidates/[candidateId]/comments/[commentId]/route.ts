// DELETE /api/v1/trips/:tripId/candidates/:candidateId/comments/:commentId — 쓴 사람이나 주최자만
import { handlers } from '../../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request, ctx: { params: Promise<{ tripId: string; candidateId: string; commentId: string }> }
) {
  const { tripId, candidateId, commentId } = await ctx.params;
  return handlers.deleteComment(request, tripId, candidateId, commentId);
}
