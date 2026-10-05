// 비용이 보이는 곳 정리(2026-10-05 UX 점검) — 샘플에서 비용·예약·예산이 보이고, 모바일 '비용'이 막다른 곳이 아니며,
// 장소 비용이 상세 설정에 숨지 않는다. 샘플의 시작일(10/25)이 지나도 결과가 바뀌지 않게 여행지 시계를 고정한다.
const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');

const BEFORE_TRIP="travelClock=()=>({todayISO:'2026-08-01',nowMin:600}); render();";

test.describe('모바일',()=>{
  test.beforeEach(async({context,page})=>{
    await prepare(context);
    await page.setViewportSize({width:375,height:812});
    await page.goto('/');
    await expect(page.locator('#mobilePlanActions')).toBeVisible();
    await page.evaluate(BEFORE_TRIP);
  });

  test('샘플의 하단 비용 단추는 남은 예산을 말하고, 전체 비용 화면에서 예산을 고칠 수 있다',async({page})=>{
    const btn=page.locator('#mobileCosts');
    await expect(btn).toContainText('비용 · 남은 ₩');
    await btn.click();
    const body=page.locator('#mobileCostBody');
    await expect(body).toContainText('여행 전체 예상 비용');
    await expect(body).toContainText('비용 내역');
    await expect(body).toContainText('남은 예산');
    // 여행 전이고 전체 일정을 보고 있으면 어느 날인지 모른다 — 쓴 돈 버튼 대신 이유를 말한다
    await expect(page.locator('#mobileAddSpend')).toHaveCount(0);
    await expect(body).toContainText('여행이 시작되면');
    await page.locator('#mobileBudget').click();
    await expect(page.locator('#tripBudget')).toBeFocused();
    await expect(page.locator('#tripBudget')).toHaveValue('5000000');
  });

  test('날을 고르면 비용 시트에서 바로 쓴 돈을 적는다',async({page})=>{
    await page.locator('#mobileCurrentDay').click();
    await page.locator('#mobileDayList button[data-ad="2"]').click();
    await page.locator('#mobileCosts').click();
    await expect(page.locator('#mobileAddSpend')).toContainText('Day 2');
    await page.locator('#mobileAddSpend').click();
    await expect(page.locator('#placeCostDialog')).toBeVisible();
    await expect(page.locator('#placeCostTitle')).toHaveText('쓴 돈');
    await page.locator('#costTitle').fill('택시');
    await page.locator('#costAmount').fill('9');
    await page.locator('#costCurrency').selectOption('EUR');
    await page.locator('#costPlaceSave').click();
    await expect(page.locator('#placeCostDialog')).toBeHidden();
    const titles=await page.evaluate(()=>trip().days[1].costItems.map(i=>i.title));
    expect(titles).toContain('택시');
  });

  test('하단 ＋ 장소 추가는 보는 날에 넣는다',async({page})=>{
    await page.locator('#mobileCurrentDay').click();
    await page.locator('#mobileDayList button[data-ad="3"]').click();
    await page.locator('#mobileAddSpot').click();
    await expect(page.locator('#spotDay')).toHaveValue('2');   // Day 3 = 인덱스 2
  });
});

test.describe('장소 편집기',()=>{
  for(const [name,size] of [['모바일',{width:375,height:812}],['데스크톱',{width:1280,height:800}]]){
    test(`${name}: 비용 줄이 상세 설정을 펴지 않고도 보이고 금액을 말한다`,async({context,page})=>{
      await prepare(context);
      await page.setViewportSize(size);
      await page.goto('/');
      await page.evaluate(()=>{ const d=trip().days[1]; openSpotModal(1,d.spots.findIndex(s=>s.name==='프라도 미술관')); });
      await expect(page.locator('#spotAdvanced')).not.toHaveAttribute('open','');
      const cost=page.locator('#spotCostBtn');
      await cost.scrollIntoViewIfNeeded();
      await expect(cost).toBeVisible();
      await expect(cost).toContainText('€15');
    });
  }
});

test.describe('일자 카드',()=>{
  test('샘플 둘째 날의 쓴 돈 예시가 보이고, 여행 전이라 적기 버튼은 없지만 ⋮ 메뉴로 적을 수 있다',async({context,page})=>{
    await prepare(context);
    await page.setViewportSize({width:1280,height:800});
    await page.goto('/');
    await page.evaluate(BEFORE_TRIP);
    const card=page.locator('.dayCard').nth(1);
    await expect(card.locator('.dayItem:not(.add)')).toContainText('타파스 점심');
    await expect(card.locator('.dayItem.add')).toHaveCount(0);
    await card.locator('summary[aria-label="Day 2 작업 메뉴"]').click();
    await card.getByRole('button',{name:/쓴 돈 적기/}).click();
    await expect(page.locator('#placeCostDialog')).toBeVisible();
    await expect(page.locator('#placeCostFor')).toContainText('Day 2');
  });
});
