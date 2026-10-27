import { createPrivateKey, type KeyObject } from 'node:crypto';

export interface ApnsConfig { teamId: string; keyId: string; privateKey: KeyObject }
export class ApnsConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ApnsConfigError'; }
}

/** 비어 있으면 꺼져 있다. 일부만 있거나 잘못된 키는 정상 미설정과 구분한다. 비밀은 오류에 넣지 않는다. */
export function readApnsConfig(env: Record<string, string | undefined>): ApnsConfig | null {
  const teamId = (env.APNS_TEAM_ID ?? '').trim();
  const keyId = (env.APNS_KEY_ID ?? '').trim();
  const pem = (env.APNS_PRIVATE_KEY ?? '').trim().replaceAll('\\n', '\n');
  if (!teamId && !keyId && !pem) return null;
  for (const [name, value] of [['APNS_TEAM_ID', teamId], ['APNS_KEY_ID', keyId]]) {
    if (!/^[A-Z0-9]{10}$/.test(value!)) throw new ApnsConfigError(`${name}: 10자리 Apple 식별자가 필요합니다`);
  }
  try {
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('P256');
    }
    return { teamId, keyId, privateKey };
  } catch {
    throw new ApnsConfigError('APNS_PRIVATE_KEY: P256 APNs 비밀키가 필요합니다');
  }
}
