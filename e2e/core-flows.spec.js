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

test('백그라운드 재렌더(날씨 등)가 열린 작업 메뉴를 닫지 않는다',async({page})=>{
  // CI에서 표면화된 레이스의 회귀 방지: 메뉴를 연 직후 날씨 도착이 renderSidebar를 밀어넣어도 메뉴가 유지돼야 한다
  await createTrip(page,'메뉴 유지');
  await page.locator('.addSpot').first().click();
  await page.locator('#spotName').fill('광화문');
  await page.locator('#spotCity').fill('서울');
  await page.evaluate(()=>{document.getElementById('spotLat').value='37.5759';document.getElementById('spotLng').value='126.9768';});
  await page.locator('#spotSave').click();
  await page.locator('.spot .actionMenu summary').click();
  await expect(page.locator('.spot .actionMenu')).toHaveAttribute('open','');
  await page.evaluate(()=>bgRender(renderSidebar));            // 날씨 응답 도착 시뮬레이션
  await page.waitForTimeout(150);
  await expect(page.locator('.spot .actionMenu')).toHaveAttribute('open','',{timeout:1000});
  await page.locator('.spot .actionMenu button[title="편집"]').click();   // 메뉴 항목이 그대로 클릭 가능
  await expect(page.locator('#spotModalBg')).toHaveClass(/show/);
  await page.locator('#spotCancel').click();
  await page.waitForTimeout(900);                              // 메뉴 닫힘 후 미뤄둔 재렌더가 정상 실행(무예외)
  await expect(page.locator('.spot')).toContainText('광화문');
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

test('장소를 탭해 선택하면 새 장소가 그 바로 뒤에 들어간다',async({page})=>{
  await page.evaluate(`(()=>{const t={id:'ins',name:'I',start:'2026-09-01',days:[{title:'D1',drive:'',note:'',mode:'transit',spots:[
    {name:'경복궁',city:'서울',desc:'',lat:37.5796,lng:126.9770},
    {name:'북촌한옥마을',city:'서울',desc:'',lat:37.5826,lng:126.9831},
    {name:'인사동',city:'서울',desc:'',lat:37.5720,lng:126.9856}]}]};
    store.trips=[t];store.activeId='ins';save();activeDay=0;render();})()`);

  const addBtn=page.locator('.addSpotBtn').first();
  await expect(addBtn).toHaveText('＋ 장소 추가');                    // 선택 전엔 맨 뒤

  // 2번 장소를 탭해 선택 → 버튼이 그 자리에서 어디에 넣을지 밝힌다(재렌더를 기다리지 않는다)
  await page.locator('.spotList .spot').nth(1).locator('.spotIdentity').click();
  await expect(addBtn).toHaveText('＋ 2번 뒤에 장소 추가');

  const add=async(name)=>{
    await addBtn.click();
    await page.locator('#spotName').fill(name);
    await page.evaluate(()=>{document.getElementById('spotLat').value='37.58';document.getElementById('spotLng').value='126.98';});
    await page.locator('#spotSave').click();
  };
  await add('삼청동 카페');
  expect(await page.evaluate(()=>trip().days[0].spots.map(s=>s.name)))
    .toEqual(['경복궁','북촌한옥마을','삼청동 카페','인사동']);

  // 방금 넣은 게 선택돼 있어 연달아 추가하면 계속 이어붙는다
  await expect(addBtn).toHaveText('＋ 3번 뒤에 장소 추가');
  await add('국립현대미술관');
  expect(await page.evaluate(()=>trip().days[0].spots.map(s=>s.name)))
    .toEqual(['경복궁','북촌한옥마을','삼청동 카페','국립현대미술관','인사동']);
});
