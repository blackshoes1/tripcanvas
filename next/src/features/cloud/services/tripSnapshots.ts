'use client';
// 버전 히스토리 (trip_snapshots) — 레거시 cloudSnapshot/loadSnapList와 같은 테이블·같은 규칙.
// 실패해도 던지지 않는다: 스냅샷은 편의 기능이고, 못 남겼다고 편집이 막힐 이유가 없다.
import legacyLib from '@legacy/lib.js';

import type { Trip } from '@/features/trip/domain/types';
import { shouldSnapshot, staleSnapshotIds, type SnapshotRow } from '../domain/snapshots';
import { supabase } from './supabaseClient';

const { validateTripPayload } = legacyLib;

/** 여행별 마지막 스냅샷 시각 — 탭이 살아 있는 동안만 (10분 간격 판정용) */
const lastAt: Record<string, number> = {};

/** 스냅샷을 남긴다 (10분에 한 번). 오래된 건 정리한다 */
export async function snapshotTrip(trip: Trip, revision: number | null): Promise<void> {
  const sb = supabase();
  if (!sb || !trip) return;
  const now = Date.now();
  if (!shouldSnapshot(lastAt[trip.id], now)) return;
  lastAt[trip.id] = now;
  try {
    const { error } = await sb.from('trip_snapshots')
      .insert({ client_id: trip.id, name: trip.name ?? '', data: trip, source_revision: revision });
    if (error) throw error;
    await pruneSnapshots(trip.id);
  } catch (e) {
    console.warn('cloud.snapshot 실패:', e instanceof Error ? e.message : e);
  }
}

/** 최근 15개만 남기고 지운다 */
async function pruneSnapshots(clientId: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { data, error } = await sb.from('trip_snapshots')
    .select('id,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(100);
  if (error || !data) return;
  const stale = staleSnapshotIds(data as SnapshotRow[]);
  if (stale.length) await sb.from('trip_snapshots').delete().in('id', stale);
}

/** 그 여행의 버전 목록 (최신순 15개) */
export async function listSnapshots(clientId: string): Promise<SnapshotRow[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb.from('trip_snapshots')
    .select('id,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(15);
  return error || !data ? [] : (data as SnapshotRow[]);
}

export type RestoreResult = { ok: true; trip: Trip } | { ok: false; error: string };

/** 한 시점을 불러온다 — 손상된 데이터는 복원하지 않는다 (유입 데이터 검증) */
export async function loadSnapshot(id: number): Promise<RestoreResult> {
  const sb = supabase();
  if (!sb) return { ok: false, error: '클라우드에 연결되어 있지 않습니다' };
  const { data, error } = await sb.from('trip_snapshots').select('data').eq('id', id).single();
  if (error || !data) return { ok: false, error: '그 버전을 불러오지 못했습니다' };
  const r = validateTripPayload((data as { data: unknown }).data) as
    { ok: true; value: Trip } | { ok: false; error: string };
  return r.ok ? { ok: true, trip: r.value } : { ok: false, error: '손상된 버전이라 복원하지 않았습니다' };
}
