import { liveActivityRoutes } from './route-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = liveActivityRoutes.register;
export const DELETE = liveActivityRoutes.stop;
