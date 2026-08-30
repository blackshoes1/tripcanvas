import { describe, expect, it } from 'vitest';
import LZString from 'lz-string';

import type { Trip } from '@/features/trip/domain/types';
import {
  SHARE_URL_MAX, buildShareUrl, claimSharedTrip, decodeSharedTrip, readShareHash
} from './shareLink';
import { exportFilename, exportJson, importTrip } from './tripFile';

const compress = (s: string) => LZString.compressToEncodedURIComponent(s);
const decompress = (s: string) => LZString.decompressFromEncodedURIComponent(s);
const BASE = { origin: 'https://tripcanvas-ai.vercel.app', pathname: '/' };

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1', name: '제주 3박', start: '2026-11-05',
    days: [{ title: '도착', drive: '', note: '', mode: 'car', spots: [
      { name: '제주공항', city: '제주', desc: '', lat: 33.507, lng: 126.493 }
    ] }],
    ...over
  };
}

describe('readShareHash', () => {
  it('#v=는 읽기전용 보기', () => {
    expect(readShareHash('#v=abc')).toEqual({ kind: 'view', encoded: 'abc' });
  });
  it('#t=는 구버전 호환', () => {
    expect(readShareHash('#t=abc')).toEqual({ kind: 'legacy', encoded: 'abc' });
  });
  it('그 밖의 해시는 공유 링크가 아니다', () => {
    for (const h of ['', '#', '#day=2', '#vv=abc', 'v=abc']) {
      expect(readShareHash(h).kind).toBe('none');
    }
  });
});

describe('buildShareUrl', () => {
  it('#v= 링크를 만든다', () => {
    const r = buildShareUrl(trip(), BASE, compress);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.startsWith('https://tripcanvas-ai.vercel.app/#v=')).toBe(true);
  });

  it('만든 링크는 그대로 다시 읽힌다 (왕복)', () => {
    const r = buildShareUrl(trip(), BASE, compress);
    if (!r.ok) throw new Error('링크를 만들지 못했다');
    const back = decodeSharedTrip(readShareHash(new URL(r.url).hash).kind === 'view'
      ? r.url.split('#v=')[1] : '', decompress);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.trip.name).toBe('제주 3박');
      expect(back.trip.days[0].spots[0].name).toBe('제주공항');
      expect(back.trip.days[0].spots[0].lat).toBeCloseTo(33.507, 5);
    }
  });

  it('너무 긴 여행은 링크로 만들지 않고 파일을 권한다', () => {
    const big = trip({ days: Array.from({ length: 60 }, (_, i) => ({
      title: `Day ${i}`, drive: '', note: '메모'.repeat(80), mode: 'car' as const,
      spots: Array.from({ length: 12 }, (_, k) => ({
        name: `장소 ${i}-${k} 아주 긴 이름을 넣어 압축이 덜 되게 한다 ${Math.random()}`,
        city: `도시${i}`, desc: '설명'.repeat(30), lat: 33 + i * 0.01, lng: 126 + k * 0.01
      }))
    })) });
    const r = buildShareUrl(big, BASE, compress);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/내보내기/);
  });

  it('상한 바로 아래는 만들어진다', () => {
    const r = buildShareUrl(trip(), BASE, compress);
    if (!r.ok) throw new Error('링크를 만들지 못했다');
    expect(r.url.length).toBeLessThanOrEqual(SHARE_URL_MAX);
  });

  it('압축기가 던져도 앱을 깨뜨리지 않는다', () => {
    const r = buildShareUrl(trip(), BASE, () => { throw new Error('boom'); });
    expect(r.ok).toBe(false);
  });
});

describe('decodeSharedTrip', () => {
  it('허용 길이를 넘는 링크는 풀어보지도 않는다', () => {
    let called = false;
    const r = decodeSharedTrip('x'.repeat(12001), s => { called = true; return s; });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('만들 때의 상한(8000)보다 긴 링크도 읽기는 한다 — 12000까지', () => {
    // 받는 쪽이 우리보다 좁으면 되살릴 방법이 없다
    const payload = compress(JSON.stringify(trip()));
    expect(decodeSharedTrip(payload, decompress).ok).toBe(true);
    let seen = 0;
    decodeSharedTrip('x'.repeat(9000), s => { seen = s.length; return null; });
    expect(seen).toBe(9000);
  });

  it('풀리지 않는 링크는 크기 탓이 아니라 해석 실패로 말한다', () => {
    // LZString은 못 푸는 입력에 예외가 아니라 null을 준다 → '크기 초과'로 뭉뚱그리면 엉뚱한 안내가 된다
    const r = decodeSharedTrip('망가진링크', () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/해석/);
      expect(r.error).not.toMatch(/크기/);
    }
  });

  it('풀리긴 했지만 JSON이 아니면 그렇게 말한다', () => {
    // 같은 '망가진 링크'라도 원인이 다르면 다르게 말해야 고칠 수 있다
    const r = decodeSharedTrip('!!!아무거나!!!', decompress);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/);
  });

  it('압축 해제기가 던져도 이유를 말한다', () => {
    const r = decodeSharedTrip('abc', () => { throw new Error('boom'); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/해석/);
  });

  it('푼 결과가 여행 모양이 아니면 거절한다', () => {
    const r = decodeSharedTrip(compress(JSON.stringify({ hello: 'world' })), decompress);
    expect(r.ok).toBe(false);
  });

  it('푼 결과가 JSON이 아니면 거절한다', () => {
    const r = decodeSharedTrip(compress('그냥 텍스트'), decompress);
    expect(r.ok).toBe(false);
  });

  it('푼 결과가 너무 크면 파싱 전에 거절한다 (압축 폭탄)', () => {
    const huge = 'a'.repeat(3 * 1024 * 1024);
    const r = decodeSharedTrip('short', () => huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/크기/);
  });

  // 유입 데이터에는 판정이 둘 있고 섞으면 안 된다:
  // '모양이 틀렸다'는 거절, '값이 이상하다'는 기본값 폴백.
  it('알 수 없는 값은 기본값으로 눕혀서 받는다', () => {
    const dirty = { id: 't9', name: '더러운 여행', start: '2026-01-01', days: [
      { title: 'x', drive: '', note: '', mode: '순간이동', spots: [
        { name: '좌표 없음', city: '', desc: '' },
        { name: '통화 이상', city: '', desc: '', lat: 33, lng: 126, cur: 'XBT', cost: 1000 }
      ] }
    ] };
    const r = decodeSharedTrip(compress(JSON.stringify(dirty)), decompress);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trip.days[0].mode).toBe('car');            // 알 수 없는 수단 → 기본값
      expect(r.trip.days[0].spots[0].lat).toBeNull();     // 좌표 없음은 그대로 '없음'
      expect(r.trip.days[0].spots[0].city).toBe('기타');   // 빈 도시 → 기본값
      expect(r.trip.days[0].spots[1].cur).not.toBe('XBT');
      expect(r.trip.schemaVersion).toBeGreaterThan(0);    // 스탬프가 찍힌다
    }
  });

  it('반쪽 좌표는 눕히지 않고 거절한다 — (0,0)으로 둔갑하면 동선이 오염된다', () => {
    const half = { id: 't9', name: 'x', start: '2026-01-01', days: [
      { title: 'x', drive: '', note: '', mode: 'car', spots: [
        { name: '반쪽', city: '제주', desc: '', lat: 33.5, lng: null }
      ] }
    ] };
    const r = decodeSharedTrip(compress(JSON.stringify(half)), decompress);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/위도와 경도/);
  });
});

describe('claimSharedTrip', () => {
  it('새 id를 달아 내 것으로 만든다', () => {
    const t = claimSharedTrip(trip(), 'tNEW');
    expect(t.id).toBe('tNEW');
    expect(t.name).toBe('제주 3박');
  });
  it('이름이 비면 채운다', () => {
    expect(claimSharedTrip(trip({ name: '' }), 'tNEW').name).toBe('공유된 여행');
  });
  it('원본을 건드리지 않는다 (깊은 복사)', () => {
    const src = trip();
    const t = claimSharedTrip(src, 'tNEW');
    t.days[0].spots[0].name = '바뀜';
    expect(src.days[0].spots[0].name).toBe('제주공항');
    expect(src.id).toBe('t1');
  });
});

describe('exportFilename', () => {
  it('공백을 밑줄로 바꾼다', () => {
    expect(exportFilename('제주 3박 4일')).toBe('제주_3박_4일.json');
  });
  it('연속 공백·탭도 하나로', () => {
    expect(exportFilename('제주  \t 여행')).toBe('제주_여행.json');
  });
  it('이름이 비면 기본값', () => {
    expect(exportFilename('')).toBe('여행.json');
  });
  it('확장자를 바꿀 수 있다 (이미지 내보내기)', () => {
    expect(exportFilename('제주 여행', 'png')).toBe('제주_여행.png');
  });
});

describe('exportJson / importTrip', () => {
  it('내보낸 파일을 그대로 다시 가져올 수 있다 (왕복)', () => {
    const r = importTrip(exportJson(trip()), 'tNEW');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trip.name).toBe('제주 3박');
      expect(r.trip.days[0].spots[0].name).toBe('제주공항');
    }
  });

  it('가져온 여행에는 새 id를 단다 — 같은 파일을 두 번 가져와도 덮어쓰지 않는다', () => {
    const json = exportJson(trip());
    const a = importTrip(json, 'tA'), b = importTrip(json, 'tB');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.trip.id).not.toBe(b.trip.id);
  });

  it('사람이 읽을 수 있게 들여쓴다', () => {
    expect(exportJson(trip())).toContain('\n  "name"');
  });

  it('JSON이 아니면 이유를 말한다', () => {
    const r = importTrip('이건 JSON이 아니다', 'tNEW');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/);
  });

  it('여행 모양이 아니면 거절한다', () => {
    expect(importTrip(JSON.stringify({ trips: [] }), 'tNEW').ok).toBe(false);
    expect(importTrip(JSON.stringify([1, 2, 3]), 'tNEW').ok).toBe(false);
    expect(importTrip('null', 'tNEW').ok).toBe(false);
  });

  it('예약도 함께 오간다', () => {
    const withBooking = trip({ bookings: [{
      id: 'b1', type: 'hotel', title: '호텔', price: 200000, cur: 'KRW', track: true,
      start: '2026-11-05', end: '2026-11-06'
    }] });
    const r = importTrip(exportJson(withBooking), 'tNEW');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.trip.bookings?.[0].title).toBe('호텔');
      expect(r.trip.bookings?.[0].price).toBe(200000);
    }
  });
});
