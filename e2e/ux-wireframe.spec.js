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

test('긴 장소명과 많은 메타데이터도 모바일 일정 카드 경계를 넘지 않는다',async({context,page})=>{
  await prepare(context); await page.goto('/');
  await page.evaluate(()=>{
    const long='Aeropuerto Adolfo Suárez Madrid-Barajas International Terminal 4S 출국장과 렌터카 반납 카운터';
    const spots=Array.from({length:12},(_,i)=>({
      name:i===1?long:`${i+1}번째 일정 · 매우 긴 박물관과 역사 지구 복합 문화 공간 이름`,
      city:'Madrid', lat:40.4168+i*.004, lng:-3.7038+i*.004, stayMin:75,
      at:i===1?'08:30':'', bookAt:i===1?'08:00':'', cost:i===1?228:0, cur:i===1?'EUR':'KRW',
      bookUrl:i===1?'https://example.com/booking':'', opt:i===1, stay:i===0, nights:i===0?2:1,
      legMode:i?'transit':''
    }));
    const t=store.trips.find(x=>x.id===store.activeId);
    t.name='긴 데이터 테스트'; t.start='2026-10-25'; t.timeZone='Europe/Madrid';
    t.days=[{title:'마드리드에서 세비야를 거쳐 구시가지까지 이동하는 매우 긴 일정 제목',mode:'transit',startAt:'07:00',timeZone:'Europe/Madrid',spots}];
    activeDay=0; save(); render();
  });

  for(const size of [{width:360,height:800},{width:375,height:812},{width:390,height:844},{width:430,height:932}]){
    await page.setViewportSize(size);
    await page.locator('#sidebar').evaluate(el=>el.dataset.snap='expanded');
    const result=await page.locator('.dayCard').first().evaluate(card=>{
      const cardRect=card.getBoundingClientRect();
      const selectors=['.dayHead','.dayHeadMain','.dayHeadMeta','.dayBody','.spot','.spotMain','.spotMeta','.spotLeg'];
      const overflow=[...card.querySelectorAll(selectors.join(','))].filter(el=>{
        const r=el.getBoundingClientRect();
        return r.left<cardRect.left-1||r.right>cardRect.right+1||el.scrollWidth>el.clientWidth+1;
      }).map(el=>el.className);
      const names=[...card.querySelectorAll('.spotName')].map(el=>{
        const cs=getComputedStyle(el), line=parseFloat(cs.lineHeight);
        return {height:el.getBoundingClientRect().height,line};
      });
      const menus=[...card.querySelectorAll('.spotMain > .actionMenu > summary')].map(el=>el.getBoundingClientRect().width);
      const metaWrap=[...card.querySelectorAll('.spotMeta')].every(el=>getComputedStyle(el).flexWrap==='wrap');
      const metaNoWrap=[...card.querySelectorAll('.spotMetaItem')].every(el=>getComputedStyle(el).whiteSpace==='nowrap');
      return {overflow,names,menus,metaWrap,metaNoWrap};
    });
    expect(result.overflow,`${size.width}px에서 가로 넘침`).toEqual([]);
    expect(result.names.every(x=>x.height<=x.line*2+1),`${size.width}px 장소명 2줄 제한`).toBeTruthy();
    expect(result.menus.every(width=>width>=44),`${size.width}px 메뉴 터치 영역`).toBeTruthy();
    expect(result.metaWrap).toBeTruthy();
    expect(result.metaNoWrap).toBeTruthy();
  }
});

test('여행 모드는 지금 무엇을 할지 제안하고, 받아들이면 일정에 반영된다',async({context,page})=>{
  await prepare(context); await page.goto('/'); await createTrip(page,'적응형 여행');
  await page.evaluate(()=>{
    const t=store.trips.find(x=>x.id===store.activeId);
    t.start='2026-09-01';
    t.days=[
      {title:'마드리드',drive:'',note:'',mode:'car',startAt:'09:00',spots:[
        {name:'프라도',city:'마드리드',lat:40.41,lng:-3.70,stayMin:120},
        {name:'저녁 예약',city:'마드리드',lat:40.42,lng:-3.70,bookAt:'19:30',stayMin:90}]},
      {title:'마드리드',drive:'',note:'',mode:'car',spots:[
        {name:'레티로 공원',city:'마드리드',lat:40.415,lng:-3.70,stayMin:90}]}];
    todayISO=()=>'2026-09-01'; nowMinutes=()=>11*60;   // 여행 중 11:00로 고정 (시각 의존 제거)
    render();
  });
  await page.locator('#travelBtn').click();
  const suggest=page.locator('#travelSuggest');
  await expect(suggest.locator('.sgCard').first()).toBeVisible();
  await expect(suggest).toContainText('레티로 공원');
  await expect(suggest.locator('.sgWhy li').first()).toBeVisible();   // 추천 이유를 항상 설명한다
  await suggest.locator('.sgCard',{hasText:'레티로 공원'}).getByRole('button',{name:'오늘 일정에 넣기'}).click();
  await expect.poll(()=>page.evaluate(()=>trip().days[0].spots.map(s=>s.name).join(','))).toContain('레티로 공원');
  await page.locator('#travelList .tSpot').first().getByRole('button',{name:'다녀왔어요'}).click();
  await expect(page.locator('#travelList .tSpot').first()).toHaveClass(/done/);
  await expect(page.locator('#travelNext')).toContainText('레티로 공원');
});

test('여행 모드에서 거절한 제안은 다시 올라오지 않는다',async({context,page})=>{
  await prepare(context); await page.goto('/'); await createTrip(page,'거절 테스트');
  await page.evaluate(()=>{
    const t=store.trips.find(x=>x.id===store.activeId);
    t.start='2026-09-01';
    t.days=[
      {title:'',drive:'',note:'',mode:'car',startAt:'09:00',spots:[
        {name:'프라도',city:'마드리드',lat:40.41,lng:-3.70,stayMin:120},
        {name:'저녁 예약',city:'마드리드',lat:40.42,lng:-3.70,bookAt:'19:30',stayMin:90}]},
      {title:'',drive:'',note:'',mode:'car',spots:[
        {name:'레티로 공원',city:'마드리드',lat:40.415,lng:-3.70,stayMin:90}]}];
    todayISO=()=>'2026-09-01'; nowMinutes=()=>11*60;
    render();
  });
  await page.locator('#travelBtn').click();
  const suggest=page.locator('#travelSuggest');
  await suggest.locator('.sgCard',{hasText:'레티로 공원'}).getByRole('button',{name:'건너뛰기'}).click();
  await expect(suggest).not.toContainText('레티로 공원');
  await page.evaluate(()=>renderTravel(0));
  await expect(suggest).not.toContainText('레티로 공원');
  expect(await page.evaluate(()=>trip().days[1].spots[0].name)).toBe('레티로 공원');   // 거절은 여행 데이터를 건드리지 않는다
});
