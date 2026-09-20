// 여행 기간 상한이 웹·서버·앱에서 같은 숫자인지 본다.
//
// 한계를 정하는 곳은 `lib.js`의 `TC_LIMITS` 하나다 — 서버가 생성·수정 양쪽에서
// `validateTripPayload`를 지나므로 그 숫자가 곧 저장할 수 있는 최대치다.
// 앱은 그 값을 **미리 알아** 못 저장할 기간을 입력 단계에서 막는 복사본을 들고 있다.
//
// 숫자가 갈리면 화면마다 다른 답이 나온다. 2026-09-20 전에는 새 여행 30일 · 여행 설정 60일 ·
// 웹 90일이라, 웹에서 만든 여행을 앱이 열면 이름조차 고칠 수 없었다.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import legacyLib from '@legacy/lib.js';

const SWIFT = readFileSync(
  path.join(__dirname, '../../../../../ios/TripCanvas/Core/Models/TripDocument.swift'), 'utf8');

/** `enum TripLimits`의 `static let <name> = <정수>` 를 읽는다. */
function swiftLimit(name: string): number {
  const match = new RegExp(`static\\s+let\\s+${name}\\s*=\\s*(\\d+)`).exec(SWIFT);
  if (!match) throw new Error(`TripDocument.swift의 TripLimits에 ${name}이 없습니다`);
  return Number(match[1]);
}

describe('여행 기간 상한 — lib.js ↔ iOS', () => {
  it('lib.js가 한계를 정하고 앱이 같은 숫자를 든다', () => {
    expect(legacyLib.TC_LIMITS.days).toBe(90);
    expect(swiftLimit('maxDays')).toBe(legacyLib.TC_LIMITS.days);
  });

  it('상한까지는 저장되고 하나만 넘어도 거부된다', () => {
    const trip = (dayCount: number) => ({
      id: 'limit', name: '장기 여행', start: '2026-10-01',
      days: Array.from({ length: dayCount }, () => ({ title: '', drive: '', note: '', spots: [] }))
    });
    expect(legacyLib.validateTripPayload(trip(legacyLib.TC_LIMITS.days)).ok).toBe(true);

    const over = legacyLib.validateTripPayload(trip(legacyLib.TC_LIMITS.days + 1));
    expect(over.ok).toBe(false);
    // 앱이 막아 주는 이유 — 서버까지 갔다가 이 문장을 받는 대신 입력에서 멈춘다
    expect(over.ok ? '' : over.error).toContain(`${legacyLib.TC_LIMITS.days}일`);
  });
});
