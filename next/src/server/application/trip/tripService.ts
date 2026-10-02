// Trip use case(§31). Route Handler는 이것만 부르고, 이것은 Repository만 부른다(§6).
//
//   목록·상세  : 내가 볼 수 있는 여행만. 남의 여행은 '없음'이다(존재를 흘리지 않는다)
//   생성       : 유입 문서는 반드시 정규화(lib.validateTripPayload → normalizeTrip). 볼 수 있는 여행(내 것·공유받은 것)과 id가 겹치면 CONFLICT.
//                나갔거나 내보내진 여행의 id면 FORBIDDEN — 로컬 사본이 조용히 제 계정으로 복제되지 않게(sync_trip의 tc_was_member 규칙)
//   수정       : OWNER·EDITOR만 — 역할은 저장 트랜잭션 안에서 다시 본다. revision CAS — stale write는 STALE_VERSION(현재 revision 동봉),
//                조용히 덮어쓰지 않는다(§91). 같은 문서의 재시도는 충돌이 아니다. 지워진 여행을 force로 되살리는 것은 주최자만
//   삭제       : OWNER만, tombstone. 이미 지워졌으면 그대로(멱등)
import lib from '@legacy/lib.js';
import { randomBytes } from 'node:crypto';

import { ApiError } from '../../api/errors';
import type { RequestContext } from '../../auth/types';
import type { MembershipRepository, TripRecord, TripRepository, TripView } from '../../repositories/types';
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

/** 충돌 응답에 실을 서버의 현재 상태 — 클라이언트가 두 버전을 보여 주고 고르게 하려면 문서가 필요하다 */
function staleDetails(record: TripRecord): Record<string, unknown> {
  return { revision: record.revision, deletedAt: record.deletedAt, document: record.data };
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

  /** 동기화용 — 삭제(tombstone)된 여행까지. 다른 기기의 삭제를 병합하려면 필요하다 */
  listForSync(ctx: RequestContext): Promise<TripView[]> {
    return this.deps.trips.listForSync(ctx.userId);
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
    if (existing) {
      // 내 것이든 공유받은 것이든 이미 볼 수 있는 여행이면 사본을 만들지 않는다 — 사본은 "소유한 쪽 우선" 때문에
      // 상세·저장·함께하기·실시간에서 공유 여행을 가린다(sync_trip도 볼 수 있는 행이면 충돌이었다).
      // 볼 수 없는 남의 같은 id는 여기 걸리지 않는다: 제 여행이 될 뿐이고, 있다고 알리면 존재를 흘린다.
      // 충돌에는 **서버의 현재 문서**를 함께 싣는다 — 클라이언트가 두 버전을 보여 주고 고르게 해야 한다
      throw new ApiError('CONFLICT', {
        message: '같은 id의 여행이 이미 있어요 — 수정(PUT)으로 저장해 주세요.',
        details: { revision: existing.record.revision, document: existing.record.data, deletedAt: existing.record.deletedAt }
      });
    }
    if (await this.deps.members.wasMember(ctx.userId, clientId)) {
      throw new ApiError('FORBIDDEN', { message: '이 여행에서 나갔거나 내보내졌어요 — 사본을 새로 만들 수 없어요.' });
    }
    const record = await this.deps.trips.create({ ownerId: ctx.userId, clientId, data: doc });
    return { record, role: 'OWNER', memberCount: 1 };
  }

  async update(ctx: RequestContext, clientId: string, input: unknown, expectedRevision: number, opts: { force?: boolean } = {}): Promise<TripView> {
    const doc = normalize(input);
    doc.id = clientId;
    const view = await this.deps.trips.findVisible(ctx.userId, clientId);
    if (!view) {
      if (await this.deps.members.wasMember(ctx.userId, clientId)) throw new ApiError('FORBIDDEN', { message: '이 여행에서 나갔거나 내보내졌어요.' });
      throw new ApiError('NOT_FOUND');
    }
    if (!(await this.deps.authz.canEdit(ctx.userId, view.record.id))) throw new ApiError('FORBIDDEN');
    const result = await this.deps.trips.updateCas(view.record.id, doc, expectedRevision, {
      force: opts.force, actorId: ctx.userId,
      // 지워진 여행을 되살리는 것은 지운 사람(주최자)뿐 — 편집자의 '이 기기 버전'은 삭제 충돌로 돌아간다. 소유자는 바뀌지 않는 값이다
      revive: view.record.ownerId === ctx.userId,
      // 위의 canEdit은 빠른 거절일 뿐이다. 저장과 같은 트랜잭션에서 역할을 다시 본다 — 강등·내보내기와 겹친 저장이 새지 않게
      authorize: (role) => this.deps.authz.roleCanEdit(role)
    });
    if (result.forbidden) throw new ApiError('FORBIDDEN');
    if (!result.applied && !result.alreadyApplied) throw new ApiError('STALE_VERSION', { details: staleDetails(result.record) });
    return { ...view, record: result.record };
  }

  async delete(ctx: RequestContext, clientId: string, expectedRevision: number, opts: { force?: boolean } = {}): Promise<TripView> {
    const view = await this.deps.trips.findVisible(ctx.userId, clientId);
    if (!view) throw new ApiError('NOT_FOUND');
    if (!(await this.deps.authz.canDelete(ctx.userId, view.record.id))) {
      throw new ApiError('FORBIDDEN', { message: '여행 삭제는 주최자만 할 수 있어요 — 공유받은 여행은 나가기로 정리해 주세요.' });
    }
    if (view.record.deletedAt) return view;
    const result = await this.deps.trips.tombstoneCas(view.record.id, expectedRevision, opts);
    if (!result.applied) throw new ApiError('STALE_VERSION', { details: staleDetails(result.record) });
    return { ...view, record: result.record };
  }
}
