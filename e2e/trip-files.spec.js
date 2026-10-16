const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');
// Routing assertions mock the API; WebKit otherwise sends SW-controlled fetches
// past Playwright routes. PWA passthrough is verified separately in pwa.spec.js.
test.use({serviceWorkers:'block'});

function wave(){
  const bytes=Buffer.alloc(44+16000);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(16000,40);
  return bytes;
}
async function setup(context,page,state){
  await prepare(context);
  await context.route('**/api/v1/trips/**/files**',async route=>{
    const request=route.request(),url=new URL(request.url()),id=url.pathname.split('/files/')[1];
    if(state.offline)return route.abort();
    if(state.unavailable)return route.fulfill({status:503,json:{message:'서버에 연결할 수 없어요.'}});
    if(request.method()==='POST'){
      state.attempts++;
      if(state.failOnce&&state.attempts===1)return route.fulfill({status:503,json:{message:'잠시 뒤 다시 시도해 주세요.'}});
      const bytes=request.postDataBuffer(),name=url.searchParams.get('name');
      const file={id:'00000000-0000-4000-8000-'+String(state.files.length+1).padStart(12,'0'),
        kind:url.searchParams.get('kind'),placeKey:url.searchParams.get('placeKey'),name,title:name,
        mime:name.endsWith('.wav')?'audio/wav':'application/pdf',size:bytes.length,position:state.files.length,createdAt:new Date().toISOString()};
      state.files.push(file);state.bytes[file.id]=bytes;return route.fulfill({json:{file}});
    }
    if(request.method()==='DELETE'){state.files=state.files.filter(row=>row.id!==id);return route.fulfill({json:{ok:true}});}
    if(request.method()==='PATCH'){
      const patch=request.postDataJSON(),file=state.files.find(row=>row.id===id);
      if(patch.title)file.title=patch.title;
      return route.fulfill({json:{ok:true}});
    }
    if(id){const file=state.files.find(row=>row.id===id);return route.fulfill({contentType:file.mime,body:state.bytes[id]});}
    return route.fulfill({json:{files:state.files,canEdit:state.canEdit}});
  });
  await page.goto('/');
  await page.evaluate(()=>{
    user={id:'file-account'};tripRoles={'file-trip':'OWNER'};
    store.trips=[{id:'file-trip',name:'신혼여행',start:'2026-10-26',days:[{spots:[{name:'대성당',placeId:'cathedral'},{name:'광장',placeId:'plaza'}]}]}];
    store.activeId='file-trip';activeDay=0;
    TC_API.configure({baseUrl:location.origin,getToken:async()=> 'test-token'});render();
  });
}
function state(){return {files:[],bytes:{},canEdit:true,attempts:0,offline:false};}
test('PC에서 업로드한 문서를 다른 기기에서 내려받고 오프라인에서 다시 연다',async({browser,context,page},testInfo)=>{
  const shared=state();await setup(context,page,shared);
  await page.evaluate(()=>openTripFiles());await expect(page.locator('#tripFileInput')).toBeEnabled();
  await page.locator('#tripFileInput').setInputFiles({name:'입장 티켓.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nticket')});
  await expect(page.locator('#tripFileStatus')).toContainText('1개 파일을 공유');
  const phone=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),phonePage=await phone.newPage();
  await setup(phone,phonePage,shared);await phonePage.evaluate(()=>openTripFiles());
  await expect(phonePage.locator('#tripFileList h3')).toHaveText('입장 티켓.pdf');
  await phonePage.getByRole('button',{name:'오프라인 저장',exact:true}).click();
  await expect(phonePage.locator('#tripFileList')).toContainText('오프라인 저장됨');
  shared.unavailable=true;await phonePage.locator('#tripFileRefresh').click();
  await expect(phonePage.locator('#tripFileStatus')).toContainText('오프라인이에요');
  await expect(phonePage.locator('#tripFileList h3')).toHaveText('입장 티켓.pdf');
  shared.unavailable=false;
  shared.offline=true;await phonePage.locator('#tripFileRefresh').click();
  await expect(phonePage.locator('#tripFileStatus')).toContainText('오프라인이에요');
  await expect(phonePage.locator('#tripFileList h3')).toHaveText('입장 티켓.pdf');
  await expect(phonePage.locator('#tripFileUpload')).toBeHidden();
  await phonePage.screenshot({path:testInfo.outputPath('phone-files.png')});
  const download=phonePage.waitForEvent('download');await phonePage.getByRole('button',{name:'내려받기',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('입장 티켓.pdf');
  await phone.close();
});
test('장소별 공유 음성은 재시도 후 한 번 저장되고 창을 닫아도 실제 재생한다',async({context,page,browserName})=>{
  test.skip(browserName==='webkit'&&process.platform==='win32','Windows WebKit에는 WAV 디코더가 없어 macOS WebKit·실기기에서 재생 확인 필요.');
  const shared=state();shared.failOnce=true;await setup(context,page,shared);
  await page.evaluate(()=>openTripFiles('AUDIO',audioGuideKey(trip().days[0].spots[0]),'대성당'));
  await expect(page.locator('#tripFileInput')).toBeEnabled();
  await page.locator('#tripFileInput').setInputFiles({name:'대성당.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.locator('#tripFileStatus')).toContainText('1개 파일을 공유');expect(shared.attempts).toBe(2);
  await page.getByRole('button',{name:'듣기',exact:true}).click();
  await expect.poll(()=>page.locator('#tripFileAudio').evaluate(a=>a.currentTime)).toBeGreaterThan(0);
  await page.locator('#tripFileClose').click();await expect(page.locator('#tripFilePlayer')).toBeVisible();
  await page.evaluate(()=>openTripFiles('AUDIO',audioGuideKey(trip().days[0].spots[1]),'광장'));
  await expect(page.locator('#tripFileList')).toContainText('이 장소에 공유한 음성이 없어요.');
  await page.locator('#tripFileClose').click();await page.locator('#tripFilePlayerClose').click();
});
test('보기 권한에서는 공유 파일을 읽고 계정 변경은 열린 창과 재생을 닫는다',async({context,page})=>{
  const shared=state();shared.canEdit=false;await setup(context,page,shared);await page.evaluate(()=>openTripFiles());
  await expect(page.locator('#tripFileUpload')).toBeHidden();
  await page.evaluate(()=>{user={id:'other-account'};TC_FILE_UI.check();});
  await expect(page.locator('#tripFileDialog')).not.toBeVisible();
});
test('반복 방문한 장소 뒤의 장소도 선택한 곳에 공유 음성을 연결한다',async({context,page})=>{
  const shared=state();await setup(context,page,shared);
  await page.evaluate(()=>{
    trip().days[0].spots.splice(1,0,{...trip().days[0].spots[0]});
    window.openAudioGuides(0,2,true);
  });
  await expect(page.locator('#audioGuideFiles')).toBeEnabled();
  await page.locator('#sharedAudioBtn').click();
  await expect(page.locator('#tripFileContext')).toContainText('광장');
  await expect(page.locator('#tripFileInput')).toBeEnabled();
  await page.locator('#tripFileInput').setInputFiles({name:'광장.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.locator('#tripFileStatus')).toContainText('1개 파일을 공유');
  expect(shared.files[0].placeKey).toBe('["google","plaza"]');
});
test('로그인한 장소의 기본 진입은 공유 목록이며 기존 기기 음성도 다시 열 수 있다',async({context,page})=>{
  const shared=state();await setup(context,page,shared);
  await page.evaluate(()=>window.openAudioGuides(0,0));
  await expect(page.locator('#tripFileDialog')).toBeVisible();
  await expect(page.locator('#tripFileContext')).toHaveText('대성당');
  await page.locator('#tripFileLocalAudio').click();
  await expect(page.locator('#audioGuideBg')).toBeVisible();
  await expect(page.locator('#audioGuideFiles')).toBeEnabled();
  await page.locator('#sharedAudioBtn').click();
  await expect(page.locator('#tripFileDialog')).toBeVisible();
  await expect(page.locator('#tripFileContext')).toContainText('대성당');
});
