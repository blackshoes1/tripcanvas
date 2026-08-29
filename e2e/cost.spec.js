const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');

// 여행 하나를 통째로 심는다 — 비용 표시는 예약·장소 데이터만 있으면 되고, 입력 경로는 통합 테스트가 본다
const SEED=`(()=>{const t={id:'cost',name:'C',start:'2026-09-01',days:[
  {title:'D1',drive:'',note:'',mode:'transit',spots:[{name:'A',city:'M',desc:'',lat:40.41,lng:-3.69,cost:18000}]},
  {title:'D2',drive:'',note:'',mode:'transit',spots:[{name:'B',city:'P',desc:'',lat:39.56,lng:2.64,cost:12000}]},
  {title:'D3',drive:'',note:'',mode:'transit',spots:[{name:'C',city:'S',desc:'',lat:39.70,lng:2.62,cost:9000}]},
  {title:'D4',drive:'',note:'',mode:'transit',spots:[{name:'D',city:'P',desc:'',lat:39.34,lng:2.97}]}],
 bookings:[
  {id:'c1',type:'car',   title:'Car',  price:420000,start:'2026-09-02',end:'2026-09-04'},
  {id:'h1',type:'hotel', title:'Hotel',price:600000,start:'2026-09-02',end:'2026-09-04'},
  {id:'f1',type:'flight',title:'Fl',   price:180000,start:'2026-09-02',end:'2026-09-02'}]};
 store.trips=[t];store.activeId='cost';save();activeDay=0;render();})()`;

test.beforeEach(async({context})=>{await prepare(context);});

test('전체 비용이 필터바에 보이고, 탭하면 내역이 화면 안에 뜬다 (모바일)',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.evaluate(SEED);

  // 일자 칩이 넘쳐 가로 스크롤되는 상황에서도 총액은 오른쪽에 붙어 보인다
  const chip=page.locator('.costMenu > summary');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('₩1,239,000');
  await page.locator('#filterbar').evaluate(el=>{el.scrollLeft=0;});
  const inView=await chip.evaluate(el=>{const r=el.getBoundingClientRect();
    return r.left>=0 && r.right<=window.innerWidth+1 && r.width>0;});
  expect(inView,'가로 스크롤 위치와 무관하게 화면 안에 있어야').toBe(true);

  // 필터바가 스크롤 컨테이너라 내부 패널이 잘렸던 자리 — 내역이 온전히 보여야 한다
  await chip.click();
  const panel=page.locator('.costMenu .viewMenuPanel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('렌터카');
  // getBoundingClientRect는 '레이아웃'이라 잘려도 그대로 나온다 → 실제로 눌리는지(히트테스트)로 본다.
  // elementFromPoint는 overflow 클리핑을 반영하므로, 필터바에 잘리면 다른 요소가 잡힌다.
  const reachable=await page.evaluate(()=>{
    const el=document.querySelector('.costMenu .viewMenuPanel');
    const rows=[...el.querySelectorAll('.costRow')];
    const last=rows[rows.length-1].getBoundingClientRect();          // 합계 줄 — 패널 맨 아래
    const hit=document.elementFromPoint(Math.round(last.left+last.width/2), Math.round(last.top+last.height/2));
    return {inPanel:!!(hit&&el.contains(hit)), hit:hit? (hit.className||hit.tagName):null};
  });
  expect(reachable.inPanel,`패널 아래쪽이 필터바에 잘려 안 보인다 (그 자리에 잡힌 것: ${reachable.hit})`).toBe(true);
  const fits=await panel.evaluate(el=>{const r=el.getBoundingClientRect();
    return r.left>=0 && r.right<=window.innerWidth+1 && r.bottom<=window.innerHeight+1;});
  expect(fits,'패널이 화면 밖으로 나가면 안 된다').toBe(true);
});

test('데스크톱에서는 내역이 총액 칩 바로 아래에 붙는다',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await page.goto('/');
  await page.evaluate(SEED);

  const chip=page.locator('.costMenu > summary');
  await chip.click();
  const panel=page.locator('.costMenu .viewMenuPanel');
  await expect(panel).toBeVisible();
  const gap=await page.evaluate(()=>{
    const c=document.querySelector('.costMenu').getBoundingClientRect();
    const p=document.querySelector('.costMenu .viewMenuPanel').getBoundingClientRect();
    return {below:Math.round(p.top-c.bottom), rightAligned:Math.round(p.right-c.right)};
  });
  expect(gap.below,'칩 바로 아래(6px)에 붙어야 — 모바일용 fixed 좌표가 새면 안 된다').toBe(6);
  expect(Math.abs(gap.rightAligned),'칩 오른쪽 끝에 정렬').toBeLessThanOrEqual(1);
});

test('일자 카드 하루 비용에 예약 하루치가 들어간다',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await page.goto('/');
  await page.evaluate(SEED);
  const costs=page.locator('.dayCard .dist', {hasText:'하루 비용'});
  await expect(costs.nth(1)).toContainText('₩632,000');          // 장소 12,000 + 예약 620,000
  await expect(costs.nth(1)).toContainText('예약 ₩620,000');
  await expect(costs.nth(3)).toContainText('₩140,000');          // 체크아웃 날 — 렌터카만
});

test('보기 설정 패널도 모바일 필터바에 잘리지 않는다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.evaluate(SEED);

  const menu=page.locator('.viewMenu:not(.costMenu) > summary');
  await menu.click();
  const panel=page.locator('.viewMenu:not(.costMenu) .viewMenuPanel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('색상 기준');

  // 히트테스트 — 패널 맨 아래 버튼이 실제로 눌리는 자리에 있어야 한다 (레이아웃만 보면 잘려도 통과한다)
  const reachable=await page.evaluate(()=>{
    const el=document.querySelector('.viewMenu:not(.costMenu) .viewMenuPanel');
    const last=el.querySelector('.cityFocus') || el.lastElementChild;
    const r=last.getBoundingClientRect();
    const hit=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));
    return {inPanel:!!(hit&&el.contains(hit)), hit:hit? (hit.className||hit.tagName):null};
  });
  expect(reachable.inPanel,`보기 설정 패널 아래쪽이 잘렸다 (그 자리에 잡힌 것: ${reachable.hit})`).toBe(true);

  // 테마 전환이 실제로 눌린다 — 잘려 있으면 클릭이 다른 요소에 막힌다
  await page.locator('#themeBtn').click();
  await expect(panel).toBeVisible();
});
