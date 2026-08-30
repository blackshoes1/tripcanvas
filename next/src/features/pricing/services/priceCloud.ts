'use client';
// 가격 관측 공유 (hotel_price_snapshots) — 서버 cron과 다른 기기가 남긴 기록을 합친다.
// 병합 규칙은 domain/priceSync가 정하고, 여기는 조회와 저장만 한다 (§9).
import { supabase } from '@/features/cloud/services/supabaseClient';
import type { Trip } from '@/features/trip/domain/types';
import { mergePriceSnapshots, trackedHotelIds, type PriceSnapshotRow } from '../domain/priceSync';
import type { PriceStore } from './localPriceStore';

/** 최근 이만큼만 받아온다 — 오래된 관측은 판단에 쓰이지 않는다 */
const WINDOW_DAYS = 7;
const MAX_ROWS = 200;

/**
 * 클라우드 관측을 로컬 기록에 합친다. 바뀐 게 없으면 null —
 * 호출측이 불필요하게 저장·재렌더하지 않게.
 */
export async function pullPriceSnapshots(trips: Trip[], store: PriceStore): Promise<PriceStore | null> {
  const sb = supabase();
  if (!sb) return null;
  const ids = trackedHotelIds(trips);
  if (!ids.length) return null;

  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
  const { data, error } = await sb.from('hotel_price_snapshots')
    .select('booking_id,seller,price,currency,quality,verified,offers,observed_at')
    .in('booking_id', ids).gte('observed_at', since)
    .order('observed_at', { ascending: true }).limit(MAX_ROWS);
  if (error || !data || !data.length) return null;

  const byBooking = new Map<string, PriceSnapshotRow[]>();
  for (const r of data as PriceSnapshotRow[]) {
    if (!r?.booking_id) continue;
    const list = byBooking.get(r.booking_id) ?? [];
    list.push(r);
    byBooking.set(r.booking_id, list);
  }

  let changed = false;
  const next: PriceStore = { ...store };
  for (const [id, rows] of byBooking) {
    const base = next[id] ?? { obs: [], offers: [], at: null, err: null, basis: null };
    const merged = mergePriceSnapshots(base, rows);
    if (merged.changed) { next[id] = merged.rec; changed = true; }
  }
  return changed ? next : null;
}
