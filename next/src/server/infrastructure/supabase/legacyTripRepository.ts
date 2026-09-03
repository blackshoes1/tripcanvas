// 레거시 경로(LEGACY · DUAL_READ의 폴백) — Supabase를 TripRepository 모양으로 감싼다. 사용자 토큰으로 RLS 아래에서 읽고,
// 쓰기는 웹과 같은 RPC(sync_trip/tombstone_trip)를 지난다. service_role은 쓰지 않는다.
// Repository는 요청마다 하나다 — my_trip_roles 결과를 한 번만 받아 역할·인원·trip_id↔client_id를 안다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '../../api/errors';
import type {
  CasResult, MemberRole, MemberStatus, MembershipRepository, TripRecord, TripRepository, TripView
} from '../../repositories/types';

const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_2C-n1YFvE9Cw9B7L7B6Trw_XO3Val5q';

interface RoleRow { client_id: string; trip_id: string; role: string; member_count: number; owner: boolean }
interface TripRow { id: string; client_id: string; user_id: string; data: unknown; revision: number | string; updated_at: string; deleted_at: string | null }
interface SyncRow { applied: boolean; conflict: boolean; revision: number | string; data: unknown; deleted_at: string | null }

const COLS = 'id,client_id,user_id,data,revision,updated_at,deleted_at';

function isForbidden(e: unknown): boolean {
  const err = e as { code?: unknown; status?: unknown; message?: unknown } | null;
  return !!err && (String(err.code ?? '') === '42501' || Number(err.status) === 403 || /TRIP_FORBIDDEN/.test(String(err.message ?? '')));
}

export function supabaseForToken(token: string, url: string): SupabaseClient {
  return createClient(url, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

/** 한 요청 안에서 Trip·Membership Repository가 공유하는 Supabase 세션 */
export class LegacySupabaseSession {
  private roles: Promise<RoleRow[]> | null = null;
  readonly sb: SupabaseClient;
  constructor(token: string, supabaseUrl: string, readonly userId: string) {
    this.sb = supabaseForToken(token, supabaseUrl);
  }
  /** my_trip_roles — 실패하면 빈 목록(역할 없음 = 소유자로 다룬다, 쓰기는 어차피 RLS가 지킨다) */
  loadRoles(): Promise<RoleRow[]> {
    if (!this.roles) {
      this.roles = (async () => {
        const { data, error } = await this.sb.rpc('my_trip_roles');
        return (error || !Array.isArray(data)) ? [] : (data as RoleRow[]);
      })();
    }
    return this.roles;
  }
  async roleByTripId(tripId: string): Promise<RoleRow | null> {
    return (await this.loadRoles()).find((r) => String(r.trip_id) === tripId) ?? null;
  }
}

function toRecord(row: TripRow): TripRecord {
  return {
    id: String(row.id), ownerId: String(row.user_id), clientId: String(row.client_id), data: row.data ?? {},
    revision: Number(row.revision) || 1, deletedAt: row.deleted_at ?? null, updatedAt: String(row.updated_at)
  };
}

export class LegacyTripRepository implements TripRepository {
  private readonly clientIdOf = new Map<string, string>();
  constructor(private readonly session: LegacySupabaseSession) {}

  private async toView(row: TripRow): Promise<TripView> {
    const record = toRecord(row);
    this.clientIdOf.set(record.id, record.clientId);
    const role = await this.session.roleByTripId(record.id);
    const mine = record.ownerId === this.session.userId;
    return {
      record,
      role: (role?.role as MemberRole | undefined) ?? (mine ? 'OWNER' : 'VIEWER'),
      memberCount: Math.max(1, Number(role?.member_count) || 1)
    };
  }

  async listVisible(userId: string): Promise<TripView[]> {
    const { data, error } = await this.session.sb.from('trips').select(COLS).is('deleted_at', null).order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = ((data ?? []) as unknown as TripRow[]).slice().sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId));
    const seen = new Set<string>();
    const out: TripView[] = [];
    for (const r of rows) {
      if (seen.has(r.client_id)) continue;
      seen.add(r.client_id);
      out.push(await this.toView(r));
    }
    return out.sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
  }

  async findVisible(userId: string, clientId: string): Promise<TripView | null> {
    const { data, error } = await this.session.sb.from('trips').select(COLS).eq('client_id', clientId).limit(2);
    if (error) throw error;
    const rows = (data ?? []) as unknown as TripRow[];
    const picked = rows.find((r) => r.user_id === userId) ?? rows[0];
    return picked ? this.toView(picked) : null;
  }

  private async rpcSync(name: 'sync_trip' | 'tombstone_trip', args: Record<string, unknown>): Promise<SyncRow> {
    const { data, error } = await this.session.sb.rpc(name, args);
    if (error && isForbidden(error)) throw new ApiError('FORBIDDEN');
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as SyncRow | undefined;
    if (!row) throw new Error(`${name} returned no row`);
    return row;
  }

  async create(input: { ownerId: string; clientId: string; data: unknown }): Promise<TripRecord> {
    const row = await this.rpcSync('sync_trip', { p_client_id: input.clientId, p_data: input.data, p_expected_revision: null, p_force: false });
    if (!row.applied) throw new Error('duplicate (user_id, client_id)');
    const view = await this.findVisible(input.ownerId, input.clientId);
    if (!view) throw new Error('sync_trip applied but row not visible');
    return view.record;
  }

  private clientId(id: string): string {
    const clientId = this.clientIdOf.get(id);
    if (!clientId) throw new Error(`trip ${id} was not loaded in this request`);
    return clientId;
  }

  private cas(id: string, row: SyncRow, data: unknown): CasResult {
    const record: TripRecord = {
      id, clientId: this.clientId(id), ownerId: this.session.userId, data: row.data ?? data,
      revision: Number(row.revision) || 1, deletedAt: row.deleted_at ?? null, updatedAt: new Date().toISOString()
    };
    return { applied: !!row.applied, conflict: !!row.conflict, record };
  }

  async updateCas(id: string, data: unknown, expectedRevision: number, opts: { force?: boolean } = {}): Promise<CasResult> {
    const row = await this.rpcSync('sync_trip', { p_client_id: this.clientId(id), p_data: data, p_expected_revision: expectedRevision, p_force: !!opts.force });
    return this.cas(id, row, data);
  }

  async tombstoneCas(id: string, expectedRevision: number, opts: { force?: boolean } = {}): Promise<CasResult> {
    const row = await this.rpcSync('tombstone_trip', { p_client_id: this.clientId(id), p_expected_revision: expectedRevision, p_force: !!opts.force });
    return this.cas(id, row, null);
  }
}

export class LegacyMembershipRepository implements MembershipRepository {
  constructor(private readonly session: LegacySupabaseSession) {}

  async roleOf(_userId: string, tripId: string): Promise<MemberRole | null> {
    const role = await this.session.roleByTripId(tripId);
    return (role?.role as MemberRole | undefined) ?? null;
  }
  async wasMember(_userId: string, clientId: string): Promise<boolean> {
    const { data, error } = await this.session.sb.rpc('tc_was_member', { p_client_id: clientId });
    return !error && data === true;
  }
  async add(): Promise<void> { throw new Error('멤버 변경은 아직 레거시 RPC(accept_trip_invite 등)가 한다 — Phase 5'); }
  async setStatus(_tripId: string, _userId: string, _status: MemberStatus): Promise<void> { throw new Error('멤버 변경은 아직 레거시 RPC가 한다 — Phase 5'); }
}
