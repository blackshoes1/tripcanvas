const {test,expect}=require('@playwright/test');
const {prepare,createTrip}=require('./helpers');

test('첫 방문 온보딩은 세 가지 진입점을 제공하고 샘플을 명시한다',async({browser})=>{
  const context=await browser.newContext(); await prepare(context,{onboarded:false});
  const page=await context.newPage(); await page.goto('/');
  await expect(page.locator('#onboarding')).toBeVisible();
  await expect(page.locator('#onboardPaste')).toBeFocused();
  await expect(page.locator('#onboardPaste')).toContainText('일정 붙여넣기');
  await expect(page.locator('#onboardNew')).toContainText('새 여행');
  await expect(page.locator('#onboardSample')).toContainText('샘플');
  await page.locator('#onboardSample').click();
  await expect(page.locator('#onboarding')).toBeHidden();
  await expect(page.locator('#tripPickerName')).toContainText('샘플');
  await context.close();
});

test('장소 모달은 기본 정보와 접힌 상세 설정을 분리한다',async({context,page})=>{
  await prepare(context); await page.goto('/');
  await page.locator('.addSpot').first().click();
  await expect(page.locator('#spotAdvanced')).not.toHaveAttribute('open','');
  await expect(page.locator('#spotName')).toBeVisible();
  await page.locator('#spotAdvanced summary').click();
  await expect(page.locator('#spotLegMode')).toBeVisible();
  await expect(page.locator('#spotModalBg .stepBadge')).toHaveText('상세 설정');
});

test('모바일 일정 패널은 접힘·반판·전체 3단계로 전환된다',async({context,page})=>{
  await prepare(context); await page.setViewportSize({width:390,height:844}); await page.goto('/');
  const sidebar=page.locator('#sidebar');
  await expect(sidebar).toHaveAttribute('data-snap','half');
  await page.locator('#sheetHandle').click(); await expect(sidebar).toHaveAttribute('data-snap','expanded');
  await page.locator('#sheetHandle').click(); await expect(sidebar).toHaveAttribute('data-snap','collapsed');
  await page.locator('#sheetHandle').click(); await expect(sidebar).toHaveAttribute('data-snap','half');
});

test('여행 모드는 현재 장소와 다음 장소를 우선 표시한다',async({context,page})=>{
  await prepare(context); await page.goto('/'); await createTrip(page,'여행 모드 테스트');
  await page.evaluate(()=>{ const d=store.trips.find(t=>t.id===store.activeId).days[0]; d.spots=[{name:'현재 장소',city:'서울',lat:37.5,lng:127,stayMin:60},{name:'다음 장소',city:'서울',lat:37.51,lng:127.01,stayMin:60}]; render(); });
  await page.locator('#travelBtn').click();
  await expect(page.locator('#travelCurrent')).toContainText('현재 장소');
  await expect(page.locator('#travelNext')).toContainText('다음 장소');
  await expect(page.locator('.travelSectionTitle')).toHaveText('오늘 일정');
});
