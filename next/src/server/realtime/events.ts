// 실시간 이벤트(§43·§44). PostgreSQL이 진실이고 소켓은 **알림 채널**일 뿐이다(§45) —
// 그래서 페이로드에 내용을 싣지 않는다: 무엇이·어느 여행에서 바뀌었는지만 주고, 클라이언트는 API로 다시 읽는다(§41).
//
// 알림은 trip_activity INSERT 트리거가 pg_notify로 보낸다(마이그레이션 0004). NOTIFY는 트랜잭션이라
// **커밋된 뒤에만** 나간다 — 애플리케이션이 커밋 전에 쏘거나 롤백된 변경을 알리는 사고가 없다.

/** LISTEN 채널 이름. 트리거(0004_realtime_notify.sql)와 같아야 한다 */
export const REALTIME_CHANNEL = 'tc_realtime';

/** 트리거가 보낸 것 그대로. actorId는 서버 안에서만 쓴다(구독자별 mine 판정) */
export interface RealtimeEvent {
  /** trips.id — 서버 내부 식별자. 클라이언트에는 나가지 않는다 */
  tripId: string;
  /** trips.client_id — 클라이언트가 아는 여행 id */
  clientId: string;
  id: number;
  kind: string;
  actorId: string | null;
}

/** 구독자에게 보내는 메시지 — 이 모양이 계약이다 */
export interface ActivityMessage {
  type: 'ACTIVITY';
  tripId: string;
  id: number;
  kind: string;
  /** 내가 한 것인가 — 클라이언트(collab.js liveEffects)가 제 저장을 다시 당기지 않는 데 쓴다 */
  mine: boolean;
}

/** 이상한 payload로 서버가 죽지 않게, 모양이 어긋나면 조용히 버린다 */
export function parseNotification(raw: string): RealtimeEvent | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const tripId = typeof v.tripId === 'string' ? v.tripId : '';
  const clientId = typeof v.clientId === 'string' ? v.clientId : '';
  const kind = typeof v.kind === 'string' ? v.kind : '';
  const id = Number(v.id);
  if (!tripId || !clientId || !kind || !Number.isFinite(id)) return null;
  return { tripId, clientId, id, kind, actorId: typeof v.actorId === 'string' && v.actorId ? v.actorId : null };
}

export function messageFor(event: RealtimeEvent, userId: string): ActivityMessage {
  return { type: 'ACTIVITY', tripId: event.clientId, id: event.id, kind: event.kind, mine: event.actorId === userId };
}
