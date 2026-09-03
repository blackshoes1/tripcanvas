// DELETE /api/v1/trips/:tripId/candidates/:candidateId/comments/:commentId — 쓴 사람이나 주최자만
import { collabRoutes } from '../../../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; commentId: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const { tripId, commentId } = await ctx.params;
  return collabRoutes.deleteComment(request, tripId, commentId);
}
