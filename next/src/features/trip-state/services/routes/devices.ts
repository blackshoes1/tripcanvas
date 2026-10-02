// 기기 토큰 등록·해제 — 알림을 보낼 곳을 기억한다.
import type {
  ApiError, ApiErrorCode, BookingCandidate, BookingListResponse, DeviceRegistration,
  ImportCommitResponse, ImportPreviewResponse, MemoryCreateResponse, MemoryEvent, MemoryListResponse,
  MutationResponse, NotificationPlanItem, PlanPreviewResponse, TodayResponse, TravelStateResponse, TripListResponse
} from '../../domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '../../domain/contract';
import { fail, ok, sanitizePreferences, type HandlerKit } from '../handlerKit';

/**
 * 기기 등록 값의 길이 상한. iOS는 기기 id로 UUID(36자)를, 푸시 토큰으로 APNs 토큰(16진 64자)을 보낸다 — 넉넉히 두되 끝은 있다.
 * ⚠️ 식별자는 **자르지 않고 거절한다.** 잘린 푸시 토큰은 조용히 알림이 안 가는 토큰이고, 잘린 기기 id는 다른 기기다.
 *    device_id는 (user_id, device_id) unique 인덱스의 키라 길면 인덱스 행 한도(약 2.7KB)에서 저장 자체가 실패한다.
 */
export const DEVICE_ID_MAX = 128;
export const PUSH_TOKEN_MAX = 1024;
/** 앱 버전은 기록용이라 잘라서 남긴다(`1.4.2` 같은 값) */
export const APP_VERSION_MAX = 64;

export function createDevicesHandlers(kit: HandlerKit) {
  const { deps, now, auth, readBody } = kit;

  /** POST /api/v1/devices — 기기 등록. 로그아웃·알림 끄기는 DELETE로(§45). */
  async function registerDevice(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const pushToken = typeof body.pushToken === 'string' ? body.pushToken.trim() : '';
    if (!deviceId || !pushToken) return fail('BAD_REQUEST');
    if (deviceId.length > DEVICE_ID_MAX || pushToken.length > PUSH_TOKEN_MAX) return fail('BAD_REQUEST');
    const registration: DeviceRegistration = {
      deviceId,
      platform: body.platform === 'web' ? 'web' : 'ios',
      pushToken,
      enabled: body.enabled !== false,
      preferences: sanitizePreferences(body.preferences),
      appVersion: typeof body.appVersion === 'string' ? body.appVersion.slice(0, APP_VERSION_MAX) : null
    };
    try { await gateway.saveDevice(registration); } catch { return fail('UPSTREAM_ERROR'); }
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, registered: true, deviceId });
  }

  /** DELETE /api/v1/devices?deviceId=... — 로그아웃 시 토큰을 지운다. */
  async function unregisterDevice(request: Request): Promise<Response> {
    const gateway = await auth(request);
    if (gateway instanceof Response) return gateway;
    const deviceId = new URL(request.url).searchParams.get('deviceId')?.trim() ?? '';
    if (!deviceId || deviceId.length > DEVICE_ID_MAX) return fail('BAD_REQUEST');
    try { await gateway.removeDevice(deviceId); } catch { return fail('UPSTREAM_ERROR'); }
    return ok({ schemaVersion: CONTRACT_SCHEMA_VERSION, registered: false, deviceId });
  }

  return { registerDevice, unregisterDevice };
}
