// 기기 토큰 등록·해제 — 알림을 보낼 곳을 기억한다.
import type {
  ApiError, ApiErrorCode, BookingCandidate, BookingListResponse, DeviceRegistration,
  ImportCommitResponse, ImportPreviewResponse, MemoryCreateResponse, MemoryEvent, MemoryListResponse,
  MutationResponse, NotificationPlanItem, PlanPreviewResponse, TodayResponse, TravelStateResponse, TripListResponse
} from '../../domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '../../domain/contract';
import { fail, ok, sanitizePreferences, type HandlerKit } from '../handlerKit';

export function createDevicesHandlers(kit: HandlerKit) {
  const { deps, now, auth, readBody } = kit;

  /** POST /api/v1/devices — 기기 등록. 로그아웃·알림 끄기는 DELETE로(§45). */
  async function registerDevice(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const pushToken = typeof body.pushToken === 'string' ? body.pushToken.trim() : '';
    if (!deviceId || !pushToken) return fail('BAD_REQUEST');
    const registration: DeviceRegistration = {
      deviceId,
      platform: body.platform === 'web' ? 'web' : 'ios',
      pushToken,
      enabled: body.enabled !== false,
      preferences: sanitizePreferences(body.preferences),
      appVersion: typeof body.appVersion === 'string' ? body.appVersion : null
    };
    try { await gateway.saveDevice(registration); } catch { return fail('UPSTREAM_ERROR'); }
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, registered: true, deviceId });
  }

  /** DELETE /api/v1/devices?deviceId=... — 로그아웃 시 토큰을 지운다. */
  async function unregisterDevice(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const deviceId = new URL(request.url).searchParams.get('deviceId')?.trim() ?? '';
    if (!deviceId) return fail('BAD_REQUEST');
    try { await gateway.removeDevice(deviceId); } catch { return fail('UPSTREAM_ERROR'); }
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, registered: false, deviceId });
  }

  return { registerDevice, unregisterDevice };
}
