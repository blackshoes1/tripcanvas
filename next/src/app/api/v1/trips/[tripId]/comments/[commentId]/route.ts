// DELETE /api/v1/trips/:tripId/comments/:commentId — 쓴 사람이나 주최자만.
// 후보 아래에 두지 않는다: 서버가 판정에 쓰는 것은 여행과 코멘트뿐이라, 쓰이지 않는 경로 조각을 만들지 않는다.
import { collabRoutes } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tripId: string; commentId: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const { tripId, commentId } = await ctx.params;
  return collabRoutes.deleteComment(request, tripId, commentId);
}
