// 토큰으로 옮겨도 **보이는 색이 바뀌지 않았는지** 실제 브라우저가 계산한 값으로 확인한다.
//
// jsdom은 CSS 변수를 끝까지 풀지 않으므로 통합 테스트로는 볼 수 없다. 여기서만 잡힌다.
//
// ⚠️ **값이 같다고 리터럴을 토큰으로 바꾸면 안 된다** — 토큰은 테마에 따라 값이 바뀐다.
// `.btn.primary{color:#fff}`를 `var(--surface)`로 바꾸면 라이트에서는 같지만 다크에서
// `#221e19`가 되어 **초록 배경에 검은 글자**가 된다. 아래 `primary` 검사가 그걸 지킨다.
const { test, expect } = require('@playwright/test');

/** 그 클래스로 계산된 [배경, 글자]. 요소를 붙였다 떼므로 화면을 건드리지 않는다. */
const swatch = (page, cls) => page.evaluate((c) => {
  const el = document.createElement('span');
  el.className = c;
  document.body.appendChild(el);
  const s = getComputedStyle(el);
  const v = [s.backgroundColor, s.color];
  el.remove();
  return v;
}, cls);

test('상태 배지 색은 라이트·다크 양쪽에서 토큰화 전과 같다', async ({ page }) => {
  await page.goto('/');

  expect(await swatch(page, 'candMood split')).toEqual(['rgb(246, 234, 211)', 'rgb(142, 78, 11)']);
  expect(await swatch(page, 'candMood good')).toEqual(['rgb(220, 235, 223)', 'rgb(47, 94, 59)']);
  expect(await swatch(page, 'candMood mixed')).toEqual(['rgb(246, 224, 220)', 'rgb(165, 44, 34)']);
  // `.quiet`은 규칙이 **없는 것이 의도다** — 기본(조용한 회색)이 곧 그 뜻이다
  expect(await swatch(page, 'candMood quiet')).toEqual(await swatch(page, 'candMood'));

  await page.evaluate(() => document.body.classList.add('theme-dark'));
  expect(await swatch(page, 'candMood split')).toEqual(['rgb(58, 47, 20)', 'rgb(240, 201, 127)']);
  expect(await swatch(page, 'candMood good')).toEqual(['rgb(27, 46, 32)', 'rgb(143, 199, 155)']);
  expect(await swatch(page, 'candMood mixed')).toEqual(['rgb(58, 35, 32)', 'rgb(239, 157, 143)']);
});

test('강조 버튼 글자는 테마와 무관하게 흰색이다', async ({ page }) => {
  await page.goto('/');
  for (const dark of [false, true]) {
    await page.evaluate((d) => document.body.classList.toggle('theme-dark', d), dark);
    const [bg, fg] = await swatch(page, 'btn primary');
    expect(fg, dark ? '다크' : '라이트').toBe('rgb(255, 255, 255)');
    expect(bg, '배경은 테마를 따른다').not.toBe('rgb(255, 255, 255)');
  }
});

test('작은 버튼은 한 이름에서 나온다 — 인라인으로 각자 만들지 않는다', async ({ page }) => {
  await page.goto('/');
  const sm = await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'btn sm';
    document.body.appendChild(b);
    const s = getComputedStyle(b);
    const v = [s.fontSize, s.minHeight];
    b.remove();
    return v;
  });
  // 손가락이 닿아야 하므로 26px 밑으로 내리지 않는다
  expect(sm).toEqual(['11px', '26px']);
  await expect(page.locator('#pickOnMap')).toHaveClass(/\bsm\b/);
});
