// GET /api/v1/invites/:token — 초대 미리보기. 로그인 전에도 된다(이름·시작일·일수·역할까지만)
import { collabRoutes } from '../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  return collabRoutes.previewInvite(request, token);
}
