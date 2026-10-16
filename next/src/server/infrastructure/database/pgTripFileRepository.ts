import { and, asc, eq } from 'drizzle-orm';
import { ApiError } from '../../api/errors';
import { TRIP_FILE_LIMIT, type FileInput, type FilePatch, type TripFile, type TripFileRepository } from '../../application/trip/tripFiles';
import type { Db } from './db';
import { tripFiles, tripMembers, trips } from './schema';

const metadata = {
  id: tripFiles.id, kind: tripFiles.kind, placeKey: tripFiles.placeKey,
  name: tripFiles.name, title: tripFiles.title, mime: tripFiles.mime,
  size: tripFiles.size, position: tripFiles.position, createdAt: tripFiles.createdAt
};
function publicFile(row: {
  id: string; kind: string; placeKey: string; name: string; title: string; mime: string;
  size: number; position: number; createdAt: Date;
}): TripFile {
  return { id: row.id, kind: row.kind as TripFile['kind'], placeKey: row.placeKey, name: row.name,
    title: row.title, mime: row.mime, size: row.size, position: row.position, createdAt: row.createdAt.toISOString() };
}
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class PgTripFileRepository implements TripFileRepository {
  constructor(private readonly db: Db) {}
  /** Lock both trip and active membership. Revocation cannot race a file read/write. */
  private access<T>(tripId: string, userId: string, write: boolean, run: (tx: Tx, canEdit: boolean) => Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      const [trip] = await tx.select().from(trips).where(eq(trips.id, tripId)).for(write ? 'update' : 'share');
      if (!trip || trip.deletedAt) throw new ApiError('NOT_FOUND');
      let role: string | null = trip.userId === userId ? 'OWNER' : null;
      if (!role) {
        const [member] = await tx.select().from(tripMembers)
          .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId))).for('share');
        if (member?.status === 'ACTIVE') role = member.role;
      }
      if (!role) throw new ApiError('NOT_FOUND');
      const canEdit = role === 'OWNER' || role === 'EDITOR';
      if (write && !canEdit) throw new ApiError('FORBIDDEN');
      return run(tx, canEdit);
    });
  }
  list(tripId: string, userId: string) {
    return this.access(tripId, userId, false, async (tx, canEdit) => ({
      files: (await tx.select(metadata).from(tripFiles).where(eq(tripFiles.tripId, tripId))
        .orderBy(asc(tripFiles.position), asc(tripFiles.createdAt), asc(tripFiles.id))).map(publicFile), canEdit
    }));
  }
  get(tripId: string, userId: string, id: string) {
    return this.access(tripId, userId, false, async tx => {
      const [row] = await tx.select().from(tripFiles).where(and(eq(tripFiles.tripId, tripId), eq(tripFiles.id, id)));
      if (!row) throw new ApiError('NOT_FOUND', { message: '파일을 찾을 수 없어요.' });
      return { ...publicFile(row), contentBase64: row.contentBase64, sha256: row.sha256 };
    });
  }
  save(tripId: string, userId: string, file: FileInput) {
    return this.access(tripId, userId, true, async tx => {
      const all = await tx.select({ ...metadata, sha256: tripFiles.sha256 }).from(tripFiles).where(eq(tripFiles.tripId, tripId));
      const existing = all.find(row => row.sha256 === file.sha256 && row.kind === file.kind && row.placeKey === file.placeKey);
      if (existing) return publicFile(existing);
      if (all.length >= 100 || all.reduce((sum, row) => sum + row.size, 0) + file.size > TRIP_FILE_LIMIT) {
        throw new ApiError('VALIDATION_ERROR', { message: '여행 파일은 최대 100개, 총 200MB까지 보관할 수 있어요. 필요 없는 파일을 지운 뒤 다시 추가해 주세요.' });
      }
      const { createdAt: _createdAt, ...values } = file;
      const [row] = await tx.insert(tripFiles).values({
        ...values, tripId, uploadedBy: userId, position: all.reduce((max, row) => Math.max(max, row.position + 1), 0)
      }).returning(metadata);
      return publicFile(row);
    });
  }
  edit(tripId: string, userId: string, id: string, patch: FilePatch) {
    return this.access(tripId, userId, true, async tx => {
      const { move, ...values } = patch;
      if (move) {
        const all = await tx.select(metadata).from(tripFiles).where(eq(tripFiles.tripId, tripId))
          .orderBy(asc(tripFiles.position), asc(tripFiles.createdAt), asc(tripFiles.id));
        const current = all.find(row => row.id === id);
        if (!current) throw new ApiError('NOT_FOUND');
        const group = all.filter(row => row.kind === current.kind && row.placeKey === current.placeKey);
        const at = group.findIndex(row => row.id === id), other = at + (move === 'UP' ? -1 : 1);
        if (group[other]) [group[at], group[other]] = [group[other], group[at]];
        // Normalize positions, including ties from older clients, within this place.
        for (const [index, row] of group.entries()) {
          await tx.update(tripFiles).set({ position: index }).where(eq(tripFiles.id, row.id));
        }
      }
      if (!Object.keys(values).length) return;
      const rows = await tx.update(tripFiles).set(values).where(and(eq(tripFiles.tripId, tripId), eq(tripFiles.id, id))).returning({ id: tripFiles.id });
      if (!rows.length) throw new ApiError('NOT_FOUND');
    });
  }
  remove(tripId: string, userId: string, id: string) {
    return this.access(tripId, userId, true, async tx => {
      await tx.delete(tripFiles).where(and(eq(tripFiles.tripId, tripId), eq(tripFiles.id, id)));
    });
  }
}
