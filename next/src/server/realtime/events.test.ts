// 실시간 이벤트(§43·§44) — 페이로드는 작게: 무엇이·어느 여행에서 바뀌었는지만. 내용은 클라이언트가 API로 다시 읽는다(§41·§45).
// 다른 사람의 user id는 내보내지 않는다 — '내가 한 것인가'(mine)는 서버가 구독자마다 계산해서 붙인다.
import { describe, expect, it } from 'vitest';

import { messageFor, parseNotification } from './events';

const payload = (over: Record<string, unknown> = {}) => JSON.stringify({
  tripId: '00000000-0000-0000-0000-0000000000t1', clientId: 'trip1', id: 12, kind: 'REACTION', actorId: 'u-b', ...over
});

describe('parseNotification', () => {
  it('트리거가 보낸 JSON을 이벤트로 읽는다', () => {
    expect(parseNotification(payload())).toEqual({
      tripId: '00000000-0000-0000-0000-0000000000t1', clientId: 'trip1', id: 12, kind: 'REACTION', actorId: 'u-b'
    });
  });

  it('actorId는 없을 수 있다(계정이 지워진 뒤의 기록)', () => {
    expect(parseNotification(payload({ actorId: null }))?.actorId).toBeNull();
  });

  it('JSON이 아니거나 필수 값이 빠지면 null — 이상한 payload로 서버가 죽지 않는다', () => {
    expect(parseNotification('not json')).toBeNull();
    expect(parseNotification('')).toBeNull();
    expect(parseNotification('[1,2]')).toBeNull();
    expect(parseNotification(payload({ clientId: '' }))).toBeNull();
    expect(parseNotification(payload({ kind: undefined }))).toBeNull();
    expect(parseNotification(payload({ id: 'abc' }))).toBeNull();
  });
});

describe('messageFor', () => {
  const event = parseNotification(payload())!;

  it('구독자에게 갈 메시지에는 여행 id(clientId)·활동 id·종류·mine만 담긴다', () => {
    expect(messageFor(event, 'u-a')).toEqual({ type: 'ACTIVITY', tripId: 'trip1', id: 12, kind: 'REACTION', mine: false });
  });

  it('내가 한 것이면 mine — 클라이언트가 제 저장을 다시 당기지 않게(liveEffects)', () => {
    expect(messageFor(event, 'u-b').mine).toBe(true);
  });

  it('내부 식별자(trips.id)와 다른 사람의 user id는 나가지 않는다', () => {
    const json = JSON.stringify(messageFor(event, 'u-a'));
    expect(json).not.toMatch(/0000000000t1/);
    expect(json).not.toMatch(/u-b/);
  });
});
