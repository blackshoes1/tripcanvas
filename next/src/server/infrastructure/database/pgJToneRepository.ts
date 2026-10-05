import { eq } from 'drizzle-orm';
import type { JTone, JToneRepository } from '../../application/account/jToneService';
import type { Db } from './db';
import { users } from './schema';

export class PgJToneRepository implements JToneRepository {
  constructor(private readonly db: Db) {}
  async read(userId: string): Promise<JTone> {
    const [row] = await this.db.select({ tone: users.jTone }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.tone === 'CASUAL' || row?.tone === 'POLITE' ? row.tone : 'FRIENDLY';
  }
  async save(userId: string, tone: JTone): Promise<void> {
    await this.db.update(users).set({ jTone: tone }).where(eq(users.id, userId));
  }
}
