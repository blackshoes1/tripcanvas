// app.js 통합 배선 테스트 — jsdom에 실제 index.html + lib.js + sync.js + app.js를 올려 함수 배선을 검증한다.
// 순수 함수 테스트가 못 잡는 'anchor vs carry' 류 배선 회귀를 자동 검출하는 것이 목적.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* jsdom 미설치 → 통합 테스트는 skip */ }
const noJsdom = JSDOM ? false : 'jsdom 미설치 (npm install 필요)';

const root = path.join(__dirname, '..');

// index.html에서 <script> 태그를 모두 제거하고, lib.js·sync.js·app.js를 인라인으로 주입해 실행한다.
// 외부 SDK(google/kakao/supabase/Sortable)는 미정의, 네트워크(fetch)는 거부 스텁으로 두고
// 앱의 가드(if(window.google)…, .catch 등)가 처리하게 한다.
function boot() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = () => Promise.reject(new Error('no-net'));                          // loadFx 등 네트워크 차단(가드가 catch)
  window.LZString = { compressToEncodedURIComponent: (x) => x, decompressFromEncodedURIComponent: (x) => x };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(root, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('lib.js');
  inject('sync.js');
  inject('app.js');
  return window;
}
// 여행 하나를 store에 넣고 activeId·activeDay 지정
function withTrip(w, daysJson, activeDay = 0) {
  w.eval(`store.trips.push({id:'__it__',name:'T',start:'2026-08-01',days:${daysJson}}); store.activeId='__it__'; activeDay=${activeDay};`);
}

test('통합 부트: index.html+lib+app 무크래시 로드', { skip: noJsdom }, () => {
  const w = boot();
  ['dayContext', 'startAnchorFor', 'carryStayFor', 'desiredEngine', 'legModeOf', 'normalizeTrip', 'animPath', 'dayEtas']
    .forEach((fn) => assert.equal(w.eval(`typeof ${fn}`), 'function', `${fn} 정의됨`));
});

test('통합: 동기화 실패 상태를 보존하고 명시적 재시도로 회복한다', { skip: noJsdom }, async () => {
  const w=boot();
  w.eval(`user={id:'u1'}; sb={rpc:async()=>({data:null,error:{message:'offline'}})};`);
  await w.eval(`syncTripCloud({id:'retry1',name:'R',days:[{spots:[]}]})`);
  assert.equal(w.eval(`syncMeta.retry1.status`),'error');
  w.eval(`clearTimeout(cloudRetryT); sb={rpc:async()=>({data:[{applied:true,conflict:false,revision:2,data:null,deleted_at:null}],error:null})};`);
  await w.eval(`syncTripCloud({id:'retry1',name:'R',days:[{spots:[]}]})`);
  assert.equal(w.eval(`syncMeta.retry1.status`),'clean');
  assert.equal(w.eval(`syncMeta.retry1.revision`),2);
  w.close();
});

test('통합: 충돌 UI는 클라우드·기기·복사본 세 선택지를 제공한다', { skip: noJsdom }, () => {
  const w=boot();
  assert.equal(w.document.getElementById('syncUseCloud').textContent,'클라우드본 사용');
  assert.equal(w.document.getElementById('syncUseDevice').textContent,'이 기기본 사용');
  assert.match(w.document.getElementById('syncKeepCopy').textContent,/복사본/);
  w.close();
});

test('통합: 사이드바·이미지 ETA 동일 + 비숙소 앵커 반영 (anchor 배선 회귀 방지)', { skip: noJsdom }, () => {
  const w = boot();
  // Day1은 숙소 없이 마지막 장소(비숙소)로 끝남 → carry면 ETA 반영 안 됨, anchor면 반영됨
  withTrip(w, `[
    {mode:'car',startAt:'09:00',spots:[{lat:37.50,lng:127.00,name:'A',city:'S'},{lat:37.52,lng:127.03,name:'last',city:'S'}]},
    {mode:'car',startAt:'09:00',spots:[{lat:37.60,lng:127.10,name:'B',city:'S'}]}
  ]`);
  const sidebar = w.eval('dayContext(1).timeline[0].eta');
  const image = w.eval('dayEtas(trip().days[1], startAnchorFor(1))[0]');
  assert.equal(sidebar, image, '사이드바·이미지 ETA가 같아야(둘 다 anchor 기준)');
  assert.ok(sidebar > w.eval('parseHM("09:00")'), '비숙소 전날 마지막 장소가 ETA에 반영');
  assert.equal(w.eval('carryStayFor(1)'), null, '숙소 아님 → 🏠 carry는 null');
});

test('통합: startPolicy none → 앵커·이월·재생 연결 모두 사라짐', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[
    {mode:'car',startAt:'09:00',spots:[{lat:37.5,lng:127,name:'A',city:'S',stay:true}]},
    {mode:'car',startAt:'09:00',startPolicy:'none',spots:[{lat:37.6,lng:127.1,name:'B',city:'S'}]}
  ]`);
  assert.equal(w.eval('startAnchorFor(1)'), null, 'none → 앵커 없음');
  assert.equal(w.eval('carryStayFor(1)'), null, 'none → carry 없음');
  assert.equal(w.eval('hm(dayContext(1).timeline[0].eta)'), '09:00', 'none → 이월 이동 미반영');
  assert.equal(w.eval('animPath().some(p=>p.di===1)'), false, 'none → 재생에 Day2 이월 구간 없음(단일 장소)');
});

test('통합: 혼합 여행 엔진이 보는 범위 따라 전환 (국내일=카카오 / 해외일=구글 / 전체=구글)', { skip: noJsdom }, () => {
  const w = boot();
  withTrip(w, `[
    {mode:'car',spots:[{lat:37.5665,lng:126.978,name:'Seoul',city:'Seoul'}]},
    {mode:'transit',spots:[{lat:35.68,lng:139.76,name:'Tokyo',city:'Tokyo'}]}
  ]`);
  w.eval('activeDay=0'); assert.equal(w.eval('desiredEngine()'), 'google', '혼합 전체 → 구글');
  w.eval('activeDay=1'); assert.equal(w.eval('desiredEngine()'), 'kakao', '국내 일자 → 카카오');
  w.eval('activeDay=2'); assert.equal(w.eval('desiredEngine()'), 'google', '해외 일자 → 구글');
});

test('통합: 구간별 수단(legMode) 우선, 없거나 무효면 일자 기본/car', { skip: noJsdom }, () => {
  const w = boot();
  assert.equal(w.eval(`legModeOf({mode:'walk',spots:[]}, {legMode:'flight'})`), 'flight');
  assert.equal(w.eval(`legModeOf({mode:'walk',spots:[]}, {})`), 'walk');
  assert.equal(w.eval(`legModeOf({mode:'zzz',spots:[]}, {legMode:'bad'})`), 'car');
});

test('통합: 검색 오류 분류 classifySearchErr (인증/할당량/네트워크/일반)', { skip: noJsdom }, () => {
  const w = boot();
  assert.equal(w.eval(`classifySearchErr(new Error('Failed to fetch'))`), 'network');
  assert.equal(w.eval(`classifySearchErr(new Error('OVER_QUERY_LIMIT: quota exceeded'))`), 'quota');
  assert.equal(w.eval(`classifySearchErr(new Error('This API project is not authorized to use this API'))`), 'auth');
  assert.equal(w.eval(`classifySearchErr(new Error('RefererNotAllowedMapError'))`), 'auth');
  assert.equal(w.eval(`classifySearchErr(new Error('boom'))`), 'error');
  ['auth', 'quota', 'network', 'error'].forEach(k =>
    assert.equal(w.eval(`typeof SEARCH_ERR_MSG['${k}']`), 'string', `${k} 안내문 존재`));
});

test('통합: 재생 탐색 계산 playSeekTarget / playLegIndexAt', { skip: noJsdom }, () => {
  const w = boot();
  // phases [0..100 dur2000][100..300 dur4000], gtotal 300, frac 0.5 → d=150 (두번째 phase)
  const t = JSON.parse(w.eval(`JSON.stringify(playSeekTarget([{a:0,b:100,dur:2000},{a:100,b:300,dur:4000}], 300, 0.5))`));
  assert.equal(t.pIdx, 1);
  assert.equal(t.d, 150);
  assert.ok(Math.abs(t.elapsed - ((150 - 100) / 200 * 4000)) < 1e-6, `elapsed=${t.elapsed}`);   // 1000ms
  assert.equal(w.eval(`playSeekTarget([{a:0,b:100,dur:2000}], 100, 1).pIdx`), 0);                // 끝은 마지막 phase
  // leg 인덱스: legStarts=[0,50,120]
  assert.equal(w.eval(`playLegIndexAt([0,50,120], 0)`), 0);
  assert.equal(w.eval(`playLegIndexAt([0,50,120], 60)`), 1);
  assert.equal(w.eval(`playLegIndexAt([0,50,120], 200)`), 2);
});
