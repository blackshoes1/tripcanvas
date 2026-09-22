// 픽스처는 **읽히라고** 있는 것이다.
//
// 파리티 테스트들은 `ios/TripCanvasTests/Fixtures/`에 실제 응답을 매번 다시 쓴다. 그 쓸모는
// "앱이 이 응답을 디코딩하는가"를 Swift 쪽에서 확인하는 데 있다. 아무도 열어 보지 않는 픽스처는
// 계약이 갈라져도 초록인 채로 커밋에 JSON만 쌓는다 — 2026-09-21에 세어 보니 열한 개 중 셋이
// 그랬다(`import-preview` · `trip-costs` · `day-cost-extreme`). 그 셋 중 하나는 합계가
// **Int64 범위를 넘는지** 보려고 만든 파일이었는데, 정작 그걸 확인하는 쪽이 없었다.
//
// 그래서 여기서 점호한다. `ios/**`가 안 바뀌면 iOS 워크플로는 돌지 않으므로(macOS 러너는 10배
// 과금) 이 검사는 **Next 워크스페이스에 둔다** — 계약을 바꾸는 PR은 거의 이쪽을 지난다.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const IOS_TESTS = path.join(__dirname, '../../../../../ios/TripCanvasTests');

describe('픽스처 점호', () => {
  it('모든 픽스처를 Swift 테스트가 실제로 읽는다', () => {
    const fixtures = readdirSync(path.join(IOS_TESTS, 'Fixtures'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    expect(fixtures.length, '픽스처가 하나도 없으면 점호가 의미를 잃는다').toBeGreaterThan(5);

    const sources = readdirSync(IOS_TESTS)
      .filter((f) => f.endsWith('.swift'))
      .map((f) => readFileSync(path.join(IOS_TESTS, f), 'utf8'))
      .join('\n');

    const unread = fixtures.filter((name) => !sources.includes(`"${name}"`));
    expect(unread, '쓰기만 하고 아무도 읽지 않는 픽스처 — Swift 테스트에서 디코딩한다').toEqual([]);
  });
});
