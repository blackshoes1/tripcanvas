const {test,expect}=require('@playwright/test');
const {prepare,createTrip,clickMore}=require('./helpers');

test('온보딩은 배경 조작을 막고 포커스를 순환한 뒤 복귀한다',async({context,page})=>{
  await prepare(context,{onboarded:false}); await page.goto('/');
  await expect(page.locator('#onboardNew')).toBeFocused();
  await expect(page.locator('header')).toHaveJSProperty('inert',true);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#onboardLogin')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#onboardNew')).toBeFocused();
  await page.locator('#onboardSample').click();
  await expect(page.locator('header')).toHaveJSProperty('inert',false);
  await expect(page.locator('#tripPickerBtn')).toBeFocused();
  await clickMore(page,'#onboardAgainBtn');
  await page.keyboard.press('Escape');
  await expect(page.locator('#moreBtn')).toBeFocused();
});

test('빈 여행은 이전 지도를 덮고 검색으로 확인한 첫 장소를 저장하면 지도를 연다',async({context,page})=>{
  await prepare(context); await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await createTrip(page,'도쿄 여행');
  await expect(page.locator('#mapEmpty')).toBeVisible();
  await expect(page.locator('#map')).toHaveJSProperty('inert',true);
  await page.locator('#mapEmptySearch').click();
  await expect(page.locator('#spotModalBg')).toBeVisible();
  await page.evaluate(()=>{ routedSearch=async()=>[{name:'도쿄역',city:'도쿄',lat:35.681,lng:139.767,placeId:'tokyo'}]; });
  await page.locator('#spotSearch').fill('도쿄역');
  await page.locator('#spotSearchBtn').click();
  await page.locator('#searchRes').getByText('도쿄역').click();
  await page.getByRole('button',{name:'이 장소 선택',exact:true}).click();
  await page.locator('#spotSave').click();
  await expect(page.locator('#mapEmpty')).toBeHidden();
  await expect(page.locator('#map')).toHaveJSProperty('inert',false);
  await expect(page.locator('#sidebar')).toContainText('도쿄역');
  expect(await page.evaluate(()=>trip().days[0].spots[0].lat)).toBe(35.681);
});

test('약속 시각은 상세 설정을 열지 않고 저장할 수 있다',async({context,page})=>{
  await prepare(context); await page.goto('/'); await createTrip(page,'약속');
  await page.locator('.addSpot').first().click();
  await expect(page.locator('#spotBookAt')).toBeVisible();
  await expect(page.locator('#spotAdvanced')).not.toHaveAttribute('open','');
  await page.evaluate(()=>{ document.getElementById('spotLat').value='37.5'; document.getElementById('spotLng').value='127'; });
  await page.locator('#spotName').fill('저녁 예약');
  await page.locator('#spotCity').fill('서울');
  await page.locator('#spotBookAt').fill('19:00');
  await page.locator('#spotSave').click();
  expect(await page.evaluate(()=>trip().days[0].spots[0].bookAt)).toBe('19:00');
  expect(await page.evaluate(()=>trip().days[0].spots[0].at||'')).toBe('');
});

test('저장 실패와 권한 거절은 지속적으로 표시하고 거절은 재시도하지 않는다',async({context,page})=>{
  await prepare(context); await page.goto('/'); await createTrip(page,'저장 상태');
  await expect(page.locator('#saveState')).toHaveText('이 기기에 저장됨');
  await page.evaluate(()=>{
    user={id:'test'}; sb={}; syncMeta[trip().id]={status:'error',hash:''}; updateSaveState();
  });
  await expect(page.locator('#saveState')).toContainText('서버 저장 실패');
  await expect(page.locator('#saveStateAction')).toBeVisible();
  await page.evaluate(()=>{ syncMeta[trip().id].status='forbidden'; updateSaveState(); });
  await expect(page.locator('#saveState')).toContainText('권한');
  await expect(page.locator('#saveStateAction')).toBeHidden();
});
