// 본문 크기 상한 — 파싱 전에 센다. 정상 클라이언트가 보내는 가장 큰 본문(상한에 닿은 여행 문서)은 지나가야 한다.
import lib from '@legacy/lib.js';
import { describe, expect, it } from 'vitest';

import { readJsonBody, REQUEST_BODY_MAX_BYTES } from './jsonBody';

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://api.test/x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

/** 길이 헤더 없이 조각으로 오는 본문(청크 전송). 몇 조각을 읽혔는지 센다 */
function chunked(chunk: string, times: number): { request: Request; pulled: () => number } {
  const bytes = new TextEncoder().encode(chunk);
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= times) { controller.close(); return; }
      pulled += 1;
      controller.enqueue(bytes);
    }
  });
  const request = new Request('http://api.test/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  return { request, pulled: () => pulled };
}

describe('readJsonBody', () => {
  it('JSON 객체를 그대로 준다', async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: 1, b: '한글' })))).toEqual({ ok: true, value: { a: 1, b: '한글' } });
  });

  it('본문이 없거나 JSON이 아니면 INVALID — 던지지 않는다', async () => {
    expect(await readJsonBody(new Request('http://api.test/x', { method: 'POST' }))).toEqual({ ok: false, reason: 'INVALID' });
    expect(await readJsonBody(post('{깨짐'))).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('길이를 밝힌 큰 본문은 읽지도 않는다', async () => {
    const request = post('{}', { 'content-length': String(REQUEST_BODY_MAX_BYTES + 1) });
    expect(await readJsonBody(request)).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(request.bodyUsed).toBe(false);
  });

  it('길이를 밝히지 않은 본문도 상한에서 읽기를 멈춘다 — 끝까지 받은 뒤에 거절하지 않는다', async () => {
    const { request, pulled } = chunked('x'.repeat(1024), 1000);   // 약 1MB를 보내려 한다
    expect(await readJsonBody(request, 10 * 1024)).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(pulled()).toBeLessThan(20);
  });

  it('상한에 닿은 여행 문서도 지나간다 — iOS 인코더처럼 `/`를 `\\/`로 쓰고 봉투를 붙여도', async () => {
    // 서버가 다시 직렬화해 2 MiB 바로 아래가 되는 문서 — validateTripPayload가 받는 가장 큰 문서다
    const spots = Array.from({ length: 150 }, (_, i) => ({ name: `장소 ${i}`, lat: 37.5, lng: 127, note: '' }));
    const trip: Record<string, unknown> = { id: 'trip1', name: '큰 여행', start: '2026-10-25', days: [{ mode: 'car', spots }] };
    const base = Buffer.byteLength(JSON.stringify(trip));
    const room = lib.TC_LIMITS.jsonBytes - base - 64;
    // 한글(3바이트)과 '/'를 섞어 상한 바로 아래까지 채운다 — 문서 한 칸의 글자 상한(stringChars)을 지키며 여러 칸에 나눈다
    const unit = '여행/';   // 7바이트, '/' 하나
    const per = Math.floor(lib.TC_LIMITS.stringChars / unit.length) * unit.length;
    let left = Math.floor(room / Buffer.byteLength(unit)) * unit.length;
    for (const spot of spots) {
      if (left <= 0) break;
      const take = Math.min(per, left);
      spot.note = unit.repeat(take / unit.length);
      left -= take;
    }
    const checked = lib.validateTripPayload(trip);
    expect(checked.ok).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(trip))).toBeGreaterThan(lib.TC_LIMITS.jsonBytes * 0.95);

    const wire = JSON.stringify({ trip, expectedRevision: 12, force: false }).replace(/\//g, '\\/');
    expect(Buffer.byteLength(wire)).toBeGreaterThan(lib.TC_LIMITS.jsonBytes);   // 예전 미리보기 상한(문서+1KB)이면 막혔을 크기
    const read = await readJsonBody(post(wire, { 'content-length': String(Buffer.byteLength(wire)) }));
    expect(read.ok).toBe(true);
    expect((read as { value: { trip: { name: string } } }).value.trip.name).toBe('큰 여행');
  });
});
