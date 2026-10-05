import copy from '@legacy/j-copy.js';
import { ApiError } from '../../api/errors';

export type JTone = 'FRIENDLY' | 'CASUAL' | 'POLITE';
export interface JToneRepository {
  read(userId: string): Promise<JTone>;
  save(userId: string, tone: JTone): Promise<void>;
}

/** 호출자의 개인 설정만 다룬다. 여행 ID나 body의 userId로 저장 대상을 고르지 않는다. */
export class JToneService {
  constructor(private readonly repo: JToneRepository | null, private readonly userId: string) {}
  async read(): Promise<{ jTone: JTone }> {
    return { jTone: this.repo ? await this.repo.read(this.userId) : 'FRIENDLY' };
  }
  async save(value: unknown): Promise<{ jTone: JTone }> {
    if (!copy.choices.some((c) => c.id === value)) throw new ApiError('VALIDATION_ERROR');
    if (!this.repo) throw new ApiError('MAINTENANCE', { message: '계정 설정 저장을 준비 중이에요.' });
    const jTone = copy.normalizeTone(value);
    await this.repo.save(this.userId, jTone);
    return { jTone };
  }
}
