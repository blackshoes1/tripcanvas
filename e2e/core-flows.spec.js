const {test,expect}=require('@playwright/test');
const {prepare,createTrip,clickMore}=require('./helpers');

test.beforeEach(async({context,page})=>{await prepare(context);await page.goto('/');});

test('여행 생성 → 장소 추가·편집·삭제 → 새로고침 유지',async({page})=>{
  await createTrip(page,'E2E 서울');
  await page.locator('.addSpot').first().click();
  await page.locator('#spotName').fill('광화문');
  await page.locator('#spotCity').fill('서울');
  await page.evaluate(()=>{document.getElementById('spotLat').value='37.5759';document.getElementById('spotLng').value='126.9768';});
  await page.locator('#spotSave').click();
  await expect(page.locator('.spot')).toContainText('광화문');

  await page.locator('.spot .actionMenu summary').click();
  await page.locator('.spot .actionMenu button[title="편집"]').click();
  await page.locator('#spotName').fill('경복궁');
  await page.locator('#spotSave').click();
  await expect(page.locator('.spot')).toContainText('경복궁');
  await page.reload();
  await expect(page.locator('#tripSel')).toContainText('E2E 서울');
  await expect(page.locator('.spot')).toContainText('경복궁');

  await page.evaluate(()=>{window.confirm=()=>true;});
  await page.locator('.spot .actionMenu summary').click();
  await page.locator('.spot .actionMenu button[title="복사"]').click();
  await expect(page.locator('.spot')).toHaveCount(2);
  await page.locator('.spot').nth(1).locator('.actionMenu summary').click();
  await page.locator('.spot').nth(1).locator('.actionMenu button[title="삭제"]').click();
  await expect(page.locator('.spot')).toHaveCount(1);
  await page.locator('.spot .actionMenu summary').click();
  await page.locator('.spot .actionMenu button[title="편집"]').click();
  await page.locator('#spotDelBtn').click();
  await expect(page.locator('.spot')).toHaveCount(0);
});

test('여행 전환과 활성·비활성 삭제는 undo로 복원된다',async({page})=>{
  await createTrip(page,'여행 A');
  await createTrip(page,'여행 B');
  const aValue=await page.locator('#tripSel option',{hasText:'여행 A'}).getAttribute('value');
  await page.locator('#tripSel').selectOption(aValue);
  await expect(page.locator('#tripSel')).toContainText('여행 A');

  await page.locator('#tripPickerBtn').click();
  await page.locator('.tripRow',{hasText:'여행 B'}).locator('button[title="이 여행 삭제"]').click();
  await expect(page.locator('#tripListBody')).not.toContainText('여행 B');
  await page.locator('#toast .toastAct').click();
  await expect.poll(()=>page.evaluate(()=>store.trips.map(t=>t.name))).toContain('여행 B');
  await page.locator('#tripListClose').click();
  await page.locator('#tripPickerBtn').click();
  await expect(page.locator('#tripListBody')).toContainText('여행 B');
  await page.locator('#tripListClose').click();

  await page.locator('#tripPickerBtn').click();
  await page.locator('.tripRow.active button[title="이 여행 삭제"]').click();
  await page.locator('#toast .toastAct').click();
  await expect(page.locator('#tripSel')).toContainText('여행 A');
});

test('공유 링크 읽기전용 보기와 내 여행으로 저장',async({browser})=>{
  const sender=await browser.newContext();await prepare(sender);const p=await sender.newPage();await p.goto('/');await createTrip(p,'공유 테스트');
  const hash=await p.evaluate(()=>encodeURIComponent(JSON.stringify(store.trips.find(t=>t.id===store.activeId))));
  await sender.close();
  const receiver=await browser.newContext();await prepare(receiver);const page=await receiver.newPage();
  await page.goto('/#v='+hash);
  await expect(page.locator('#roBar')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/readonly/);
  await page.locator('#roSave').click();
  await expect(page.locator('body')).not.toHaveClass(/readonly/);
  await expect(page.locator('#tripSel')).toContainText('공유 테스트');
  await receiver.close();
});

test('가져오기·내보내기와 390px 모바일 핵심 화면',async({page})=>{
  const imported={id:'external',name:'가져온 여행',start:'2027-01-01',days:[{title:'Day',spots:[{name:'장소',city:'도시'}]}]};
  await page.locator('#importFile').setInputFiles({name:'trip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
  await expect(page.locator('#tripSel')).toContainText('가져온 여행');
  const download=page.waitForEvent('download');
  await clickMore(page,'#exportBtn');
  expect((await download).suggestedFilename()).toMatch(/가져온_여행\.json/);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#moreBtn')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
