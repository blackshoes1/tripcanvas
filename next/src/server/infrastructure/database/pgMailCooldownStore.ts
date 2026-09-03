import { and, eq, sql } from 'drizzle-orm';

import type { MailCooldownStore, MailKind } from '../mail/types';
import type { Db } from './db';
import { authMailCooldown } from './schema';

/** 재시작·다중 인스턴스에서도 유지되도록 DB에 둔다(메모리면 재시작마다 쿨다운이 풀린다) */
export class PgMailCooldownStore implements MailCooldownStore {
  constructor(private readonly db: Db) {}

  async lastSentAt(email: string, kind: MailKind): Promise<number | null> {
    const [row] = await this.db.select({ at: authMailCooldown.lastSentAt }).from(authMailCooldown)
      .where(and(eq(authMailCooldown.email, email), eq(authMailCooldown.kind, kind))).limit(1);
    return row ? row.at.getTime() : null;
  }

  async markSent(email: string, kind: MailKind, at: number): Promise<void> {
    await this.db.insert(authMailCooldown).values({ email, kind, lastSentAt: new Date(at) })
      .onConflictDoUpdate({ target: [authMailCooldown.email, authMailCooldown.kind], set: { lastSentAt: new Date(at) } });
  }
}
