import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ApnsConfigError, readApnsConfig } from './apnsConfig';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const valid = { APNS_TEAM_ID: 'ABCDEFGHIJ', APNS_KEY_ID: '0123456789', APNS_PRIVATE_KEY: pem };

describe('APNs 설정', () => {
  it('세 값이 모두 비면 꺼져 있다', () => {
    expect(readApnsConfig({})).toBeNull();
    expect(readApnsConfig({ APNS_TEAM_ID: ' ' })).toBeNull();
  });

  it('일부만 설정되면 미설정으로 숨기지 않는다', () => {
    expect(() => readApnsConfig({ APNS_TEAM_ID: 'ABCDEFGHIJ' })).toThrow(ApnsConfigError);
    expect(() => readApnsConfig({ APNS_PRIVATE_KEY: pem })).toThrow(/APNS_TEAM_ID/);
  });

  it('10자리 식별자와 P256 비밀키를 검사하고 실제 개행·이스케이프 개행을 받는다', () => {
    for (const key of [pem, pem.replaceAll('\n', '\\n')]) {
      const config = readApnsConfig({ ...valid, APNS_PRIVATE_KEY: key });
      expect(config?.teamId).toBe('ABCDEFGHIJ');
      expect(config?.keyId).toBe('0123456789');
      expect(config?.privateKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    }
    expect(() => readApnsConfig({ ...valid, APNS_KEY_ID: 'short' })).toThrow(/APNS_KEY_ID/);
    expect(() => readApnsConfig({ ...valid, APNS_TEAM_ID: 'bad/teamid' })).toThrow(/APNS_TEAM_ID/);
  });

  it('오류에 입력값이나 키 본문을 포함하지 않는다', () => {
    const secret = 'secret-private-key-content';
    try {
      readApnsConfig({ ...valid, APNS_PRIVATE_KEY: secret });
      throw new Error('설정 오류가 필요하다');
    } catch (error) {
      expect(error).toBeInstanceOf(ApnsConfigError);
      expect(String(error)).toContain('APNS_PRIVATE_KEY');
      expect(String(error)).not.toContain(secret);
    }
  });

  it('다른 곡선·RSA·공개키는 ES256 서명키로 받지 않는다', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey;
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey;
    const keys = [
      other.export({ type: 'pkcs8', format: 'pem' }),
      rsa.export({ type: 'pkcs8', format: 'pem' }),
      publicKey.export({ type: 'spki', format: 'pem' })
    ];
    for (const key of keys) {
      expect(() => readApnsConfig({ ...valid, APNS_PRIVATE_KEY: key.toString() })).toThrow(ApnsConfigError);
    }
  });
});
