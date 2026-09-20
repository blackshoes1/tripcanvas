import { coverRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, context: Context) {
  return coverRoutes.get(request, (await context.params).tripId);
}

export async function PUT(request: Request, context: Context) {
  return coverRoutes.put(request, (await context.params).tripId);
}
