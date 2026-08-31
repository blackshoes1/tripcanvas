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

/**
 * 토큰 검증까지 겸한다 — getUser()가 사용자를 돌려주지 못하면 null(호출측이 401).
 * user_id를 알아야 suggestion_feedback upsert의 충돌 대상(unique 4개 컬럼)을 지정할 수 있다.
 */
export async function supabaseGatewayFor(token: string): Promise<Gateway | null> {
  if (!token) return null;
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: userData, error } = await sb.auth.getUser();
  const userId = userData?.user?.id;
  if (error || !userId) return null;

  return {
    async listTrips(): Promise<TripRow[]> {
      const { data, error: e } = await sb
        .from('trips')
        .select('client_id,data,revision,updated_at,deleted_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });
      if (e) throw e;
      return (data ?? []).map((r) => ({
        client_id: String(r.client_id), data: (r.data ?? {}) as TripDoc,
        revision: Number(r.revision) || 1, updated_at: String(r.updated_at), deleted_at: r.deleted_at ?? null
      }));
    },
    async getTrip(tripId: string): Promise<TripRow | null> {
      const { data, error: e } = await sb
        .from('trips')
        .select('client_id,data,revision,updated_at,deleted_at')
        .eq('client_id', tripId)
        .maybeSingle();
      if (e) throw e;
      if (!data) return null;
      return {
        client_id: String(data.client_id), data: (data.data ?? {}) as TripDoc,
        revision: Number(data.revision) || 1, updated_at: String(data.updated_at), deleted_at: data.deleted_at ?? null
      };
    },
    async saveTrip(tripId, doc, expectedRevision) {
      // 웹과 **같은 RPC**를 쓴다. 여기서 직접 update하면 웹의 CAS·tombstone 규칙을 우회하게 된다.
      const { data, error: e } = await sb.rpc('sync_trip', {
        p_client_id: tripId, p_data: doc, p_expected_revision: expectedRevision
      });
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
