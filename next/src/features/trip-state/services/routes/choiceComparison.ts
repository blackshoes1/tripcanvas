import lib from '@legacy/lib.js';
import { buildDayPlanView } from '../../domain/dayPlanView';
import { summarizeTrip } from '../../domain/todayView';
import { fail, ok, resolveClock, type HandlerKit } from '../handlerKit';

export function createChoiceComparisonHandlers(kit: HandlerKit) {
  async function choiceComparison(request: Request, tripId: string): Promise<Response> {
    return kit.withTrip(request, tripId, async ({ gateway, row }) => {
      const body = await kit.readBody(request);
      if (body instanceof Response) return body;
      const match = typeof body.activityId === 'string' ? /^d(\d+)s(\d+)$/.exec(body.activityId) : null;
      if (!match || !Number.isSafeInteger(body.expectedRevision)) return fail('BAD_REQUEST');
      if (body.expectedRevision !== row.revision) return fail('REVISION_CONFLICT');
      const di = Number(match[1]), si = Number(match[2]), spot = row.data.days?.[di]?.spots?.[si];
      if (!spot || spot.choice?.state !== 'PENDING' || lib.spotChoiceError(spot)) return fail('SUGGESTION_STALE');
      const clock = resolveClock(row.data, null, new URL(request.url), kit.now());
      const choices = [];
      for (const alternative of [false, true]) {
        const document = structuredClone(row.data);
        if (alternative) {
          // Only constructs a read-only calculation document; the saved slot is untouched.
          const replacement = { ...spot.choice.alternative } as Record<string, unknown>;
          for (const key of ['at', 'who', 'split', 'reunion', 'must', 'opt']) {
            delete replacement[key];
            if (key in spot) replacement[key] = (spot as Record<string, unknown>)[key];
          }
          document.days![di].spots![si] = replacement;
        }
        const legs = await kit.legCacheFor(document, di, gateway.userId);
        const plan = buildDayPlanView({ trip: document, di, todayISO: clock.todayISO,
          generatedAt: kit.now().toISOString(), summary: summarizeTrip({ ...row, data: document }, clock.todayISO), legCache: legs.cache });
        choices.push({ alternative, travel: plan?.day.spots[si]?.incomingLeg ?? null });
      }
      return ok({ revision: row.revision, activityId: body.activityId, choices });
    });
  }
  return { choiceComparison };
}
