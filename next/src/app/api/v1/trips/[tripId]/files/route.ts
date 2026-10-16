import { tripFileRoutes } from '../../../route-deps';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, context: Context) {
  return tripFileRoutes.list(request, (await context.params).tripId);
}
export async function POST(request: Request, context: Context) {
  return tripFileRoutes.upload(request, (await context.params).tripId);
}
