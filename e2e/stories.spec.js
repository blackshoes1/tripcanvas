// With J 이야기 — 붙는 장소에서만 열리고, 실제로 재생되며, 한 번 들은 이야기는 오프라인에서도 들린다(docs/with-j-stories.md)
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {prepare,createTrip}=require('./helpers');

const MP3=fs.readFileSync(path.join(__dirname,'fixtures','story-tone.mp3'));
const CATALOG={
  version:1,voice:{disclosure:'AI 음성으로 읽었어요'},
  places:[{id:'seville-plaza-espana',kind:'PLACE',name:'스페인 광장',localName:'Plaza de España',city:'세비야',lat:37.3772,lng:-5.9869,radiusM:300,aliases:[],placeIds:[],
    tracks:[{id:'core',role:'CORE',title:'광장, 핵심만',src:'seville/plaza-espana-core.mp3',seconds:2,bytes:MP3.length,
      sha256:crypto.createHash('sha256').update(MP3).digest('hex'),sources:['P01'],reviewedAt:'2026-10-22'}]}],
  sources:{P01:{title:'세비야 관광청',url:'https://visitasevilla.es/'}}
};

async function start(context,page){
  await prepare(context);
  let audioHits=0;
  await context.route('**/stories/catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(CATALOG)}));
  await context.route('**/stories/seville/plaza-espana-core.mp3',route=>{audioHits++;return route.fulfill({status:200,contentType:'audio/mpeg',body:MP3});});
  await page.goto('/');
  await createTrip(page,'세비야');
  await page.waitForFunction(()=>typeof storyCatalog!=='undefined'&&storyCatalog&&storyCatalog.places.length===1);
  await page.evaluate(()=>{
    const d=trip().days;
    d[0].spots.push({name:'스페인 광장',lat:37.3772,lng:-5.9869},{name:'스페인 광장',lat:40.4233,lng:-3.7122,city:'마드리드'});
    render();
  });
  return ()=>audioHits;
}

test('세비야 장소에서만 열리고, 누르면 재생되며, 들은 이야기는 오프라인에서도 들린다',async({context,page})=>{
  const hits=await start(context,page);
  await expect(page.locator('.spotMetaItem.story')).toHaveCount(1);   // 마드리드의 같은 이름에는 서지 않는다
  await page.locator('.spotMetaItem.story').click();
  await expect(page.locator('#storyDialog')).toBeVisible();
  await expect(page.locator('#storyTitle')).toHaveText('스페인 광장');
  await expect(page.locator('#storyAbout summary')).toHaveText('AI 음성으로 읽었어요 · 출처 1건');
  await page.getByRole('button',{name:/광장, 핵심만/}).click();
  await expect(page.locator('#storyStatus')).toContainText('지금 듣는 이야기');
  await page.waitForFunction(()=>{const a=document.getElementById('storyAudio');return !a.paused||a.ended||a.currentTime>0;});
  expect(hits()).toBe(1);
  await expect(page.locator('#storySave')).toContainText('오프라인에서도 들을 수 있어요');

  // 창을 닫아도 계속 들리고, 아래 막대가 이어 든다
  await page.locator('#storyClose').click();
  await expect(page.locator('#storyBar')).toBeVisible();
  await expect(page.locator('#storyBarTitle')).toContainText('스페인 광장 · 광장, 핵심만');
  await page.locator('#storyBar').getByRole('button',{name:'듣기 끝내기'}).click();
  await expect(page.locator('#storyBar')).toBeHidden();

  // 비행기 모드 — 받은 사본에서 다시 재생한다(네트워크를 다시 부르지 않는다)
  await context.setOffline(true);
  await page.locator('.spotMetaItem.story').click();
  await page.getByRole('button',{name:/광장, 핵심만/}).click();
  await expect(page.locator('#storyStatus')).toContainText('지금 듣는 이야기');
  await page.waitForFunction(()=>{const a=document.getElementById('storyAudio');return !a.paused||a.ended||a.currentTime>0;});
  expect(hits()).toBe(1);
  await context.setOffline(false);
});

test('받다 끊긴 음성(지문이 다름)은 담지 않고 다시 누르라고 말한다',async({context,page})=>{
  await prepare(context);
  await context.route('**/stories/catalog.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(CATALOG)}));
  await context.route('**/stories/seville/plaza-espana-core.mp3',route=>route.fulfill({status:200,contentType:'audio/mpeg',body:MP3.subarray(0,1000)}));
  await page.goto('/');
  await createTrip(page,'세비야');
  await page.waitForFunction(()=>typeof storyCatalog!=='undefined'&&storyCatalog&&storyCatalog.places.length===1);
  await page.evaluate(()=>{trip().days[0].spots.push({name:'Plaza de España',lat:37.3772,lng:-5.9869});render();});
  await page.locator('.spotMetaItem.story').click();
  await page.getByRole('button',{name:/광장, 핵심만/}).click();
  await expect(page.locator('#storyStatus')).toContainText('끝까지 받지 못했어요');
  expect(await page.evaluate(async()=>!!(await (await caches.open(STORY_CACHE)).match('stories/seville/plaza-espana-core.mp3')))).toBe(false);
});
