// 협업 Repository — Supabase RPC·트리거가 하던 저장·조회를 그대로 옮겼다. 인가는 CollabService가 이미 판정했다.
// 이름표는 SQL이 만든다(tc_member_label과 같은 규칙): display_name → '주최자'(OWNER) → '멤버'. 계정 이메일은 어디에도 나오지 않는다(§69).
// 활동 기록은 각 변경과 **같은 트랜잭션**에서 쓴다 — Supabase의 트리거를 대신한다. 무엇을 안 남기는지는 각 메서드 주석에.
import { and, desc, eq, sql } from 'drizzle-orm';

import type {
  ActivityView, CandidateInput, CandidateView, CommentView, InviteView, MemberView, PreferenceView
} from '../../application/collaboration/types';
import type {
  CandidateRow, CollabRepository, CommentRow, InviteRow, MemberRole, MemberRow, MemberStatus
} from '../../repositories/types';
import type { Db } from './db';
import { candidateReactions, tripActivity, tripCandidates, tripComments, tripInvites, tripMembers, trips } from './schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Rows = { rows: Record<string, unknown>[] };

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const num = (v: unknown): number => Number(v);

/** tc_member_label — 이 여행에서 부르는 이름. 원시 SQL 조각(테이블 별칭 없이 서브쿼리) */
const label = (tripExpr: string, userExpr: string) =>
  `(select coalesce(nullif(btrim(coalesce(lm.display_name,'')),''), case when lm.role='OWNER' then '주최자' else '멤버' end)
      from trip_members lm where lm.trip_id=${tripExpr} and lm.user_id=${userExpr} limit 1)`;

function toMemberRow(r: typeof tripMembers.$inferSelect): MemberRow {
  return { id: Number(r.id), tripId: r.tripId, userId: r.userId, role: r.role as MemberRole, status: r.status as MemberStatus, displayName: r.displayName, updatedAt: r.updatedAt.toISOString() };
}

export class PgCollabRepository implements CollabRepository {
  constructor(private readonly db: Db) {}

  /** 활동 한 줄. 어떤 경로로 바뀌든 같은 기록 — 부르는 쪽이 규칙(무엇을 남길지)을 안다 */
  private async log(tx: Tx | Db, tripId: string, actorId: string | null, kind: string, subject: Record<string, unknown>): Promise<void> {
    await tx.insert(tripActivity).values({ tripId, actorId, kind, subject });
  }

  // ── 멤버 ──

  async listMembers(tripId: string, viewerId: string): Promise<MemberView[]> {
    const rows = await this.db.select().from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.status, 'ACTIVE')))
      .orderBy(sql`(${tripMembers.role}='OWNER') desc, ${tripMembers.joinedAt} nulls last, ${tripMembers.id}`);
    return rows.map((m) => ({
      id: Number(m.id), user_id: m.userId, role: m.role, status: m.status, display_name: m.displayName,
      joined_at: m.joinedAt ? m.joinedAt.toISOString() : null, me: m.userId === viewerId
    }));
  }

  async findMember(memberId: number): Promise<MemberRow | null> {
    const [m] = await this.db.select().from(tripMembers).where(eq(tripMembers.id, memberId)).limit(1);
    return m ? toMemberRow(m) : null;
  }

  async findMembership(tripId: string, userId: string): Promise<MemberRow | null> {
    const [m] = await this.db.select().from(tripMembers).where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId))).limit(1);
    return m ? toMemberRow(m) : null;
  }

  async findActiveMembership(userId: string, clientId: string): Promise<(MemberRow & { ownerId: string }) | null> {
    // 나가기는 남의 여행에만 의미가 있다 — 같은 client_id를 내가 소유한 것이 있어도 그쪽을 고르지 않는다
    const [r] = await this.db.select({ m: tripMembers, ownerId: trips.userId }).from(tripMembers)
      .innerJoin(trips, eq(trips.id, tripMembers.tripId))
      .where(and(eq(trips.clientId, clientId), eq(tripMembers.userId, userId), eq(tripMembers.status, 'ACTIVE')))
      .orderBy(sql`(${trips.userId} = ${userId}) asc, ${trips.id}`).limit(1);
    return r ? { ...toMemberRow(r.m), ownerId: r.ownerId } : null;
  }

  async renameMember(memberId: number, displayName: string | null): Promise<void> {
    await this.db.update(tripMembers).set({ displayName, updatedAt: sql`now()` }).where(eq(tripMembers.id, memberId));
  }

  async setMemberRole(memberId: number, role: MemberRole): Promise<void> {
    await this.db.update(tripMembers).set({ role, updatedAt: sql`now()` }).where(eq(tripMembers.id, memberId));
  }

  /** 참여·나감·내보내짐만 기록한다. 소유자 행은 기록하지 않는다(혼자 만든 여행에 "참여했어요"가 뜨면 이상하다) */
  async setMemberStatus(memberId: number, status: MemberStatus, actorId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(tripMembers).where(eq(tripMembers.id, memberId)).for('update');
      if (!m || m.status === status) return;
      await tx.update(tripMembers).set({ status, updatedAt: sql`now()` }).where(eq(tripMembers.id, memberId));
      if (m.role === 'OWNER') return;
      const kind = status === 'ACTIVE' ? 'MEMBER_JOINED' : status === 'LEFT' ? 'MEMBER_LEFT' : status === 'REMOVED' ? 'MEMBER_REMOVED' : null;
      if (kind) await this.log(tx, m.tripId, actorId, kind, { member_id: m.userId, role: m.role });
    });
  }

  async listPreferences(tripId: string, viewerId: string): Promise<PreferenceView[]> {
    const rows = await this.db.select().from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.status, 'ACTIVE')))
      .orderBy(sql`(${tripMembers.role}='OWNER') desc, ${tripMembers.joinedAt} nulls last, ${tripMembers.id}`);
    return rows.map((m) => ({
      user_id: m.userId, label: (m.displayName ?? '').trim() || (m.role === 'OWNER' ? '주최자' : '멤버'),
      role: m.role, mine: m.userId === viewerId, prefs: (m.prefs ?? {}) as Record<string, unknown>
    }));
  }

  async setPreference(tripId: string, userId: string, prefs: Record<string, unknown>): Promise<boolean> {
    const rows = await this.db.update(tripMembers).set({ prefs, updatedAt: sql`now()` })
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), eq(tripMembers.status, 'ACTIVE')))
      .returning({ id: tripMembers.id });
    return rows.length > 0;
  }

  // ── 초대 ──

  async createInvite(input: { tripId: string; tokenHash: string; role: string; createdBy: string; expiresAt: string; maxUses: number | null }): Promise<{ id: number; expiresAt: string }> {
    const [row] = await this.db.insert(tripInvites).values({
      tripId: input.tripId, tokenHash: input.tokenHash, role: input.role, createdBy: input.createdBy,
      expiresAt: new Date(input.expiresAt), maxUses: input.maxUses
    }).returning();
    return { id: Number(row.id), expiresAt: row.expiresAt.toISOString() };
  }

  async listInvites(tripId: string): Promise<InviteView[]> {
    const rows = await this.db.select().from(tripInvites).where(eq(tripInvites.tripId, tripId)).orderBy(desc(tripInvites.createdAt)).limit(50);
    const now = Date.now();
    return rows.map((i) => ({
      id: Number(i.id), role: i.role, expires_at: i.expiresAt.toISOString(), use_count: i.useCount, max_uses: i.maxUses,
      created_at: i.createdAt.toISOString(),
      active: i.revokedAt == null && i.expiresAt.getTime() > now && (i.maxUses == null || i.useCount < i.maxUses)
    }));
  }

  async revokeInvite(inviteId: number, tripId: string): Promise<boolean> {
    const rows = await this.db.update(tripInvites).set({ revokedAt: sql`coalesce(${tripInvites.revokedAt}, now())` })
      .where(and(eq(tripInvites.id, inviteId), eq(tripInvites.tripId, tripId))).returning({ id: tripInvites.id });
    return rows.length > 0;
  }

  async findInviteByHash(tokenHash: string): Promise<InviteRow | null> {
    const [r] = await this.db.select({ i: tripInvites, t: trips }).from(tripInvites)
      .innerJoin(trips, eq(trips.id, tripInvites.tripId)).where(eq(tripInvites.tokenHash, tokenHash)).limit(1);
    if (!r) return null;
    const data = (r.t.data ?? {}) as { name?: unknown; start?: unknown; days?: unknown };
    return {
      id: Number(r.i.id), tripId: r.i.tripId, role: r.i.role, createdBy: r.i.createdBy, expiresAt: r.i.expiresAt.toISOString(),
      revokedAt: r.i.revokedAt ? r.i.revokedAt.toISOString() : null, maxUses: r.i.maxUses, useCount: r.i.useCount, createdAt: r.i.createdAt.toISOString(),
      trip: {
        ownerId: r.t.userId, clientId: r.t.clientId, deletedAt: r.t.deletedAt ? r.t.deletedAt.toISOString() : null,
        name: typeof data.name === 'string' && data.name ? data.name : '여행',
        start: typeof data.start === 'string' ? data.start : '',
        dayCount: Array.isArray(data.days) ? data.days.length : 0
      }
    };
  }

  async acceptInvite(input: { inviteId: number; tripId: string; userId: string; role: string; displayName: string | null; invitedBy: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(tripMembers)
        .where(and(eq(tripMembers.tripId, input.tripId), eq(tripMembers.userId, input.userId))).for('update');
      if (existing) {
        await tx.update(tripMembers).set({
          role: input.role, status: 'ACTIVE', displayName: input.displayName ?? existing.displayName,
          invitedBy: input.invitedBy, joinedAt: sql`now()`, updatedAt: sql`now()`
        }).where(eq(tripMembers.id, existing.id));
      } else {
        await tx.insert(tripMembers).values({
          tripId: input.tripId, userId: input.userId, role: input.role, status: 'ACTIVE',
          displayName: input.displayName, invitedBy: input.invitedBy, joinedAt: sql`now()`
        });
      }
      await tx.update(tripInvites).set({ useCount: sql`${tripInvites.useCount} + 1` }).where(eq(tripInvites.id, input.inviteId));
      await this.log(tx, input.tripId, input.userId, 'MEMBER_JOINED', { member_id: input.userId, role: input.role });
    });
  }

  // ── 후보 ──

  async listCandidates(tripId: string, viewerId: string): Promise<CandidateView[]> {
    const q = sql.raw(`
      select c.id, c.title, c.place_id, c.lat, c.lng, c.addr, c.note, c.url, c.status, c.scheduled_ref,
             ${label('c.trip_id', 'c.proposed_by')} as proposed_by_label,
             (c.proposed_by = $viewer) as mine,
             (select r.reaction from candidate_reactions r where r.candidate_id=c.id and r.user_id=$viewer) as my_reaction,
             (select count(*)::int from candidate_reactions r where r.candidate_id=c.id and r.reaction='MUST') as must_count,
             (select count(*)::int from candidate_reactions r where r.candidate_id=c.id and r.reaction='OK') as ok_count,
             (select count(*)::int from candidate_reactions r where r.candidate_id=c.id and r.reaction='PASS') as pass_count,
             coalesce((select jsonb_agg(jsonb_build_object(
                         'name', ${label('c.trip_id', 'r.user_id')}, 'reaction', r.reaction, 'me', r.user_id=$viewer)
                         order by r.created_at, r.id)
                        from candidate_reactions r where r.candidate_id=c.id), '[]'::jsonb) as reactions,
             (select count(*)::int from trip_comments cm where cm.candidate_id=c.id) as comment_count,
             c.created_at
        from trip_candidates c
       where c.trip_id = $trip
       order by c.created_at desc, c.id desc`
      .replaceAll('$viewer', `'${viewerId}'::uuid`).replaceAll('$trip', `'${tripId}'::uuid`));
    const { rows } = (await this.db.execute(q)) as Rows;
    return rows.map((r) => ({
      id: num(r.id), title: String(r.title), place_id: (r.place_id as string | null) ?? null, lat: r.lat == null ? null : Number(r.lat),
      lng: r.lng == null ? null : Number(r.lng), addr: (r.addr as string | null) ?? null, note: (r.note as string | null) ?? null,
      url: (r.url as string | null) ?? null, status: String(r.status), scheduled_ref: (r.scheduled_ref as string | null) ?? null,
      proposed_by_label: String(r.proposed_by_label ?? '멤버'), mine: !!r.mine, my_reaction: (r.my_reaction as string | null) ?? null,
      must_count: num(r.must_count), ok_count: num(r.ok_count), pass_count: num(r.pass_count),
      reactions: (Array.isArray(r.reactions) ? r.reactions : []) as CandidateView['reactions'],
      comment_count: num(r.comment_count), created_at: iso(r.created_at)
    }));
  }

  async findCandidate(candidateId: number): Promise<CandidateRow | null> {
    const [c] = await this.db.select().from(tripCandidates).where(eq(tripCandidates.id, candidateId)).limit(1);
    return c ? { id: Number(c.id), tripId: c.tripId, proposedBy: c.proposedBy, title: c.title, status: c.status, createdAt: c.createdAt.toISOString() } : null;
  }

  /** 제안한 사람은 이미 가고 싶다는 뜻이라 MUST가 자동으로 붙는다 — 그 반응은 기록하지 않는다(담기 한 줄로 충분하다) */
  async addCandidate(tripId: string, userId: string, input: Required<CandidateInput>): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.insert(tripCandidates).values({
        tripId, title: input.title, placeId: input.place_id, lat: input.lat, lng: input.lng, addr: input.addr, note: input.note, url: input.url, proposedBy: userId
      }).returning();
      await tx.insert(candidateReactions).values({ candidateId: c.id, userId, reaction: 'MUST' }).onConflictDoNothing();
      await this.log(tx, tripId, userId, 'CANDIDATE_PROPOSED', { title: c.title, candidate_id: Number(c.id) });
      return Number(c.id);
    });
  }

  /** 남기기·바꾸기만 기록한다. 거두기(null)와 같은 반응 반복은 기록하지 않는다 */
  async setReaction(candidateId: number, userId: string, reaction: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (reaction == null) {
        await tx.delete(candidateReactions).where(and(eq(candidateReactions.candidateId, candidateId), eq(candidateReactions.userId, userId)));
        return;
      }
      const [prev] = await tx.select().from(candidateReactions)
        .where(and(eq(candidateReactions.candidateId, candidateId), eq(candidateReactions.userId, userId))).limit(1);
      await tx.insert(candidateReactions).values({ candidateId, userId, reaction })
        .onConflictDoUpdate({ target: [candidateReactions.candidateId, candidateReactions.userId], set: { reaction, updatedAt: sql`now()` } });
      if (prev?.reaction === reaction) return;
      const [c] = await tx.select().from(tripCandidates).where(eq(tripCandidates.id, candidateId)).limit(1);
      if (c) await this.log(tx, c.tripId, userId, 'REACTION', { title: c.title, candidate_id: Number(c.id), reaction });
    });
  }

  /** 일정에 넣기·제외만 기록한다. 되돌리기(UNSCHEDULE·REOPEN)는 기록하지 않는다 */
  async setCandidateStatus(candidateId: number, status: string, scheduledRef: string | null, actorId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(tripCandidates).where(eq(tripCandidates.id, candidateId)).for('update');
      if (!c) return;
      await tx.update(tripCandidates).set({ status, scheduledRef, updatedAt: sql`now()` }).where(eq(tripCandidates.id, candidateId));
      if (status === 'SCHEDULED' && c.status !== 'SCHEDULED') {
        await this.log(tx, c.tripId, actorId, 'CANDIDATE_SCHEDULED', { title: c.title, candidate_id: Number(c.id), ref: scheduledRef });
      } else if (status === 'REJECTED' && c.status !== 'REJECTED') {
        await this.log(tx, c.tripId, actorId, 'CANDIDATE_REJECTED', { title: c.title, candidate_id: Number(c.id) });
      }
    });
  }

  /** 빼기는 기록하지 않는다. 반응·코멘트는 cascade */
  async removeCandidate(candidateId: number): Promise<void> {
    await this.db.delete(tripCandidates).where(eq(tripCandidates.id, candidateId));
  }

  // ── 코멘트 ──

  async listComments(candidateId: number, viewerId: string): Promise<CommentView[]> {
    const q = sql.raw(`
      select cm.id, cm.body, ${label('cm.trip_id', 'cm.user_id')} as author_label, (cm.user_id = $viewer) as mine, cm.created_at
        from trip_comments cm where cm.candidate_id = $cand order by cm.created_at, cm.id`
      .replaceAll('$viewer', `'${viewerId}'::uuid`).replaceAll('$cand', String(Number(candidateId))));
    const { rows } = (await this.db.execute(q)) as Rows;
    return rows.map((r) => ({ id: num(r.id), body: String(r.body), author_label: String(r.author_label ?? '멤버'), mine: !!r.mine, created_at: iso(r.created_at) }));
  }

  async addComment(tripId: string, candidateId: number, userId: string, body: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [cm] = await tx.insert(tripComments).values({ tripId, candidateId, userId, body }).returning();
      const [c] = await tx.select({ title: tripCandidates.title }).from(tripCandidates).where(eq(tripCandidates.id, candidateId)).limit(1);
      await this.log(tx, tripId, userId, 'COMMENT_ADDED', { title: c?.title ?? '', candidate_id: candidateId, excerpt: body.slice(0, 60) });
      return Number(cm.id);
    });
  }

  async findComment(commentId: number): Promise<CommentRow | null> {
    const [cm] = await this.db.select().from(tripComments).where(eq(tripComments.id, commentId)).limit(1);
    return cm ? { id: Number(cm.id), tripId: cm.tripId, candidateId: Number(cm.candidateId), userId: cm.userId } : null;
  }

  async deleteComment(commentId: number): Promise<boolean> {
    const rows = await this.db.delete(tripComments).where(eq(tripComments.id, commentId)).returning({ id: tripComments.id });
    return rows.length > 0;
  }

  // ── 활동 ──

  async listActivity(tripId: string, viewerId: string, limit: number): Promise<ActivityView[]> {
    const n = Math.max(1, Math.min(limit || 40, 200));
    const q = sql.raw(`
      select a.id, a.kind, coalesce(${label('a.trip_id', 'a.actor_id')}, '멤버') as actor_label,
             (a.actor_id = $viewer) as mine,
             case when a.subject ? 'member_id'
                  then coalesce(${label('a.trip_id', "(a.subject->>'member_id')::uuid")}, '멤버') end as member_label,
             a.subject, a.created_at
        from trip_activity a where a.trip_id = $trip order by a.id desc limit ${n}`
      .replaceAll('$viewer', `'${viewerId}'::uuid`).replaceAll('$trip', `'${tripId}'::uuid`));
    const { rows } = (await this.db.execute(q)) as Rows;
    return rows.map((r) => ({
      id: num(r.id), kind: String(r.kind), actor_label: String(r.actor_label ?? '멤버'), mine: !!r.mine,
      member_label: (r.member_label as string | null) ?? null, subject: (r.subject ?? {}) as Record<string, unknown>, created_at: iso(r.created_at)
    }));
  }
}
