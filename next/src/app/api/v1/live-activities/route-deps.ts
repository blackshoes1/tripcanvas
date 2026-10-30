import { verifier, tripServiceFor } from '../route-deps';
import { createLiveActivityRoutes } from '@/server/api/liveActivityRoutes';
import { ApiError } from '@/server/api/errors';
import { getEnv } from '@/server/config/env';
import { getDb } from '@/server/infrastructure/database/client';
import { PgLiveActivityRepository } from '@/server/infrastructure/database/pgLiveActivityRepository';
import { PgLegCacheRepository } from '@/server/infrastructure/database/pgLegCacheRepository';
import { LiveActivityService } from '@/server/live-activities/service';
import { liveActivityWorkerStatus } from '@/server/live-activities/runtime';
import { legRequestsFor, toLegCache } from '@/server/routing/legFiller';
import type { Trip } from '@/features/trip/domain/types';

export const liveActivityRoutes = createLiveActivityRoutes({
  verifier,
  serviceFor: async (ctx, token) => {
    const db = getDb();
    if (!db || getEnv().registry.TRIP !== 'NEW_BACKEND') throw new ApiError('SERVICE_UNAVAILABLE');
    const trips = await tripServiceFor(ctx, token);
    const legs = new PgLegCacheRepository(db);
    return new LiveActivityService({ repo: new PgLiveActivityRepository(db),
      tripFor: (actor, tripId) => trips.get(actor, tripId), configured: ['running', 'error'].includes(liveActivityWorkerStatus()),
      cachedLegs: async (trip, dayIndex) => toLegCache(await legs.getMany(
        legRequestsFor(trip as unknown as Trip, dayIndex).map(request => request.key))) });
  }
});
