import { tripFileRoutes } from '../../../../route-deps';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ tripId: string; fileId: string }> };
export async function GET(request: Request, context: Context) {
  const p = await context.params; return tripFileRoutes.get(request, p.tripId, p.fileId);
}
export async function PATCH(request: Request, context: Context) {
  const p = await context.params; return tripFileRoutes.edit(request, p.tripId, p.fileId);
}
export async function DELETE(request: Request, context: Context) {
  const p = await context.params; return tripFileRoutes.remove(request, p.tripId, p.fileId);
}
