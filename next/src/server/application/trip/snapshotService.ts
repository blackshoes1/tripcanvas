// 여행 버전 이력 use case. 볼 수 있는 여행인지는 TripService가 판정하고(같은 규칙 한 곳), 스냅샷 자체는 사람마다 제 것이다.
//
// ⚠️ 스냅샷은 **저장된 문서**를 뜬다 — 클라이언트가 보낸 본문을 받지 않는다.
// 그래야 "무엇이 저장돼 있었는가"의 기록이 되고, 검증되지 않은 문서가 이력에 섞이지 않는다.
import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type { TripSnapshotRecord, TripSnapshotRepository, TripSnapshotSummary } from '../../repositories/types';
import type { TripService } from './tripService';

/** 화면에 한 줄로 보이는 이름 */
const NAME_MAX = 80;

export interface SnapshotServiceDeps {
  trips: TripService;
  snapshots: TripSnapshotRepository;
}

export class SnapshotService {
  constructor(private readonly deps: SnapshotServiceDeps) {}

  /** 보기 권한도 제 버전 이력은 남길 수 있다 — 여행 문서를 바꾸는 일이 아니다 */
  async create(ctx: RequestContext, clientId: string, name: string | null): Promise<TripSnapshotSummary> {
    const view = await this.deps.trips.get(ctx, clientId);
    return this.deps.snapshots.create(ctx.userId, clientId, {
      name: String(name ?? '').trim().slice(0, NAME_MAX),
      data: view.record.data,
      sourceRevision: view.record.revision
    });
  }

  async list(ctx: RequestContext, clientId: string): Promise<TripSnapshotSummary[]> {
    await this.deps.trips.get(ctx, clientId);
    return this.deps.snapshots.list(ctx.userId, clientId);
  }

  async load(ctx: RequestContext, clientId: string, id: number): Promise<TripSnapshotRecord> {
    await this.deps.trips.get(ctx, clientId);
    const snapshot = await this.deps.snapshots.find(ctx.userId, clientId, id);
    if (!snapshot) throw new ApiError('NOT_FOUND', { message: '그 버전을 찾을 수 없습니다.' });
    return snapshot;
  }
}
