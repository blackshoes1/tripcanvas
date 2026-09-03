// Supabase → 새 PostgreSQL 데이터 이관(Phase 10). 절차와 근거는 docs/backup-restore.md.
//
// 원본은 인터페이스다: R0는 합성 데이터(MemorySource), R1은 운영 덤프를 복원한 사본(PgSource).
// 같은 importer가 둘 다 먹으므로, R0에서 잡은 함정이 R1에서도 그대로 막힌다.
import {
  candidateReactions, deviceTokens, hotelPriceSnapshots, notificationLog, suggestionFeedback,
  tripActivity, tripCandidates, tripComments, tripInvites, tripMembers, tripMemories, tripSnapshots, trips, users
} from '../infrastructure/database/schema';

/**
 * 옮기는 테이블과 **넣는 순서**(외래키 순). 되돌릴 때는 역순으로 비운다.
 * users는 Supabase auth.users에서 오고(§13 — id를 그대로 보존), 나머지는 public 스키마 그대로다.
 */
export const MIGRATION_ORDER = [
  'users',
  'trips',
  'trip_snapshots',
  'trip_members',
  'trip_invites',
  'trip_candidates',
  'candidate_reactions',
  'trip_comments',
  'trip_activity',
  'suggestion_feedback',
  'device_tokens',
  'notification_log',
  'trip_memories',
  'hotel_price_snapshots'
] as const;

export type MigratedTable = (typeof MIGRATION_ORDER)[number];

/** 테이블 이름 → Drizzle 테이블. 컬럼 이름과 타입은 여기서 읽는다(매핑을 손으로 적지 않는다) */
export const MIGRATION_TABLES = {
  users, trips, trip_snapshots: tripSnapshots, trip_members: tripMembers, trip_invites: tripInvites,
  trip_candidates: tripCandidates, candidate_reactions: candidateReactions, trip_comments: tripComments,
  trip_activity: tripActivity, suggestion_feedback: suggestionFeedback, device_tokens: deviceTokens,
  notification_log: notificationLog, trip_memories: tripMemories, hotel_price_snapshots: hotelPriceSnapshots
} as const;

export type SourceRow = Record<string, unknown>;

export interface MigrationSource {
  /**
   * 그 테이블의 모든 행(원본 컬럼 이름 그대로).
   * **null은 "원본에 그 테이블이 없다"**는 뜻이다 — 운영에 적용되지 않은 마이그레이션이 셋 있다.
   * 빈 배열("있는데 비었다")과 구분해야 실패를 놓치지 않는다.
   */
  rows(table: MigratedTable): Promise<SourceRow[] | null>;
}

export interface TableImportReport {
  table: MigratedTable;
  /** null이면 원본에 테이블 자체가 없었다 */
  sourceRows: number | null;
  inserted: number;
  /** 새 스키마에 없어 버린 원본 컬럼 — 무엇을 잃었는지 눈에 보이게 한다 */
  droppedColumns: string[];
}

export interface ImportReport {
  ok: boolean;
  tables: TableImportReport[];
  /** 다시 맞춘 identity 시퀀스 */
  sequencesReset: string[];
}
