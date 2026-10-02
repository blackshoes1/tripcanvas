// 앱이 **복사해 든 표시 규칙**을 웹 원본으로 굳혀 iOS와 맞춘다.
//
// - 장소 우선순위 3단: 원본은 `lib.js`의 `SPOT_PRIORITIES`·`spotPriorityOf`·`applySpotPriority`,
//   복사본은 iOS `SpotPriority`·`TripSpot.priority`.
// - 결제 상태·비용 분류의 이름: 원본은 `app.js`의 `PAY_STATE_LABEL`·`COST_KIND`(순서는 `lib.js`),
//   복사본은 iOS `CostPayState.label`·`CostCategory.label`. CLAUDE.md가 "**글자까지 같다**"고 적어 둔 것들이다.
//
// 2026-10-02 전에는 Swift 테스트가 같은 글자를 손으로 다시 적어 대조했다 — 웹이 바뀌어도 그쪽은 초록이었다.
// ⚠️ 규칙을 바꾸려면 웹 원본을 먼저 고친다. 그러면 여기서 픽스처가 새로 쓰이고 iOS 테스트
//    (`LabelParityTests.swift`)가 깨진다 — 그게 목적이다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import legacyLib from '@legacy/lib.js';

const ROOT = path.join(__dirname, '../../../../..');
const FIXTURES = path.join(ROOT, 'ios/TripCanvasTests/Fixtures');

/** 다른 파리티 테스트와 같은 모양(2칸 들여쓰기 + 끝 LF)이고, 내용이 같으면 다시 쓰지 않는다(CRLF 체크아웃). */
function writeFixture(name: string, data: unknown) {
  const file = path.join(FIXTURES, `${name}.json`);
  const text = JSON.stringify(data, null, 2) + String.fromCharCode(10);
  const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === text) return;
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(file, text);
}

/**
 * `app.js`는 모듈이 아니라(브라우저 전역 스크립트) import할 수 없다 — 선언을 소스에서 정규식으로 읽는다(줄 수는 상관없고 `};` 종결·작은따옴표·`{icon:'…',name:'…'}` 항목 모양에 기댄다).
 * 모양이 바뀌어 못 읽으면 **조용히 빈 값으로 넘어가지 않고** 여기서 깨진다.
 */
const APP = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
function appLiteral(name: string): string {
  const match = new RegExp(`const ${name}=\\{([\\s\\S]*?)\\};`).exec(APP);
  if (!match) throw new Error(`app.js에서 ${name} 선언을 찾지 못했습니다`);
  return match[1];
}

/** 장소 문서의 우선순위 칸. 기본값('보통')은 저장하지 않으므로 키가 아예 없을 수 있다. */
const spots: { name: string; spot: Record<string, unknown> }[] = [
  { name: '아무 표시 없음', spot: { name: '알함브라' } },
  { name: '꼭 가기', spot: { name: '알함브라', must: true } },
  { name: '여유 되면', spot: { name: '알함브라', opt: true } },
  { name: '둘 다 켜진 옛 문서는 지키는 쪽', spot: { name: '알함브라', must: true, opt: true } },
  { name: 'must가 꺼져 있고 opt만', spot: { name: '알함브라', must: false, opt: true } },
  { name: '둘 다 꺼짐', spot: { name: '알함브라', must: false, opt: false } }
];

describe('표시 규칙 복사본 — iOS 픽스처', () => {
  it('장소 우선순위 3단 — 목록·읽기·쓰기', () => {
    const priorities = legacyLib.SPOT_PRIORITIES.map(({ id, label }) => ({ id, label }));
    const reads = spots.map((s) => ({ name: s.name, spot: s.spot, priority: legacyLib.spotPriorityOf(s.spot) }));
    const writes = spots.flatMap((s) => priorities.map(({ id: level }) => ({
      name: `${s.name} → ${level}`,
      before: s.spot,
      level,
      after: legacyLib.applySpotPriority({ ...s.spot }, level)
    })));

    expect(priorities.map((p) => p.id)).toEqual(['MUST', 'NORMAL', 'OPT']);
    expect(reads.find((r) => r.name === '둘 다 켜진 옛 문서는 지키는 쪽')?.priority).toBe('MUST');
    // 기본값은 저장하지 않고, 둘이 함께 켜지지 않는다
    for (const w of writes) {
      expect(w.after.must === true && w.after.opt === true, w.name).toBe(false);
      if (w.level === 'NORMAL') expect('must' in w.after || 'opt' in w.after, w.name).toBe(false);
      expect(w.after.name, '다른 칸은 건드리지 않는다').toBe('알함브라');
    }

    writeFixture('spot-priority', { priorities, reads, writes });
  });

  it('결제 상태·비용 분류의 이름 — 글자까지', () => {
    const payStateLabels = Object.fromEntries(
      [...appLiteral('PAY_STATE_LABEL').matchAll(/(\w+):'([^']*)'/g)].map((m) => [m[1], m[2]]));
    const categoryNames = Object.fromEntries(
      [...appLiteral('COST_KIND').matchAll(/(\w+):\{icon:'[^']*',name:'([^']*)'\}/g)].map((m) => [m[1], m[2]]));
    // 미구분(NONE)은 계산에서만 쓰는 이름이라 lib.js 목록에는 없다 — 고르는 칸의 세 번째 자리다.
    const payStates = [...legacyLib.COST_PAY_STATES, 'NONE'];
    const categories = [...legacyLib.COST_CATEGORIES];

    expect(Object.keys(payStateLabels).sort()).toEqual([...payStates].sort());
    expect(Object.keys(categoryNames)).toEqual(categories);
    // 세 상태 모두 이름이 있다 — 빈 이름으로 숨기기를 대신하지 않는다(2026-09-20)
    for (const label of Object.values(payStateLabels)) expect(label).not.toBe('');
    for (const name of Object.values(categoryNames)) expect(name).not.toBe('');

    writeFixture('cost-labels', { payStates, payStateLabels, categories, categoryNames });
  });
});
