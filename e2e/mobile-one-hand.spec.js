const {test,expect}=require('@playwright/test');
const {prepare,clickMore}=require('./helpers');

test.beforeEach(async({context,page})=>{
  await prepare(context);
  await page.setViewportSize({width:375,height:812});
  await page.goto('/');
});

test('하단에서 날짜를 고르고 첫날·마지막 날까지 이동한다',async({page})=>{
  await expect(page.locator('#mobilePrevDay')).toBeDisabled();
  await page.locator('#mobileCurrentDay').click();
  await page.locator('#mobileDayList button[data-ad="3"]').click();
  await expect(page.locator('#mobileCurrentDay')).toContainText('Day 3');
  await expect(page.locator('#filterbar .chip.active')).toContainText('Day 3');
  await page.locator('#mobilePrevDay').click();
  await page.locator('#mobilePrevDay').click();
  await expect(page.locator('#mobilePrevDay')).toBeDisabled();
  await page.locator('#mobileCurrentDay').click();
  await page.locator('#mobileDayList button').last().click();
  await expect(page.locator('#mobileNextDay')).toBeDisabled();
  await page.locator('#mobileCurrentDay').click();
  await page.locator('#mobileDayList button[data-ad="0"]').click();
  await expect(page.locator('#mobileCurrentDay')).toContainText('전체 일정');
});

test('빈 여행에서도 비용 입구가 있고 기존 내역과 같은 금액을 보여 준다',async({page})=>{
  await page.evaluate(()=>{ trip().days=[{title:'',spots:[]}]; delete trip().budget; delete trip().bookings; delete trip().costItems; activeDay=0; render(); });
  await page.locator('#mobileCosts').click();
  await expect(page.locator('#mobileCostBody')).toContainText('아직 입력한 비용이 없어요');
  await expect(page.locator('#mobilePlanActions')).toBeHidden();
  await page.locator('#mobileCostClose').click();
  await expect(page.locator('#mobileCosts')).toBeFocused();
  await page.evaluate(()=>{ trip().days[0].spots=[{name:'식사',city:'서울',cost:10000}]; trip().budget={amount:50000}; render(); });
  await page.locator('#mobileCosts').click();
  await expect(page.locator('#mobileCostBody')).toContainText('₩10,000');
  await expect(page.locator('#mobileCostBody')).toContainText('₩40,000');
  await page.locator('#mobileBookings').click();
  await expect(page.locator('#bookingListBg')).toBeVisible();
});

test('기존 장소와 여행 설정은 키보드 입력부터 시작하지 않는다',async({page})=>{
  await clickMore(page,'#tripEditBtn');
  await expect(page.locator('#tripModalTitle')).toBeFocused();
  await page.locator('#tripCancel').click();
  await page.evaluate(()=>openSpotModal(0,0));
  await expect(page.locator('#spotModalTitle')).toBeFocused();
  await expect(page.locator('#spotSearch')).toBeHidden();
  await page.locator('#spotSearchPanel > summary').click();
  await expect(page.locator('#spotSearch')).toBeVisible();
  await page.locator('#spotCancel').click();
  await page.locator('#mobileAddSpot').click();
  await expect(page.locator('#spotSearch')).toBeFocused();
  await expect(page.locator('#mobilePlanActions')).toBeHidden();
});

test('장소 비용 확인은 편집 위치와 초안을 유지하고 장소 저장 때 반영된다',async({page})=>{
  await page.evaluate(()=>{document.getElementById('sidebar').scrollTop=500; openSpotModal(0,1);});
  const scrollBefore=await page.locator('#sidebar').evaluate(el=>el.scrollTop);
  await page.locator('#spotAdvanced > summary').click();
  await page.locator('#spotCostBtn').click();
  await expect(page.locator('#costDraftNote')).toBeVisible();
  await page.locator('#costAmount').fill('15');
  await page.locator('#costCurrency').selectOption('EUR');
  await page.locator('#costPlaceSave').click();
  await expect(page.locator('#spotCostBtn')).toContainText('€15');
  expect(await page.evaluate(()=>trip().days[0].spots[1].cost)).toBeUndefined();
  await page.locator('#spotSave').click();
  await expect(page.locator('#spotModalBg')).toBeHidden();
  expect(await page.evaluate(()=>trip().days[0].spots[1].cost)).toBe(15);
  expect(await page.locator('#sidebar').evaluate(el=>el.scrollTop)).toBeCloseTo(scrollBefore,0);
});

for(const width of [320,375,430]){
  test(`${width}px에서 짧아진 입력 화면의 저장과 체류 시간이 잘리지 않는다`,async({page})=>{
    await page.setViewportSize({width,height:812});
    await page.evaluate(()=>openSpotModal(0,1));
    if(!await page.locator('#spotSchedule').evaluate(el=>el.open)) await page.locator('#spotSchedule > summary').click();
    await page.locator('#spotStayMin').fill('123');
    const fits=await page.locator('#spotStayMin').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});
    expect(fits).toBe(true);
    await page.locator('#spotAdvanced > summary').click();
    await page.locator('#spotCostBtn').click();
    await page.locator('#costAmount').fill('12.345');
    await page.locator('#costCurrency').selectOption('EUR');
    await page.setViewportSize({width,height:420});
    await page.locator('#costPlaceSave').click();
    await expect(page.locator('#placeCostDialog')).toBeVisible();
    await expect(page.locator('#costAmount')).toHaveAttribute('aria-invalid','true');
    await page.locator('#costAmount').fill('15');
    const button=await page.locator('#costPlaceSave').boundingBox();
    const dialog=await page.locator('#placeCostDialog').boundingBox();
    expect(button.y+button.height).toBeLessThanOrEqual(420);
    expect(button.height).toBeGreaterThanOrEqual(48);
    expect(button.width).toBeGreaterThanOrEqual((dialog.width-42)/2);
    await page.locator('#costPlaceSave').click();
    await expect(page.locator('#spotCostBtn')).toContainText('€15');
  });
}

test('데스크톱은 기존 탐색을 유지한다',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await expect(page.locator('#mobilePlanActions')).toBeHidden();
  await page.locator('.addSpot').first().click();
  await expect(page.locator('#spotSearch')).toBeVisible();
});

test('장소 비용 초안은 취소와 Escape에서 버리기 전에 확인한다',async({page})=>{
  await page.evaluate(()=>openSpotModal(0,1));
  await page.locator('#spotAdvanced > summary').click();
  await page.locator('#spotCostBtn').click();
  await page.locator('#costAmount').fill('15');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.locator('#placeCostDialog')).toBeVisible();
  await expect(page.locator('#costAmount')).toHaveValue('15');
  await page.locator('#costPlaceSave').click();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#spotCancel').click();
  await expect(page.locator('#spotModalBg')).toBeVisible();
  await expect(page.locator('#spotCostBtn')).toContainText('₩15');
});

test('하루 비용의 저장 실패는 입력을 유지하고 재시도 때 중복을 만들지 않는다',async({page})=>{
  await page.evaluate(()=>{
    window.originalStorageSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='tripcanvas_v1') throw new DOMException('full','QuotaExceededError'); return window.originalStorageSet.call(this,key,value);};
    openDayCostItem(0,null);
  });
  await page.locator('#costAmount').fill('1500');
  await page.locator('#costPlaceSave').click();
  await expect(page.locator('#placeCostDialog')).toBeVisible();
  await expect(page.locator('#costAmount')).toHaveValue('1500');
  await expect(page.locator('#costAmount')).toHaveAttribute('aria-invalid','true');
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;});
  await page.locator('#costPlaceSave').click();
  await expect(page.locator('#placeCostDialog')).toBeHidden();
  expect(await page.evaluate(()=>trip().days[0].costItems.length)).toBe(1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tripcanvas_v1')).trips[0].days[0].costItems[0].amount)).toBe(1500);
});

test('보기 권한에서는 하단 장소 추가를 제공하지 않는다',async({page})=>{
  await page.evaluate(()=>{viewMode=JSON.parse(JSON.stringify(trip()));render();});
  await expect(page.locator('#mobileAddSpot')).toBeHidden();
  await expect(page.locator('#mobileCosts')).toBeVisible();
});

test('큰 글자와 긴 날짜 제목에서도 시트·하단 동작이 겹치지 않는다',async({page})=>{
  await page.setViewportSize({width:320,height:812});
  await page.evaluate(()=>{
    document.documentElement.style.fontSize='32px';
    trip().days[0].title='아주 긴 도시 이름과 여행 일정 제목'; activeDay=1; render(); setSheetSnap('expanded');
  });
  const footer=await page.locator('#mobilePlanActions').boundingBox();
  await expect.poll(async()=>{const sidebar=await page.locator('#sidebar').boundingBox(); return sidebar.y+sidebar.height;}).toBeLessThanOrEqual(footer.y+1);
  for(const id of ['mobilePrevDay','mobileCurrentDay','mobileNextDay','mobileAddSpot','mobileCosts']){
    const box=await page.locator(`#${id}`).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(320);
  }
  await page.locator('#mobileCosts').click();
  await expect(page.locator('#mobileCostClose')).toBeVisible();
});
