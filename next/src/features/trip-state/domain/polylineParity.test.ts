// 경로 폴리라인 — 서버가 보내는 문자열을 앱이 **같은 점들로** 푸는지.
//
// ⚠️ 인코딩은 `lib.js`(`encodePolyline`) 하나다. 카카오 경로도 여기서 인코딩되므로
// 구글·카카오 지도가 같은 형식을 받는다. 규칙을 바꾸려면 `lib.js`를 먼저 고친다 —
// 그러면 이 테스트가 픽스처를 새로 쓰고 iOS 테스트가 깨진다(그게 목적이다).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import lib from '@legacy/lib.js';

const cases: { name: string; points: { lat: number; lng: number }[] }[] = [
  { name: '빈 경로', points: [] },
  { name: '두 점', points: [{ lat: 33.5104, lng: 126.4914 }, { lat: 33.4587, lng: 126.9425 }] },
  {
    name: '도로 한 구간 (음수 델타 포함)',
    points: [
      { lat: 37.5665, lng: 126.978 }, { lat: 37.5701, lng: 126.9822 },
      { lat: 37.5688, lng: 126.9901 }, { lat: 37.5602, lng: 126.9955 }
    ]
  },
  // 남반구·서반구 — 부호가 뒤집혀도 같은 점이 나와야 한다
  { name: '음수 좌표', points: [{ lat: -33.8688, lng: 151.2093 }, { lat: -37.8136, lng: 144.9631 }] },
  { name: '적도와 본초자오선', points: [{ lat: 0, lng: 0 }, { lat: 0.00001, lng: -0.00002 }] }
];

describe('폴리라인 — lib.js가 단일 출처', () => {
  it('iOS 픽스처를 실제 인코딩으로 갱신한다', () => {
    const rows = cases.map((c) => {
      const encoded = lib.encodePolyline(c.points);
      return { name: c.name, encoded, points: lib.decodePolyline(encoded) };
    });

    // 왕복이 원본과 같아야 한다(1e5 반올림 범위 안)
    for (const [i, row] of rows.entries()) {
      expect(row.points).toHaveLength(cases[i].points.length);
      row.points.forEach((p, j) => {
        expect(p.lat).toBeCloseTo(cases[i].points[j].lat, 5);
        expect(p.lng).toBeCloseTo(cases[i].points[j].lng, 5);
      });
    }
    // 빈 문자열은 빈 배열 — 없는 길을 지어내지 않는다
    expect(lib.decodePolyline('')).toEqual([]);

    const dir = path.join(__dirname, '../../../../../ios/TripCanvasTests/Fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'polyline.json'),
                  JSON.stringify({ cases: rows }, null, 2) + String.fromCharCode(10));
  });
});
