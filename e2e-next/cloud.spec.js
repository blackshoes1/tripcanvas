const { test, expect } = require('@playwright/test');
const { normalizeTrip } = require('../lib');

async function prepare(page, { historyError = false, role = 'OWNER' } = {}) {
  let document = normalizeTrip({ id: 'nexttest', name: 'API 여행', start: '2026-09-08', days: [{ spots: [] }], future: { keep: true } });
  let revision = 1;
  const writes = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== 'localhost') return route.abort();
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (url.pathname === '/api/v1/auth-config') return json({ provider: 'TRIPCANVAS' });
    if (url.pathname === '/api/auth/sign-in/email') return json({ user: { id: 'owner', email: 'owner@example.invalid' } }, 200, { 'set-auth-token': 'synthetic-session' });
    if (url.pathname === '/api/auth/get-session') return json({ user: { id: 'owner', email: 'owner@example.invalid' } });
    if (url.pathname.startsWith('/api/v1/')) {
      expect(request.headers().authorization).toBe('Bearer synthetic-session');
      if (url.pathname === '/api/v1/me') return json({ trips: [{ id: document.id, role }] });
      if (url.pathname.endsWith('/prices')) return json({ observations: [] });
      if (url.pathname === '/api/v1/sync/trips') return json({ trips: [{ id: document.id, document, revision, deletedAt: null, updatedAt: '2026-09-08T00:00:00Z' }] });
      if (url.pathname.endsWith('/snapshots')) {
        if (historyError) return json({ code: 'NOT_FOUND' }, 404);
        return json({ snapshots: [], snapshot: {} });
      }
      if (url.pathname === '/api/v1/trips/nexttest' && request.method() === 'PUT') {
        const body = request.postDataJSON();
        expect(body.expectedRevision).toBe(revision);
        document = body.trip;
        revision++;
        writes.push(body);
        return json({ trip: { revision }, document });
      }
      throw new Error(`unexpected API: ${request.method()} ${url.pathname}`);
    }
    return route.continue();
  });
  return { writes, errors, document: () => document };
}

async function login(page) {
  await page.goto('/itinerary');
  await page.getByRole('button', { name: '이미 계정이 있으신가요? 로그인' }).click();
  const dialog = page.getByRole('dialog', { name: '로그인', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('이메일').fill('owner@example.invalid');
  await dialog.getByLabel('비밀번호').fill('synthetic-password');
  await dialog.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.itTripName')).toHaveText('API 여행');
}

test('first visitor logs in, reads an API trip, edits and restores the session after reload', async ({ page }) => {
  const state = await prepare(page);
  await login(page);
  await page.getByRole('button', { name: '✎ 여행 정보' }).click();
  const dialog = page.getByRole('dialog', { name: '여행 정보' });
  await dialog.getByLabel('여행 이름').fill('수정한 API 여행');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.document().future).toEqual({ keep: true });
  await page.reload();
  await expect(page.locator('.itTripName')).toHaveText('수정한 API 여행');
  await expect(page.getByRole('button', { name: '👤 owner' })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('missing snapshot API is shown as a failure instead of empty history', async ({ page }) => {
  await prepare(page, { historyError: true });
  await login(page);
  await page.getByRole('button', { name: '✎ 여행 정보' }).click();
  await page.getByText('🕘 버전 기록', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '여행 정보' }).getByRole('alert')).toContainText('버전 이력을 불러오지 못했어요');
  await expect(page.getByText('저장된 버전이 없습니다', { exact: false })).toHaveCount(0);
});

test('VIEWER has no itinerary editing controls after API role resolution', async ({ page }) => {
  await prepare(page, { role: 'VIEWER' });
  await login(page);
  await expect(page.getByRole('button', { name: '✎ 여행 정보' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '＋ 일자 추가' })).toHaveCount(0);
  await page.goto('/bookings');
  await expect(page.getByRole('button', { name: '👤 owner' })).toBeVisible();
  await expect(page.getByRole('button', { name: '＋ 예약 추가' })).toHaveCount(0);
});

test('booking edits are saved through the API without returning to itinerary', async ({ page }) => {
  const state = await prepare(page);
  await login(page);
  await page.goto('/bookings');
  await page.getByRole('button', { name: '＋ 예약 추가' }).click();
  await page.getByLabel('예약 이름', { exact: true }).fill('테스트 숙소');
  await page.getByLabel('총액', { exact: true }).fill('100000');
  await page.getByLabel('체크인', { exact: true }).fill('2026-10-01');
  await page.getByLabel('체크아웃', { exact: true }).fill('2026-10-02');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.document().bookings[0].title).toBe('테스트 숙소');
  expect(state.errors).toEqual([]);
});
