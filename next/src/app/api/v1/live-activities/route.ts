import { verifier, tripServiceFor } from '../route-deps';
import { createLiveActivityRoutes } from '@/server/api/liveActivityRoutes';
import { ApiError } from '@/server/api/errors';
import { getEnv } from '@/server/config/env';
import { getDb } from '@/server/infrastructure/database/client';
import { PgLiveActivityRepository } from '@/server/infrastructure/database/pgLiveActivityRepository';
import { LiveActivityService } from '@/server/live-activities/service';
import { liveActivityWorkerStatus } from '@/server/live-activities/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const routes = createLiveActivityRoutes({
  verifier,
  serviceFor: async (ctx, token) => {
    const db = getDb();
    if (!db || getEnv().registry.TRIP !== 'NEW_BACKEND') throw new ApiError('SERVICE_UNAVAILABLE');
    const trips = await tripServiceFor(ctx, token);
    return new LiveActivityService({ repo: new PgLiveActivityRepository(db),
      tripFor: (actor, tripId) => trips.get(actor, tripId), configured: ['running', 'error'].includes(liveActivityWorkerStatus()) });
  }
});
export const POST = routes.register;
export const DELETE = routes.stop;
