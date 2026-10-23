import collab from '@legacy/collab.js';
import { buildStayExtension, applyStayExtension } from '../../domain/stayExtension';
import { fail, ok, resolveClock, type HandlerKit } from '../handlerKit';

export function createStayExtensionHandlers(kit: HandlerKit) {
  async function stayExtension(request: Request, tripId: string, action: string): Promise<Response> {
    if (action !== 'preview' && action !== 'apply') return fail('BAD_REQUEST');
    return kit.withTrip(request, tripId, async ({ gateway, row }) => {
      if (row.role != null && !collab.canEdit(row.role)) return fail('FORBIDDEN');
      const body = await kit.readBody(request);
      if (body instanceof Response) return body;
      if (!Number.isSafeInteger(body.expectedRevision) || typeof body.expectedRevision !== 'number'
        || body.expectedRevision < 0 || typeof body.activityId !== 'string'
        || typeof body.extraMinutes !== 'number' || ![10, 20, 30].includes(body.extraMinutes)) return fail('BAD_REQUEST');
      // Strict CAS also prevents a lost-response retry from extending the stay twice.
      if (body.expectedRevision !== row.revision) return fail('REVISION_CONFLICT', { revision: row.revision });
      // A client clock is not authority for making a current-day mutation.
      const url = new URL(request.url);
      url.searchParams.delete('date'); url.searchParams.delete('now'); url.searchParams.delete('day');
      const clock = resolveClock(row.data, null, url, kit.now());
      const di = Number(/^d(\d+)s\d+$/.exec(body.activityId)?.[1]);
      if (!Number.isSafeInteger(di) || !row.data.days?.[di]) return fail('ACTIVITY_NOT_FOUND');
      const legs = await kit.legCacheFor(row.data, di, gateway.userId);
      const preview = buildStayExtension({ tripId, trip: row.data, revision: row.revision, updatedAt: row.updated_at,
        todayISO: clock.todayISO, nowMinutes: clock.nowMinutes, legCache: legs.cache, generatedAt: kit.now().toISOString()
      }, body.activityId, body.extraMinutes);
      if (!preview) return fail('SUGGESTION_STALE', { message: '지금 머무는 장소가 바뀌었어요. 최신 일정에서 다시 확인해 주세요.' });
      if (action === 'preview') return ok(preview);
      if (typeof body.previewKey !== 'string' || body.previewKey !== preview.previewKey || !preview.feasible)
        return fail('SUGGESTION_STALE', { message: preview.reason ?? '계산 결과가 바뀌었어요. 미리보기를 다시 확인해 주세요.' });
      return kit.persist(gateway, row, applyStayExtension(row.data, preview), url, true, false);
    });
  }
  return { stayExtension };
}
