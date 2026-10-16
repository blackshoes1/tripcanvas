const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');

// A real PCM WAV catches corrupt Blob persistence and unsupported media wiring.
function wavFile(name='대성당 이야기.wav'){
  const rate=8000,samples=4000,buffer=Buffer.alloc(44+samples*2);
  buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);
  buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*1200),44+i*2);
  return {name,mimeType:'audio/wav',buffer};
}

async function seedTrips(page){
  await page.evaluate(()=>{
    const cathedral={name:'세비야 대성당',city:'세비야',lat:37.3858,lng:-5.9931,placeId:'cathedral'};
    store.trips=[
      {id:'audio-trip-a',name:'음성 여행 A',start:'2026-10-26',days:[
        {title:'세비야',spots:[cathedral,{name:'스페인 광장',city:'세비야',lat:37.3772,lng:-5.9869,placeId:'plaza'}]},
        {title:'둘째 날',spots:[]}
      ]},
      {id:'audio-trip-b',name:'음성 여행 B',start:'2026-10-26',days:[{title:'세비야',spots:[{...cathedral}]}]}
    ];
    store.activeId='audio-trip-a';activeDay=0;save();render();
  });
}

async function openGuides(page,di=0,si=0){
  await page.evaluate(({di,si})=>window.openAudioGuides(di,si,true),{di,si});
  await expect(page.locator('#audioGuideBg')).toBeVisible();
  await expect(page.locator('#audioGuideFiles')).toBeEnabled();
}

async function choosePlace(page,name){
  const value=await page.locator('#audioGuidePlaceSelect option').evaluateAll((options,name)=>
    options.find(option=>option.textContent.includes(name))?.value,name);
  expect(value,`매칭 대상 장소가 선택 목록에 있어야 함: ${name}`).toBeTruthy();
  await page.locator('#audioGuidePlaceSelect').selectOption(value);
  await expect(page.locator('#audioGuideFiles')).toBeEnabled();
}

test.beforeEach(async({context,page})=>{
  await prepare(context);await page.goto('/');
  // Complete the first SW installation before interacting, so its initial reload
  // cannot race file selection on slower engines.
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await seedTrips(page);
});

test('장소 메뉴에서 음성을 여러 개 연결하고 새로고침 후 유지한다',async({page})=>{
  const menu=page.locator('.spot .actionMenu').first();
  await menu.locator('summary').click();
  await menu.locator('button[title="음성 가이드"]').click();
  await expect(page.locator('#audioGuideBg')).toBeVisible();
  await expect(page.locator('#audioGuideFiles')).toBeEnabled();
  await expect(page.locator('#audioGuideBg')).toContainText('세비야 대성당');
  await page.locator('#audioGuideFiles').setInputFiles([wavFile(),wavFile('재미있는 이야기.wav')]);
  await expect(page.locator('.audioGuideItem')).toHaveCount(2);
  const audio=page.locator('.audioGuideItem audio').first();
  expect(await audio.getAttribute('src')).toMatch(/^blob:/);
  expect(await audio.evaluate(el=>el.autoplay)).toBe(false);
  // Importing local audio must never add a blob URL or binary data to the shared trip.
  expect(await page.evaluate(()=>JSON.stringify(store.trips))).not.toMatch(/blob:|data:audio|audioGuides/);
  await page.locator('#audioGuideClose').click();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await openGuides(page);
  await expect(page.locator('.audioGuideItem')).toHaveCount(2);
  await expect(page.locator('#audioGuideList')).toContainText('대성당 이야기.wav');
  expect(await page.locator('.audioGuideItem audio').first().getAttribute('src')).toMatch(/^blob:/);
});

test('저장한 WAV 음성을 오프라인에서 실제로 재생한다',async({context,page,browserName})=>{
  test.skip(browserName==='webkit'&&process.platform==='win32',
    'Windows WebKit은 WAV 디코딩 미지원이며 오프라인 reload도 내부 오류로 실패함. macOS WebKit 또는 실기기에서 오프라인 재생 검증 필요.');
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile());
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await expect.poll(()=>page.locator('.audioGuideItem audio').evaluate(el=>el.duration)).toBeCloseTo(0.5,1);
  await page.locator('#audioGuideClose').click();
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await openGuides(page);
  const audio=page.locator('.audioGuideItem audio');
  await expect.poll(()=>audio.evaluate(el=>el.duration)).toBeCloseTo(0.5,1);
  await page.locator('#audioGuideTitle').click();
  await audio.evaluate(el=>el.play());
  await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(0);
  await context.setOffline(false);
});

test('고른 장소에만 매칭하며 같은 장소라도 다른 여행에는 나타나지 않는다',async({page})=>{
  await openGuides(page);
  await choosePlace(page,'스페인 광장');
  await page.locator('#audioGuideFiles').setInputFiles(wavFile('광장 이야기.wav'));
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await choosePlace(page,'세비야 대성당');
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile('대성당 전용.wav'));
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await choosePlace(page,'스페인 광장');
  await expect(page.locator('#audioGuideList')).toContainText('광장 이야기.wav');
  await page.locator('#audioGuideClose').click();
  await page.evaluate(()=>{store.activeId='audio-trip-b';activeDay=0;save();render();});
  await openGuides(page);
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
});

test('장소 이름과 일자 순서가 바뀌어도 기존 장소의 음성이 유지된다',async({page})=>{
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile());
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await page.locator('#audioGuideClose').click();
  await page.evaluate(()=>commit(()=>{
    const spot=trip().days[0].spots.shift();spot.name='Catedral de Sevilla';
    trip().days[1].spots.push(spot);
  }));
  await openGuides(page,1,0);
  await expect(page.locator('#audioGuideBg')).toContainText('Catedral de Sevilla');
  await expect(page.locator('#audioGuideList')).toContainText('대성당 이야기.wav');
  await page.locator('#audioGuideClose').click();
  await openGuides(page,0,0);
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
});

test('잘못된 파일은 저장하지 않고 삭제한 음성은 새로고침 뒤에도 남지 않는다',async({page})=>{
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles({name:'설명.txt',mimeType:'text/plain',buffer:Buffer.from('이야기')});
  await expect(page.locator('#audioGuideStatus')).toContainText(/음성|오디오/);
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile());
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await page.evaluate(()=>{window.confirm=()=>true;});
  await page.locator('.audioGuideItem').getByRole('button',{name:/음성 삭제$/}).click();
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
  await page.reload();
  await openGuides(page);
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
});

test('창을 닫으면 Blob URL을 해제하고 다시 열 때 선택한 장소를 표시한다',async({page})=>{
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles([wavFile('첫 이야기.wav'),wavFile('둘째 이야기.wav')]);
  await expect(page.locator('.audioGuideItem')).toHaveCount(2);
  await page.evaluate(()=>{
    const players=Array.from(document.querySelectorAll('#audioGuideList audio'));
    window.__guideLifecycle={players,urls:players.map(player=>player.src),revoked:[]};
    const revoke=URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL=url=>{window.__guideLifecycle.revoked.push(url);revoke(url);};
  });
  await page.locator('#audioGuideClose').click();
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  expect(await page.evaluate(()=>{
    const state=window.__guideLifecycle;
    return state.players.every(player=>player.paused&&!player.getAttribute('src'))&&
      state.urls.every(url=>state.revoked.includes(url));
  })).toBe(true);
  await openGuides(page,0,1);
  await expect(page.locator('#audioGuidePlace')).toContainText('스페인 광장');
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  await openGuides(page);
  await expect(page.locator('#audioGuidePlace')).toContainText('세비야 대성당');
  await expect(page.locator('.audioGuideItem')).toHaveCount(2);
});

test('한 번에 한 음성만 재생하고 닫기와 계정 변경 때 재생을 멈춘다',async({page,browserName})=>{
  test.skip(browserName==='webkit'&&process.platform==='win32',
    'Windows WebKit WAV 디코더 미지원. macOS WebKit 또는 실기기에서 실제 재생 검증 필요.');
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles([wavFile('첫 이야기.wav'),wavFile('둘째 이야기.wav')]);
  await expect(page.locator('.audioGuideItem')).toHaveCount(2);
  await page.locator('#audioGuideTitle').click();
  const players=page.locator('#audioGuideList audio');
  await players.nth(0).evaluate(async player=>{window.__firstPlayer=player;player.loop=true;await player.play();});
  await expect.poll(()=>players.nth(0).evaluate(player=>player.paused)).toBe(false);
  await players.nth(1).evaluate(async player=>{window.__secondPlayer=player;player.loop=true;await player.play();});
  await expect.poll(()=>players.nth(0).evaluate(player=>player.paused)).toBe(true);
  await expect.poll(()=>players.nth(1).evaluate(player=>player.paused)).toBe(false);
  await page.locator('#audioGuideClose').click();
  expect(await page.evaluate(()=>window.__firstPlayer.paused&&window.__secondPlayer.paused)).toBe(true);
  await openGuides(page);
  await page.locator('#audioGuideTitle').click();
  await players.nth(0).evaluate(async player=>{window.__accountPlayer=player;player.loop=true;await player.play();});
  await page.evaluate(()=>{user={id:'audio-user-a',email:'audio-a@example.com'};render();});
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  expect(await page.evaluate(()=>window.__accountPlayer.paused)).toBe(true);
});

test('계정을 바꾸면 열린 창을 닫고 같은 여행의 다른 계정 가이드를 분리한다',async({page})=>{
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile('로그아웃 상태의 이야기.wav'));
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  // Keep the trip fixed: this exercises the same account change boundary render() checks.
  await page.evaluate(()=>{user={id:'audio-user-a',email:'audio-a@example.com'};render();});
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  await openGuides(page);
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile('A 계정 이야기.wav'));
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await page.evaluate(()=>{user={id:'audio-user-b',email:'audio-b@example.com'};render();});
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  await openGuides(page);
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile('B 계정 이야기.wav'));
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await page.evaluate(()=>{user={id:'audio-user-a',email:'audio-a@example.com'};render();});
  await openGuides(page);
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await expect(page.locator('#audioGuideList')).toContainText('A 계정 이야기.wav');
  await expect(page.locator('#audioGuideList')).not.toContainText('B 계정 이야기.wav');
  await page.evaluate(()=>{user=null;render();});
  await openGuides(page);
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await expect(page.locator('#audioGuideList')).toContainText('로그아웃 상태의 이야기.wav');
});

test('재생할 수 없는 음성은 실패 이유를 보여 주고 삭제할 수 있다',async({page})=>{
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles({name:'손상된 음성.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('this is not an audio stream')});
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await expect(page.locator('#audioGuideStatus')).toContainText('재생하지 못했어요');
  await page.evaluate(()=>{window.confirm=()=>true;});
  await page.locator('.audioGuideItem').getByRole('button',{name:/음성 삭제$/}).click();
  await expect(page.locator('.audioGuideItem')).toHaveCount(0);
});

test('지금 화면 위에서 음성 창을 조작하고 닫으면 지금 화면으로 돌아온다',async({page})=>{
  await page.locator('#travelBtn').click();
  await expect(page.locator('#travel')).toBeVisible();
  await page.locator('#travelList .tLinks').first().getByRole('button',{name:'음성 가이드',exact:true}).click();
  await expect(page.locator('#audioGuideBg')).toBeVisible();
  await expect(page.locator('#audioGuideFiles')).toBeEnabled();
  expect(await page.locator('#travel').evaluate(el=>el.inert)).toBe(true);
  expect(await page.locator('#audioGuideClose').evaluate(button=>{
    const rect=button.getBoundingClientRect(),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    return top===button||button.contains(top);
  })).toBe(true);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile('도착해서 듣는 이야기.wav'));
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  await page.locator('#audioGuideClose').click();
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  await expect(page.locator('#travel')).toBeVisible();
  expect(await page.locator('#travel').evaluate(el=>el.inert)).toBe(false);
  await page.locator('#travelDay').selectOption('0');
  await page.locator('#travelList .tLinks').first().getByRole('button',{name:'음성 가이드',exact:true}).click();
  await expect(page.locator('#audioGuideList')).toContainText('도착해서 듣는 이야기.wav');
  await page.keyboard.press('Escape');
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  await expect(page.locator('#travel')).toBeVisible();
  expect(await page.locator('#travel').evaluate(el=>el.inert)).toBe(false);
});

test('다른 빈 장소는 매칭 창을 깨뜨리지 않고 선택한 빈 장소는 안내한다',async({page})=>{
  await page.evaluate(()=>{trip().days[0].spots.push({name:'',city:''});render();});
  await openGuides(page);
  await expect(page.locator('#audioGuidePlaceSelect option')).toHaveCount(2);
  await expect(page.locator('#audioGuidePlace')).toContainText('세비야 대성당');
  await page.locator('#audioGuideClose').click();
  await page.evaluate(()=>window.openAudioGuides(0,2));
  await expect(page.locator('#audioGuideBg')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('장소 이름이나 위치');
});

test('휴대폰 화면에서 긴 파일명과 재생기가 가로로 넘치지 않는다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openGuides(page);
  await page.locator('#audioGuideFiles').setInputFiles(wavFile('세비야_대성당에서_발견하는_흥미로운_이야기_아주긴파일명_2026.wav'));
  await expect(page.locator('.audioGuideItem')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const modal=page.locator('#audioGuideBg .modal');
  expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(page.locator('#audioGuideClose')).toBeInViewport();
});
