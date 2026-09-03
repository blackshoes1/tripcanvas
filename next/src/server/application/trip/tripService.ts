// Trip use case(§31). Route Handler는 이것만 부르고, 이것은 Repository만 부른다(§6).
//
//   목록·상세  : 내가 볼 수 있는 여행만. 남의 여행은 '없음'이다(존재를 흘리지 않는다)
//   생성       : 유입 문서는 반드시 정규화(lib.validateTripPayload → normalizeTrip). 내 것과 id가 겹치면 CONFLICT.
//                나갔거나 내보내진 여행의 id면 FORBIDDEN — 로컬 사본이 조용히 제 계정으로 복제되지 않게(sync_trip의 tc_was_member 규칙)
//   수정       : OWNER·EDITOR만. revision CAS — stale write는 STALE_VERSION(현재 revision 동봉), 조용히 덮어쓰지 않는다(§91)
//   삭제       : OWNER만, tombstone. 이미 지워졌으면 그대로(멱등)
import lib from '@legacy/lib.js';
import { randomBytes } from 'node:crypto';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type { MembershipRepository, TripRepository, TripView } from '../../repositories/types';
import type { TripAuthorizationService } from '../authorization/tripAuthorization';

export interface TripServiceDeps {
  trips: TripRepository;
  members: MembershipRepository;
  authz: TripAuthorizationService;
}

/** 웹의 uid()와 같은 모양(영숫자 7자) — 예약·장소 id 규칙(normalizeBooking)이 같은 문자 집합을 본다 */
function newClientId(): string {
  return randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 7).padEnd(7, '0').toLowerCase();
}

function normalize(input: unknown): Record<string, unknown> {
  const result = lib.validateTripPayload(input);
  if (!result.ok) throw new ApiError('VALIDATION_ERROR', { message: result.error, details: { reason: result.error } });
  return result.value as Record<string, unknown>;
}

export class TripService {
  constructor(private readonly deps: TripServiceDeps) {}

  list(ctx: RequestContext): Promise<TripView[]> {
    return this.deps.trips.listVisible(ctx.userId);
  }

  async get(ctx: RequestContext, clientId: string): Promise<TripView> {
    const view = await this.deps.trips.findVisible(ctx.userId, clientId);
    if (!view || view.record.deletedAt) throw new ApiError('NOT_FOUND');
    return view;
  }

  async create(ctx: RequestContext, input: unknown): Promise<TripView> {
    const doc = normalize(input);
    const requested = typeof doc.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(doc.id) ? doc.id : '';
    const clientId = requested || newClientId();
    doc.id = clientId;
    const existing = await this.deps.trips.findVisible(ctx.userId, clientId);
    if (existing?.record.ownerId === ctx.userId) throw new ApiError('CONFLICT', { message: '같은 id의 여행이 이미 있습니다 — 수정(PUT)으로 저장해 주세요.', details: { revision: existing.record.revision } });
    if (await this.deps.members.wasMember(ctx.userId, clientId)) {
      throw new ApiError('FORBIDDEN', { message: '이 여행에서 나갔거나 내보내졌습니다 — 사본을 새로 만들 수 없습니다.' });
    }
    const record = await this.deps.trips.create({ ownerId: ctx.userId, clientId, data: doc });
    return { record, role: 'OWNER', memberCount: 1 };
  }

  async update(ctx: RequestContext, clientId: string, input: unknown, expectedRevision: number, opts: { force?: boolean } = {}): Promise<TripView> {
    const doc = normalize(input);
    doc.id = clientId;
    const view = await this.deps.trips.findVisible(ctx.userId, clientId);
    if (!view) {
      if (await this.deps.members.wasMember(ctx.userId, clientId)) throw new ApiError('FORBIDDEN', { message: '이 여행에서 나갔거나 내보내졌습니다.' });
      throw new ApiError('NOT_FOUND');
    }
    if (!(await this.deps.authz.canEdit(ctx.userId, view.record.id))) throw new ApiError('FORBIDDEN');
    const result = await this.deps.trips.updateCas(view.record.id, doc, expectedRevision, opts);
    if (!result.applied) throw new ApiError('STALE_VERSION', { details: { revision: result.record.revision, deleted: !!result.record.deletedAt } });
    return { ...view, record: result.record };
  }

  async delete(ctx: RequestContext, clientId: string, expectedRevision: number, opts: { force?: boolean } = {}): Promise<TripView> {
    const view = await this.deps.trips.findVisible(ctx.userId, clientId);
    if (!view) throw new ApiError('NOT_FOUND');
    if (!(await this.deps.authz.canDelete(ctx.userId, view.record.id))) {
      throw new ApiError('FORBIDDEN', { message: '여행 삭제는 주최자만 할 수 있습니다 — 공유받은 여행은 나가기로 정리해 주세요.' });
    }
    if (view.record.deletedAt) return view;
    const result = await this.deps.trips.tombstoneCas(view.record.id, expectedRevision, opts);
    if (!result.applied) throw new ApiError('STALE_VERSION', { details: { revision: result.record.revision } });
    return { ...view, record: result.record };
  }
}
