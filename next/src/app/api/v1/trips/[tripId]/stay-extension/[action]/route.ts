import { handlers } from '../../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ tripId: string; action: string }> }) {
  const { tripId, action } = await ctx.params;
  return handlers.stayExtension(request, tripId, action);
}
