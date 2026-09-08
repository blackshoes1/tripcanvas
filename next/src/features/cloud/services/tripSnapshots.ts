'use client';
// 버전 이력은 API가 권한·문서·보관 개수를 결정한다.
import legacyLib from '@legacy/lib.js';

import type { Trip } from '@/features/trip/domain/types';
import { shouldSnapshot, type SnapshotRow } from '../domain/snapshots';
import { cloudApi, hasCloudSession } from './tripCanvasClient';

const lastAt: Record<string, number> = {};

export async function snapshotTrip(trip: Trip): Promise<void> {
  if (!hasCloudSession()) return;
  const now = Date.now();
  if (!shouldSnapshot(lastAt[trip.id], now)) return;
  const { error } = await cloudApi.snapshots.create(trip.id, trip.name ?? '');
  if (!error) lastAt[trip.id] = now;
}

export async function listSnapshots(clientId: string): Promise<SnapshotRow[]> {
  if (!hasCloudSession()) return [];
  const { data, error } = await cloudApi.snapshots.list(clientId);
  // API 미배포·권한·네트워크 실패를 빈 이력으로 감추지 않는다.
  if (error) throw new Error('버전 이력을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  return data ?? [];
}

export type RestoreResult = { ok: true; trip: Trip } | { ok: false; error: string };

export async function loadSnapshot(clientId: string, id: number): Promise<RestoreResult> {
  if (!hasCloudSession()) return { ok: false, error: '클라우드에 연결되어 있지 않습니다' };
  const { data, error } = await cloudApi.snapshots.load(clientId, id);
  if (error || !data) return { ok: false, error: '그 버전을 불러오지 못했습니다' };
  const result = legacyLib.validateTripPayload(data.data);
  return result.ok
    ? { ok: true, trip: result.value as Trip }
    : { ok: false, error: '손상된 버전이라 복원하지 않았습니다' };
}
