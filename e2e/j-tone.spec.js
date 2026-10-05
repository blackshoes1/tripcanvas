const {test,expect}=require('@playwright/test');
const path=require('node:path');
const os=require('node:os');
const {prepare,clickMore}=require('./helpers');
test.beforeEach(async({context,page})=>{await prepare(context);await page.goto('/');});

test('예문을 보고 말투를 고르면 기기에 남고 J 문장만 바뀐다',async({page})=>{
  await clickMore(page,'#jToneMenuBtn');
  const modal=page.locator('#jToneModalBg');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('radio')).toHaveCount(3);
  await expect(modal).toContainText('많이 걸었네. 잠깐 쉬어갈까?');
  await modal.getByRole('radio',{name:/찐친/}).check();
  await expect(modal.getByRole('radio',{name:/찐친/})).toBeChecked();
  expect(await page.evaluate(()=>jSay('pulse.noPlan'))).toBe('오늘은 정해둔 일정이 없어');
  await page.reload();
  await clickMore(page,'#jToneMenuBtn');
  await expect(modal.getByRole('radio',{name:/찐친/})).toBeChecked();
  await page.screenshot({path:path.join(os.tmpdir(),'j-tone-web.png'),fullPage:true});
});

test('실패한 계정 저장은 기기에 남고 재시도 뒤 다른 계정과 분리된다',async({page})=>{
  await page.evaluate(()=>{
    user={id:'a'};syncAccountEpoch++;TC_AUTH.getToken=async()=> 'token-a';
    TC_API.configure({getToken:async()=> 'token-a',fetchImpl:async(_url,opts)=>{
      if(opts.method==='PUT') return new Response(JSON.stringify({code:'UPSTREAM_ERROR'}),{status:502});
      return new Response(JSON.stringify({preferences:{jTone:'FRIENDLY'},trips:[]}));
    }});
  });
  await clickMore(page,'#jToneMenuBtn');
  await page.getByRole('radio',{name:/직장 동료/}).check();
  await expect(page.locator('#jToneStatus')).toContainText('이 기기에만 적용');
  await page.evaluate(()=>{
    TC_API.configure({fetchImpl:async()=>new Response(JSON.stringify({jTone:'POLITE'}))});
  });
  await page.getByRole('button',{name:'계정에 다시 저장'}).click();
  await expect(page.locator('#jToneStatus')).toHaveText('계정에 저장했어요.');
  await page.evaluate(()=>{user={id:'b'};syncAccountEpoch++;jToneRevision++;refreshJCopy();});
  await expect(page.getByRole('radio',{name:/여행 메이트/})).toBeChecked();
});

test('늦은 계정 저장 응답이 새 계정의 설정을 덮어쓰지 않는다',async({page})=>{
  await page.evaluate(()=>{
    user={id:'a'};syncAccountEpoch++;TC_AUTH.getToken=async()=> 'token-a';
    TC_API.configure({getToken:async()=> 'token-a',fetchImpl:async(_url,opts)=>{
      if(opts.method==='PUT') return new Promise(resolve=>{window.finishTone=()=>resolve(new Response(JSON.stringify({jTone:'CASUAL'})));});
      return new Response(JSON.stringify({preferences:{jTone:'FRIENDLY'},trips:[]}));
    }});
  });
  await clickMore(page,'#jToneMenuBtn');
  await page.getByRole('radio',{name:/찐친/}).check();
  await expect.poll(()=>page.evaluate(()=>typeof window.finishTone)).toBe('function');
  await page.evaluate(()=>{
    user={id:'b'};syncAccountEpoch++;jToneRevision++;jToneSaving=false;jToneMessage='';refreshJCopy();window.finishTone();
  });
  await expect(page.getByRole('radio',{name:/여행 메이트/})).toBeChecked();
  expect(await page.evaluate(()=>localStorage.getItem('tripcanvas_j_tone_v1:b'))).toBeNull();
});


test('토큰 조회 실패 뒤에도 선택을 보존하고 다시 저장할 수 있다',async({page})=>{
  await page.evaluate(()=>{
    user={id:'a'};syncAccountEpoch++;TC_AUTH.getToken=async()=>{throw new Error('offline');};
    TC_API.configure({fetchImpl:async()=>new Response(JSON.stringify({jTone:'CASUAL'}))});
  });
  // 메뉴의 계정 조회는 이번 저장 실패 시나리오와 무관하다.
  await page.evaluate(()=>{renderJToneChoices();document.getElementById('jToneModalBg').classList.add('show');});
  await page.getByRole('radio',{name:/찐친/}).check();
  await expect(page.locator('#jToneStatus')).toContainText('이 기기에만 적용');
  await expect(page.getByRole('radio',{name:/여행 메이트/})).toBeEnabled();
  await page.evaluate(()=>{TC_AUTH.getToken=async()=> 'token-a';});
  await page.getByRole('button',{name:'계정에 다시 저장'}).click();
  await expect(page.locator('#jToneStatus')).toHaveText('계정에 저장했어요.');
});


test('휴대폰 화면에서 말투 선택 후 여행 중 이해 문장이 새 말투로 보인다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    trip().start='2026-09-01';
    trip().days=[{title:'마드리드',drive:'',note:'',mode:'car',startAt:'09:00',spots:[
      {name:'프라도',city:'마드리드',lat:40.41,lng:-3.70,stayMin:120},
      {name:'저녁 예약',city:'마드리드',lat:40.42,lng:-3.70,bookAt:'19:30',stayMin:90}]}];
    travelClock=()=>({todayISO:'2026-09-01',nowMin:660});render();
  });
  await clickMore(page,'#jToneMenuBtn');
  await page.getByRole('radio',{name:/직장 동료/}).check();
  await page.screenshot({path:path.join(os.tmpdir(),'j-tone-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.locator('#travelBtn').click();
  await page.locator('#travelIntent').fill('오늘 좀 피곤해서 많이 걷기 싫어');
  await page.locator('#travelIntentApply').click();
  await expect(page.locator('#travelIntentEcho')).toContainText('이렇게 이해했습니다');
  await expect(page.locator('#travelIntentApply')).toHaveText('반영');
});
