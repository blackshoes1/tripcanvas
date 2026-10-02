const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');

test('서비스워커 업데이트가 입력 중 자동 새로고침하지 않는다',async({browser})=>{
  const context=await browser.newContext();await prepare(context);
  await context.addInitScript(()=>{
    const installing={state:'installing',addEventListener:(name,fn)=>{if(name==='statechange')window.__swState=fn;}};
    const registration={waiting:null,installing,update:async()=>{},addEventListener:(name,fn)=>{if(name==='updatefound')window.__swFound=fn;}};
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{controller:{},register:async()=>registration,getRegistration:async()=>registration}});
    window.__triggerSwUpdate=()=>{window.__swFound();installing.state='installed';window.__swState();};
  });
  const page=await context.newPage();await page.goto('/');
  await page.locator('.addSpot').first().click();
  await page.locator('#spotName').fill('작성 중인 장소');
  await page.waitForFunction(()=>typeof window.__triggerSwUpdate==='function'&&typeof window.__swFound==='function');
  await page.evaluate(()=>window.__triggerSwUpdate());
  await expect(page.locator('#spotName')).toHaveValue('작성 중인 장소');
  await expect(page.locator('#toast')).toContainText('새 버전이 있어요');
  await context.close();
});

test('서비스워커가 POST /api 요청을 가로채 실패시키지 않는다',async({browser})=>{
  // 가드: SW는 GET·비/api만 다룬다 — 향후 SW 캐시 로직 변경(예: put을 await)이 POST 서버 호출을 깨지 않게
  const context=await browser.newContext({serviceWorkers:'allow'});await prepare(context);
  const page=await context.newPage();await page.goto('/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();   // SW 제어 상태에서
  const result=await page.evaluate(async()=>{
    try{ const r=await fetch('/api/hotel-offers',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); return {status:r.status}; }
    catch(e){ return {error:String(e&&e.name)}; }
  });
  expect(result.error,`SW가 POST를 실패시킴: ${JSON.stringify(result)}`).toBeUndefined();   // 정적 e2e 서버라 404지만, 네트워크 오류면 안 된다
  await context.close();
});

test('서비스워커 앱 셸은 오프라인 새로고침을 지원한다',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow'});await prepare(context);
  const page=await context.newPage();await page.goto('/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#tripSel')).toBeVisible();
  await context.setOffline(false);await context.close();
});

test('첫 방문 직후에도 오프라인 새로고침에서 앱이 그려진다',async({browser})=>{
  // 첫 방문의 스크립트 요청은 아직 SW를 거치지 않아 network-first가 캐시를 채워 주지 않는다 — 오프라인에서 쓸 것은
  // 설치 때 담은 셸뿐이다. 그 셸이 index.html이 부르는 주소(?v=…)와 다르면 뼈대(#sidebar)만 뜨고 일정은 비어 있다.
  const context=await browser.newContext({serviceWorkers:'allow'});await prepare(context);
  const page=await context.newPage();await page.goto('/');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('.dayCard').first()).toBeVisible();   // app.js가 그리는 것 — 스크립트까지 캐시에서 왔다
  await context.setOffline(false);await context.close();
});
