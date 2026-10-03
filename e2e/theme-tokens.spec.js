// 토큰으로 옮겨도 **보이는 색이 바뀌지 않았는지** 실제 브라우저가 계산한 값으로 확인한다.
//
// jsdom은 CSS 변수를 끝까지 풀지 않으므로 통합 테스트로는 볼 수 없다. 여기서만 잡힌다.
//
// ⚠️ **값이 같다고 리터럴을 토큰으로 바꾸면 안 된다** — 토큰은 테마에 따라 값이 바뀐다.
// `.btn.primary{color:#fff}`를 `var(--surface)`로 바꾸면 라이트에서는 같지만 다크에서
// `#221e19`가 되어 의도하지 않은 색이 된다. 다크의 짙은 글자는 **다크 전용 규칙으로** 준다(아래 `primary` 검사).
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
  // '의견이 조금 갈려요'는 경고보다 약한 정보색이다(2026-09-27) — 같이 짜기 상태에 빨강(위험)을 쓰지 않는다
  expect(await swatch(page, 'candMood mixed')).toEqual(['rgb(225, 236, 239)', 'rgb(46, 92, 110)']);
  // `.quiet`은 규칙이 **없는 것이 의도다** — 기본(조용한 회색)이 곧 그 뜻이다
  expect(await swatch(page, 'candMood quiet')).toEqual(await swatch(page, 'candMood'));

  await page.evaluate(() => document.body.classList.add('theme-dark'));
  expect(await swatch(page, 'candMood split')).toEqual(['rgb(58, 47, 20)', 'rgb(240, 201, 127)']);
  expect(await swatch(page, 'candMood good')).toEqual(['rgb(27, 46, 32)', 'rgb(143, 199, 155)']);
  expect(await swatch(page, 'candMood mixed')).toEqual(['rgb(28, 42, 48)', 'rgb(156, 196, 210)']);
});

/** 두 `rgb(...)`의 WCAG 대비. */
const contrast = (a, b) => {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+/g).slice(0, 3).map((v) => {
      const x = +v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// 라이트는 짙은 올리브 위 흰 글자, 다크는 밝은 연두 위 짙은 글자다 — 다크에서 흰 글자는 1.9:1로
// 읽히지 않았다(2026-09-27 UX 검토). 지키는 것은 '흰색'이라는 값이 아니라 **읽히는가**다.
test('강조 버튼 글자는 양쪽 테마에서 읽힌다(4.5:1 이상)', async ({ page }) => {
  await page.goto('/');
  for (const dark of [false, true]) {
    await page.evaluate((d) => document.body.classList.toggle('theme-dark', d), dark);
    const [bg, fg] = await swatch(page, 'btn primary');
    expect(contrast(bg, fg), dark ? '다크' : '라이트').toBeGreaterThanOrEqual(4.5);
    expect(bg, '배경은 테마를 따른다').not.toBe('rgb(255, 255, 255)');
  }
  // 라이트의 흰 글자를 토큰(`--surface`)으로 바꾸는 실수는 여전히 막는다
  await page.evaluate(() => document.body.classList.remove('theme-dark'));
  expect((await swatch(page, 'btn primary'))[1]).toBe('rgb(255, 255, 255)');
});

test('정보색 배지(의견이 조금 갈려요)는 양쪽 테마에서 읽힌다(4.5:1 이상)', async ({ page }) => {
  await page.goto('/');
  for (const dark of [false, true]) {
    await page.evaluate((d) => document.body.classList.toggle('theme-dark', d), dark);
    const [bg, fg] = await swatch(page, 'candMood mixed');
    expect(contrast(bg, fg), dark ? '다크' : '라이트').toBeGreaterThanOrEqual(4.5);
  }
});

test('주소창 색(theme-color)은 예전 남색이 아니라 지금 테마의 바탕을 따른다', async ({ page }) => {
  await page.goto('/');
  const color = () => page.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute('content'));
  expect(await color()).toBe('#f4f1ea');
  // 테마는 ☰ '화면'에서 고른다(2026-10-03 — 보기 설정의 토글 `toggleTheme`은 없어졌다)
  await page.evaluate(() => setTheme('dark'));
  expect(await color()).toBe('#16130f');
  await page.evaluate(() => setTheme('system'));
  expect(await color()).toBe('#f4f1ea');
});

// 기기가 다크면 처음부터 다크다(2026-10-03 UX 검토 — 라이트로 시작했다). 다크에서 칸이 보여야 한다:
// 입력칸 테두리는 바탕과 3:1 이상(WCAG 1.4.11), 예시 글자는 칸 바탕과 4.5:1 이상.
test('기기가 다크면 다크로 시작하고, 다크의 입력칸 테두리·예시 글자가 읽힌다', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  expect(await page.evaluate(() => document.body.classList.contains('theme-dark'))).toBe(true);
  expect(await page.evaluate(() => document.querySelector('#themeChoice [aria-pressed="true"]').dataset.theme)).toBe('system');
  const [field, page_bg, ph] = await page.evaluate(() => {
    const el = document.getElementById('spotName');
    const s = getComputedStyle(el), modal = getComputedStyle(document.querySelector('#spotModalBg .modal'));
    return [[s.borderTopColor, s.backgroundColor], modal.backgroundColor, getComputedStyle(el, '::placeholder').color];
  });
  expect(contrast(field[0], page_bg), '테두리 대 창 바탕').toBeGreaterThanOrEqual(3);
  expect(contrast(ph, field[1]), '예시 글자 대 칸 바탕').toBeGreaterThanOrEqual(4.5);
  // 고르면 기기 설정보다 앞선다
  await page.evaluate(() => setTheme('light'));
  expect(await page.evaluate(() => document.body.classList.contains('theme-dark'))).toBe(false);
  await context.close();
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
  // 손가락이 닿아야 하므로 26px 밑으로 내리지 않는다 · 글자는 12px 밑으로 내리지 않는다(2026-10-03 — 보조 글자 12px 이상)
  expect(sm).toEqual(['12px', '26px']);
  await expect(page.locator('#pickOnMap')).toHaveClass(/\bsm\b/);
});
