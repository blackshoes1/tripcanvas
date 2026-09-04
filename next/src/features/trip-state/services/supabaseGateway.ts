// 서버에서의 Supabase 접근 — 사용자의 access token을 그대로 실어 **RLS 아래에서** 읽고 쓴다.
// service_role 키를 쓰지 않는다: 서버가 남의 여행을 볼 수 있는 경로 자체를 만들지 않는 편이 안전하다.
// (그래서 새 서버 전용 시크릿도 필요 없다 — 공개 publishable 키 + 사용자 토큰이면 충분하다.)
import { createClient } from '@supabase/supabase-js';

import type { PriceObservation } from '../domain/bookingsView';
import type { DeviceRegistration } from '../domain/contract';
import type { MemoryRow } from '../domain/intakeView';
import type { Gateway, TripRow } from './handlers';
import type { TripDoc } from '../domain/todayView';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gdnhrwtfidjimtabgovh.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_2C-n1YFvE9Cw9B7L7B6Trw_XO3Val5q';

interface SyncTripRow { applied: boolean; conflict: boolean; revision: number | string; data: TripDoc | null }
interface RoleRow { client_id: string; role: string; member_count: number; owner: boolean }

/** RPC/PostgREST 오류가 권한 거절(42501 → 403)인가 — 재시도해도 같다 */
function isForbidden(e: unknown): boolean {
  const err = e as { code?: unknown; status?: unknown; message?: unknown } | null;
  return !!err && (String(err.code ?? '') === '42501' || Number(err.status) === 403 || /TRIP_FORBIDDEN/.test(String(err.message ?? '')));
}

/**
 * 토큰 검증까지 겸한다 — getUser()가 사용자를 돌려주지 못하면 null(호출측이 401).
 * user_id를 알아야 suggestion_feedback upsert의 충돌 대상(unique 4개 컬럼)을 지정할 수 있다.
 */
export async function supabaseGatewayFor(token: string, knownUserId?: string): Promise<Gateway | null> {
  if (!token) return null;
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  // 서버가 JWT를 이미 검증했으면(server/auth) 다시 묻지 않는다 — 요청마다 Supabase 왕복 하나가 준다.
  let userId = knownUserId;
  if (!userId) {
    const { data: userData, error } = await sb.auth.getUser();
    userId = userData?.user?.id;
    if (error || !userId) return null;
  }

  /** 함께하기 — 내가 볼 수 있는 여행 전부의 역할·인원 (한 번의 RPC). 실패하면 빈 맵 — 쓰기는 어차피 RLS가 지킨다 */
  async function rolesByClientId(): Promise<Map<string, RoleRow>> {
    const map = new Map<string, RoleRow>();
    const { data, error: e } = await sb.rpc('my_trip_roles');
    if (e || !Array.isArray(data)) return map;
    for (const r of data as RoleRow[]) {
      if (!r?.client_id) continue;
      const prev = map.get(r.client_id);
      if (prev?.owner && !r.owner) continue;   // 같은 client_id면 소유한 쪽이 이긴다
      map.set(r.client_id, r);
    }
    return map;
  }
  function withRole(r: { client_id: unknown; data: unknown; revision: unknown; updated_at: unknown; deleted_at?: unknown }, roles: Map<string, RoleRow>): TripRow {
    const role = roles.get(String(r.client_id));
    return {
      client_id: String(r.client_id), data: (r.data ?? {}) as TripDoc,
      revision: Number(r.revision) || 1, updated_at: String(r.updated_at), deleted_at: (r.deleted_at as string | null) ?? null,
      role: role?.role ?? null, member_count: role?.member_count ?? null
    };
  }

  return {
    async listTrips(): Promise<TripRow[]> {
      const [{ data, error: e }, roles] = await Promise.all([
        sb.from('trips')
          .select('client_id,user_id,data,revision,updated_at,deleted_at')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false }),
        rolesByClientId()
      ]);
      if (e) throw e;
      // 같은 client_id가 둘(내 것 + 공유받은 것)이면 소유한 쪽만 — 클라이언트는 id 하나에 여행 하나다
      const seen = new Set<string>();
      const rows = (data ?? []).slice().sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId));
      return rows.filter((r) => { const id = String(r.client_id); if (seen.has(id)) return false; seen.add(id); return true; })
        .map((r) => withRole(r, roles));
    },
    async getTrip(tripId: string): Promise<TripRow | null> {
      const [{ data, error: e }, roles] = await Promise.all([
        sb.from('trips')
          .select('client_id,user_id,data,revision,updated_at,deleted_at')
          .eq('client_id', tripId)
          .limit(2),
        rolesByClientId()
      ]);
      if (e) throw e;
      const rows = data ?? [];
      const picked = rows.find((r) => r.user_id === userId) ?? rows[0];
      if (!picked) return null;
      return withRole(picked, roles);
    },
    async saveTrip(tripId, doc, expectedRevision) {
      // 웹과 **같은 RPC**를 쓴다. 여기서 직접 update하면 웹의 CAS·tombstone 규칙을 우회하게 된다.
      const { data, error: e } = await sb.rpc('sync_trip', {
        p_client_id: tripId, p_data: doc, p_expected_revision: expectedRevision
      });
      // 보기 권한·내보내진 멤버의 쓰기는 42501 — 충돌이 아니라 권한 문제라 따로 알린다(재시도해도 같다)
      if (e && isForbidden(e)) return { applied: false, conflict: false, forbidden: true, revision: expectedRevision, data: null };
      if (e) throw e;
      const row = (Array.isArray(data) ? data[0] : data) as SyncTripRow | undefined;
      if (!row) throw new Error('sync_trip returned no row');
      return {
        applied: !!row.applied, conflict: !!row.conflict,
        revision: Number(row.revision) || expectedRevision, data: row.data ?? null
      };
    },
    async listDismissed(tripId, dayISO) {
      const { data, error: e } = await sb
        .from('suggestion_feedback')
        .select('suggestion_key')
        .eq('trip_client_id', tripId)
        .eq('day_iso', dayISO)
        .eq('action', 'SKIPPED');
      if (e) throw e;
      return (data ?? []).map((r) => String(r.suggestion_key));
    },
    async listPriceObservations(tripId: string): Promise<PriceObservation[]> {
      const { data, error: e } = await sb
        .from('hotel_price_snapshots')
        .select('booking_id,seller,price,currency,quality,verified,offers,observed_at')
        .eq('trip_client_id', tripId)
        .order('observed_at', { ascending: true })
        .limit(500);
      if (e) throw e;
      return (data ?? []).map((r) => ({
        booking_id: String(r.booking_id), seller: r.seller ?? null,
        price: r.price == null ? null : Number(r.price), currency: r.currency ?? null,
        quality: r.quality ?? null, verified: !!r.verified,
        offers: Array.isArray(r.offers) ? (r.offers as unknown[]) : null,
        observed_at: String(r.observed_at)
      }));
    },
    async savePriceObservation(tripId, obs): Promise<void> {
      const { error: e } = await sb.from('hotel_price_snapshots').insert({
        user_id: userId, trip_client_id: tripId, booking_id: obs.booking_id,
        seller: obs.seller, price: obs.price, currency: obs.currency,
        quality: obs.quality, verified: obs.verified, ptoken: obs.ptoken ?? null, offers: obs.offers
      });
      if (e) throw e;
    },
    async listSentNotificationKeys(tripId: string, dayISO: string): Promise<string[]> {
      const { data, error: e } = await sb
        .from('notification_log')
        .select('dedupe_key')
        .eq('trip_client_id', tripId)
        .eq('day_iso', dayISO);
      if (e) throw e;
      return (data ?? []).map((r) => String(r.dedupe_key));
    },
    async recordNotifications(tripId, dayISO, items) {
      if (!items.length) return;
      // 같은 키는 한 행이다 — 중복 발송이 오류가 되지 않게(§46).
      const { error: e } = await sb.from('notification_log').upsert(
        items.map((n) => ({
          user_id: userId, trip_client_id: tripId, day_iso: dayISO,
          kind: n.kind, dedupe_key: n.dedupeKey, state_version: n.stateVersion
        })),
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }
      );
      if (e) throw e;
    },
    async saveDevice(registration: DeviceRegistration) {
      const { error: e } = await sb.from('device_tokens').upsert({
        user_id: userId,
        device_id: registration.deviceId,
        platform: registration.platform,
        push_token: registration.pushToken,
        enabled: registration.enabled,
        preferences: registration.preferences,
        app_version: registration.appVersion,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,device_id' });
      if (e) throw e;
    },
    async listMemories(tripId: string, dayIndex: number | null): Promise<MemoryRow[]> {
      let query = sb.from('trip_memories')
        .select('id,day_index,activity_id,type,caption,asset_refs,lat,lng,at_minutes,captured_at,client_key')
        .eq('trip_client_id', tripId)
        .order('at_minutes', { ascending: true })
        .limit(500);
      if (dayIndex != null) query = query.eq('day_index', dayIndex);
      const { data, error: e } = await query;
      if (e) throw e;
      return (data ?? []) as unknown as MemoryRow[];
    },
    async saveMemory(tripId, row) {
      // 오프라인에서 만든 기록이 온라인 복귀 후 두 번 올라가지 않게 clientKey로 먼저 찾는다.
      if (row.client_key) {
        const { data: found } = await sb.from('trip_memories')
          .select('id,day_index,activity_id,type,caption,asset_refs,lat,lng,at_minutes,captured_at,client_key')
          .eq('client_key', row.client_key).maybeSingle();
        if (found) return { row: found as unknown as MemoryRow, created: false };
      }
      const { data, error: e } = await sb.from('trip_memories')
        .insert({ user_id: userId, trip_client_id: tripId, ...row })
        .select('id,day_index,activity_id,type,caption,asset_refs,lat,lng,at_minutes,captured_at,client_key')
        .single();
      if (e) throw e;
      return { row: data as unknown as MemoryRow, created: true };
    },
    async removeDevice(deviceId: string) {
      const { error: e } = await sb.from('device_tokens').delete().eq('device_id', deviceId);
      if (e) throw e;
    },
    async recordFeedback(tripId, dayISO, key, action) {
      // 같은 제안을 두 번 건너뛰어도 한 행이다 — 중복 제출이 오류가 되지 않게.
      const { error: e } = await sb.from('suggestion_feedback').upsert(
        { user_id: userId, trip_client_id: tripId, day_iso: dayISO, suggestion_key: key, action, source: 'ios', updated_at: new Date().toISOString() },
        { onConflict: 'user_id,trip_client_id,day_iso,suggestion_key' }
      );
      if (e) throw e;
    }
  };
}
