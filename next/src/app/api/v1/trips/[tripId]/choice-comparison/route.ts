import { handlers } from '../../../route-deps';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, ctx: { params: Promise<{ tripId: string }> }) {
  return handlers.choiceComparison(request, (await ctx.params).tripId);
}
