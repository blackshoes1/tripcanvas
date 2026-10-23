import { dailyMomentsRoutes } from '../../../route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, context: Context) { return dailyMomentsRoutes.get(request, (await context.params).tripId); }
export async function PUT(request: Request, context: Context) { return dailyMomentsRoutes.put(request, (await context.params).tripId); }
