// ───────────────── 저장소 ─────────────────
const LS_KEY = 'tripcanvas_v1';
const ONBOARD_KEY='tripcanvas_onboarded_v1';
const THEME_KEY='tripcanvas_theme_v1';
let firstVisit=false;
try{ const raw=localStorage.getItem(LS_KEY),saved=raw&&JSON.parse(raw); firstVisit=!localStorage.getItem(ONBOARD_KEY)&&(!saved||!Array.isArray(saved.trips)||saved.trips.every(t=>t.id==='spain2026')); }catch(_){ firstVisit=true; }
const OPS_KEY = 'tripcanvas_ops_v1';
// 오류 본문·URL·여행 내용은 기록하지 않고, 운영 진단에 필요한 범주와 상태 코드만 세션에 보관한다.
function reportOperationalError(scope,error,context){
  const entry={at:new Date().toISOString(),scope:String(scope).slice(0,40),code:'unknown'};
  if(error&&typeof error==='object') entry.code=String(error.name||error.status||error.code||'error').slice(0,40);
  if(context&&Number.isFinite(context.status)) entry.status=context.status;
  try{ const rows=JSON.parse(sessionStorage.getItem(OPS_KEY)||'[]'); rows.push(entry); sessionStorage.setItem(OPS_KEY,JSON.stringify(rows.slice(-20))); }catch(_){}
  console.warn(`[TripCanvas:${entry.scope}]`,entry.code);
}
window.addEventListener('error',e=>reportOperationalError('window.error',e.error));
window.addEventListener('unhandledrejection',e=>reportOperationalError('promise.rejection',e.reason));
// 지도 도로색(노랑·주황)과 겹치지 않게 대비 강한 색을 앞(자주 쓰는 초반 일자)에 배치.
// 겹치기 쉬운 코랄·라임·노랑은 뒤로. 경로선·핀·도시색·범례 모두 이 순서를 공유.
const PALETTE = ['#e63946','#1e88e5','#2ecc71','#9b59b6','#ec4899','#14b8a6','#8d6e63','#ff7f50','#a3e635','#f6b93b'];   // 빨강·파랑·초록·보라·핑크·청록·브라운·코랄·라임·노랑
let store = null;
let sb = null, user = null, syncTimer = null;   // Supabase 클라이언트/로그인 사용자/동기화 디바운스
const SYNC_KEY='tripcanvas_synced';             // v1 호환: id 배열을 v2 meta로 1회 흡수
const SYNC_META_KEY='tripcanvas_sync_v2';
let legacySynced=[];
try{ legacySynced=JSON.parse(localStorage.getItem(SYNC_KEY))||[]; }catch(e){}
let syncMeta=TC_SYNC.loadMeta(localStorage.getItem(SYNC_META_KEY),legacySynced);
let suppressCloudOnce=false;
let syncInFlight=0;      // 진행 중인 업로드 수 — 이 사이엔 syncMeta를 통째로 갈아끼우지 않는다
let syncMetaStale=false; // 업로드 중이라 미뤄둔 syncMeta 갱신이 있는지
function persistSyncMeta(){ try{ localStorage.setItem(SYNC_META_KEY,JSON.stringify(syncMeta)); }catch(e){} }
function syncEntry(id){ return syncMeta[id]||(syncMeta[id]={revision:null,status:'new',op:'',hash:''}); }

function seedSpain(){
  return {
    id:'spain2026', sample:true, name:'🇪🇸 스페인 신혼여행', start:'2026-10-25',
    days:[
      {title:'마드리드 도착', drive:'', note:'07:00 착륙. 시차적응 겸 가벼운 일정. ⚽ 경기가 일요일이면 오늘 직관!', spots:[
        {name:'바라하스 공항 (MAD)',lat:40.4720,lng:-3.5610,city:'마드리드',desc:'07:00 도착',opt:false},
        {name:'푸에르타 델 솔',lat:40.4169,lng:-3.7035,city:'마드리드',desc:'중심 광장. 곰 동상, 0km 표지',opt:false},
        {name:'마요르 광장',lat:40.4155,lng:-3.7074,city:'마드리드',desc:'회랑 카페에서 저녁 추천',opt:false},
        {name:'메트로폴리타노 (AT마드리드)',lat:40.4362,lng:-3.5995,city:'마드리드',desc:'⚽ vs 데포르티보 (10/25 주말 확정, 킥오프 시간은 4주 전 발표 — 티켓: atleticodemadrid.com)',opt:false}]},
      {title:'마드리드', drive:'', note:'⚽ 경기가 월요일이면 저녁 직관', spots:[
        {name:'왕궁 (Palacio Real)',lat:40.4179,lng:-3.7143,city:'마드리드',desc:'관람 2~3시간. 온라인 사전예약 권장 (patrimonionacional.es)',opt:false},
        {name:'프라도 미술관',lat:40.4138,lng:-3.6921,city:'마드리드',desc:'월~토 10-20 / 일 10-19. 폐관 2시간 전 무료(줄 김)',opt:false}]},
      {title:'마드리드', drive:'', note:'그란비아 쇼핑, 못 본 곳 보충', spots:[
        {name:'레티로 공원',lat:40.4153,lng:-3.6845,city:'마드리드',desc:'수정궁, 호수 보트. 1~2시간',opt:true}]},
      {title:'→ 톨레도 (1박)', drive:'🚗 마드리드 → 톨레도 · 73km · 약 50분', note:'오전 렌터카 픽업 후 출발', spots:[
        {name:'알카사르',lat:39.8581,lng:-4.0210,city:'톨레도',desc:'군사박물관. 톨레도 전경',opt:true},
        {name:'톨레도 대성당',lat:39.8570,lng:-4.0236,city:'톨레도',desc:'스페인 가톨릭 수석 대성당. 1.5시간',opt:false},
        {name:'미라도르 델 바예',lat:39.8534,lng:-4.0166,city:'톨레도',desc:'구시가 전체 뷰포인트. 일몰 강추 🌇 차로 5분',opt:false}]},
      {title:'→ 세비야 (2박)', drive:'🚗 톨레도 → (코르도바) → 세비야 · 460km · 약 4시간 20분', note:'중간에 코르도바 메스키타 2시간 경유 추천', spots:[
        {name:'메스키타 (코르도바)',lat:37.8789,lng:-4.7794,city:'코르도바',desc:'이슬람+가톨릭 융합 건축. 2시간 경유',opt:true}]},
      {title:'세비야', drive:'', note:'저녁 플라멩코 공연 추천', spots:[
        {name:'세비야 대성당 & 히랄다',lat:37.3861,lng:-5.9926,city:'세비야',desc:'세계 최대 고딕 성당. 온라인 예매 필수 (catedraldesevilla.es)',opt:false},
        {name:'레알 알카사르',lat:37.3831,lng:-5.9903,city:'세비야',desc:'무데하르 궁전. 사전예약 권장. 2시간',opt:true},
        {name:'스페인 광장',lat:37.3772,lng:-5.9869,city:'세비야',desc:'대표 포토스팟. 노을+플라멩코 버스킹',opt:false},
        {name:'메트로폴 파라솔',lat:37.3931,lng:-5.9916,city:'세비야',desc:'목조 전망대. 야경 장소',opt:true}]},
      {title:'→ 론다 (1박)', drive:'🚗 세비야 → 론다 · 128km · 약 1시간 45분', note:'절벽 마을 1박 — 야경과 아침 안개 낀 다리가 압권', spots:[
        {name:'푸엔테 누에보',lat:36.7406,lng:-5.1655,city:'론다',desc:'98m 협곡 위의 다리. 협곡 아래 전망 포인트 추천',opt:false},
        {name:'론다 투우장 & 알라메다',lat:36.7423,lng:-5.1671,city:'론다',desc:'가장 오래된 투우장 + 절벽 산책로',opt:true}]},
      {title:'→ 말라가 (2박)', drive:'🚗 론다 → 말라가 · 102km · 약 1시간 20분', note:'해안도로 경유 시 +1시간', spots:[
        {name:'미하스 푸에블로',lat:36.5959,lng:-4.6373,city:'말라가',desc:'하얀 마을. 이동 중 경유',opt:true},
        {name:'말라게타 해변 (코스타 델 솔)',lat:36.7194,lng:-4.4093,city:'말라가',desc:'11월 초 낮 20°C — 해변 산책+에스페토 🍤',opt:false}]},
      {title:'말라가 · 코스타 델 솔', drive:'', note:'', spots:[
        {name:'알카사바 & 히브랄파로',lat:36.7211,lng:-4.4158,city:'말라가',desc:'항구+해안 전망. 오전 추천',opt:false},
        {name:'네르하 & 프리힐리아나',lat:36.7444,lng:-3.8770,city:'말라가',desc:'"유럽의 발코니" + 하얀 마을. 차로 50분',opt:true}]},
      {title:'→ 그라나다 (2박)', drive:'🚗 말라가 → 그라나다 · 125km · 약 1시간 30분', note:'그라나다는 음료 시키면 타파스 무료!', spots:[
        {name:'그라나다 대성당',lat:37.1763,lng:-3.5986,city:'그라나다',desc:'이사벨 여왕 묘. 오후 시내 산책',opt:true}]},
      {title:'그라나다 — 알함브라', drive:'', note:'예약 시간 엄수, 여권 지참', spots:[
        {name:'알함브라 궁전',lat:37.1761,lng:-3.5881,city:'그라나다',desc:'🚨 사전예매 필수 (tickets.alhambra-patronato.es). 나스르 궁전 입장시간 지정제. 반나절',opt:false},
        {name:'산 니콜라스 전망대',lat:37.1810,lng:-3.5927,city:'그라나다',desc:'알함브라+설산 뷰. 일몰 강추 🌇',opt:false}]},
      {title:'→ 마드리드 (2박)', drive:'🚗 그라나다 → 마드리드 · 420km · 약 4시간 15분', note:'오후 도착, 렌터카 반납', spots:[]},
      {title:'마드리드 자유일', drive:'', note:'산 미겔 시장, 레이나 소피아(게르니카), 쇼핑', spots:[]},
      {title:'출국', drive:'', note:'11:00 비행기 — 08:30 공항 도착 권장', spots:[
        {name:'바라하스 공항 (MAD)',lat:40.4720,lng:-3.5610,city:'마드리드',desc:'11:00 출국',opt:false}]}
    ]
  };
}
function load(){
  const raw=localStorage.getItem(LS_KEY), saved=parseStorePayload(raw);
  if(saved.ok) store=saved.value;
  else if(raw){
    reportOperationalError('local.invalid',new Error('validation'));
    // 거부된 정상 크기 원문은 새 seed로 덮어쓰기 전에 1회 복구본으로 남긴다.
    if(raw.length<=TC_LIMITS.storeBytes) try{ localStorage.setItem('tripcanvas_rejected_backup_v1',raw); }catch(_){}
  }
  if(!store || !store.trips || !store.trips.length){
    store = {trips:[seedSpain()], activeId:'spain2026'};
    save();
  }
}
let viewMode=null;   // #v= 읽기전용으로 보는 여행 (저장소에 저장 안 함)
// 다단계 실행취소: save 시점마다 직전 상태를 스택에 보관 (최대 30)
let histStack=[], histLast=null, histLock=false;
let lsDirty=false;   // localStorage 기록이 실패(쿼터 등)해 재시도가 필요한 상태
function save(){
  if(viewMode) return;   // 읽기전용 보기에선 아무것도 저장하지 않음
  const ser=JSON.stringify(store);
  const changed = ser!==histLast;
  // 변경도 없고 밀린 기록도 없으면 완전 무비용 (뷰 전용/비동기 재렌더가 render→save를 타도 no-op).
  // 단, 직전 기록이 실패해 lsDirty면 내용이 그대로여도 재시도한다.
  if(!changed && !lsDirty) return;
  if(changed && !histLock && histLast!==null){   // 내용이 바뀐 경우에만 undo 히스토리에 push
    histStack.push(histLast);
    if(histStack.length>30) histStack.shift();
    updateUndoBtn();
  }
  histLast=ser;
  try{ localStorage.setItem(LS_KEY, ser); lsDirty=false; }
  catch(e){ lsDirty=true; toast('저장 공간이 부족합니다. 오래된 여행을 내보내고 삭제해 주세요','#e63946'); }
  cloudSyncActive();
}
function updateUndoBtn(){ const b=document.getElementById('undoBtn'); if(b) b.disabled=!histStack.length; }
function undo(){
  if(viewMode) return;
  if(!histStack.length){ toast('되돌릴 작업이 없습니다','#8892b0'); return; }
  store=JSON.parse(histStack.pop());
  if(!store.trips.find(t=>t.id===store.activeId)) store.activeId=store.trips[0]&&store.trips[0].id;
  // 복원 상태를 localStorage·클라우드에 기록하되, 되돌리기 자체는 히스토리에 새 항목으로 쌓지 않는다.
  // (histLast=null로 save의 "변경 없음" 조기 반환을 우회, histLock으로 push는 억제)
  histLock=true; histLast=null; save(); histLock=false;
  reconcileUndoDeletes();
  activeDay=0; render(); fitAll();
  updateUndoBtn();
  toast('실행취소됨','#8892b0');
}
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){
    if(e.target.matches('input,textarea,select'))return;   // 입력 중엔 브라우저 기본 동작
    e.preventDefault(); undo();
  }
});

// ───────────────── 탭 간 동기화 ─────────────────
// 탭마다 store를 메모리에 들고 있어서, 다른 탭이 저장하는 순간 이 탭의 store는 낡은 것이 된다.
// 그대로 두면 이 탭의 다음 편집이 상대 탭의 작업을 통째로 덮어쓴다. localStorage가 항상 최신이므로
// 다른 탭의 기록(storage 이벤트는 쓴 탭 자신에겐 안 온다)을 감지하면 그걸 정본으로 받아들인다.
let pendingExternalStore=null;
// 입력·검색·지도 지정 중이면 화면을 뺏지 않는다 (SW 자동 새로고침과 같은 판정)
function isBusyEditing(){
  return pickMode || searching || _importing
    || !!document.querySelector('.modalBg.show') || document.getElementById('travel').classList.contains('show');
}
// syncMeta도 탭마다 메모리 사본이다. 안 갱신하면 이 탭이 옛 revision으로 업로드해 헛충돌을 만든다.
function refreshSyncMetaFromStorage(){
  if(syncInFlight){ syncMetaStale=true; return; }   // 업로드 응답을 기다리는 entry 참조가 끊기지 않게 미룬다
  syncMetaStale=false;
  syncMeta=TC_SYNC.loadMeta(localStorage.getItem(SYNC_META_KEY),legacySynced);
}
function adoptExternalStore(raw){
  let parsed=null;
  try{ parsed=parseStorePayload(raw); }catch(e){ reportOperationalError('tab.sync.parse',e); return; }
  if(!parsed.ok){ reportOperationalError('tab.sync.invalid',new Error('validation')); return; }
  const day=activeDay;
  store=parsed.value;
  // 정규화를 거치면 raw와 문자열이 달라질 수 있으므로 정규화된 형태로 맞춘다.
  // 이러면 뒤이은 render→save가 "변경 없음"으로 조기 반환해 되쓰기·클라우드 에코가 없다.
  histLast=JSON.stringify(store);
  refreshSyncMetaFromStorage();
  const t=trip();
  activeDay=Math.min(day, Math.max(0,(t&&t.days?t.days.length:1)-1));
  render(); fitAll();
  toast('다른 탭의 변경을 불러왔습니다','#1d6fd6');
}
window.addEventListener('storage',e=>{
  if(viewMode) return;   // 읽기전용 보기(#v=)는 로컬 스토어를 쓰지 않는다
  if(e.key===SYNC_META_KEY){ refreshSyncMetaFromStorage(); return; }
  if(e.key!==LS_KEY || !e.newValue || e.newValue===histLast) return;
  if(isBusyEditing()){
    pendingExternalStore=e.newValue;
    toast('다른 탭에서 일정이 바뀌었어요','#e09b20',{label:'불러오기',fn:()=>{
      const v=pendingExternalStore; pendingExternalStore=null; if(v) adoptExternalStore(v);
    }});
    return;
  }
  adoptExternalStore(e.newValue);
});
// 모바일 헤더 오버플로 메뉴 (부가 동작을 ☰로 접음)
function toggleHdrMenu(e){ if(e) e.stopPropagation(); document.getElementById('hdrMenu').classList.toggle('open'); }
document.addEventListener('click',e=>{
  const m=document.getElementById('hdrMenu'); if(!m||!m.classList.contains('open')) return;
  if(e.target.closest('#hdrMenu')){ m.classList.remove('open'); return; }   // 항목 선택 → 닫기
  if(!e.target.closest('#moreBtn')) m.classList.remove('open');             // 바깥 클릭 → 닫기
});
// 현재 실행 중인 앱 버전 표시 — 스크립트 태그의 ?v= 를 읽어 자동 반영(릴리스마다 별도 수정 불필요).
// 캐시로 옛 버전이 물려 있으면 그 값이 그대로 보이므로 폰이 최신인지 바로 확인 가능. 탭하면 갱신 확인 후 새로고침.
const APP_VER=(()=>{ const s=document.querySelector('script[src*="app.js?v="]'); const m=s&&s.src.match(/[?&]v=([^&]+)/); return m?decodeURIComponent(m[1]):'dev'; })();
(function(){ const el=document.getElementById('verLabel'); if(!el) return;
  el.textContent='버전 '+APP_VER;
  el.onclick=()=>{ toast('최신 버전 확인 중…','#1d6fd6');
    if('serviceWorker' in navigator){ navigator.serviceWorker.getRegistration().then(r=>{ if(r) r.update(); }).catch(()=>{}); }
    setTimeout(()=>location.reload(),500); };
})();
function trip(){ return viewMode || store.trips.find(t=>t.id===store.activeId) || store.trips[0]; }
function uid(){ return Math.random().toString(36).slice(2,9); }
// 공유 링크/가져오기/AI 파싱으로 외부 데이터가 유입될 수 있으므로 출력 시 항상 이스케이프 (XSS 방어)
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(v){ return esc(v); }
// href용 URL 스킴 화이트리스트. esc()는 스킴을 막지 못하므로(예: javascript:alert() 는 특수문자가 없어 그대로 통과),
// 외부 유입(공유 링크·가져오기·AI 파싱) 데이터를 href로 낼 땐 반드시 이걸로 검증한다. 허용 안 되면 '' 반환.
function safeUrl(v){ const u=String(v==null?'':v).trim(); try{ return /^https?:$/.test(new URL(u, location.href).protocol) ? u : ''; }catch(e){ return ''; } }
let toastTimer=null;
function toast(msg, color, action){
  const t=document.getElementById('toast');
  t.innerHTML=''; t.appendChild(document.createTextNode(msg));
  t.style.background=color||'#2a9d3f'; t.style.display='flex';
  if(action){
    const b=document.createElement('button'); b.textContent=action.label||'실행취소'; b.className='toastAct';
    b.onclick=()=>{ t.style.display='none'; clearTimeout(toastTimer); action.fn(); };
    t.appendChild(b);
  }
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.style.display='none', action?5000:2200);
}
// 파괴적 동작 되돌리기용 스냅샷
function snapshot(){ return JSON.parse(JSON.stringify(store)); }
// 상태 변경 진입점: 뮤테이션(fn) 적용 → 재렌더(내부에서 변경분만 저장) → 선택적 지도 포커싱(opts.fit).
// render()가 save()를 품고 save()는 변경분만 기록하므로 여기서 별도 저장 호출은 불필요하다.
// 규칙: 스토어를 바꾸면 commit(), 뷰(activeDay 등)만 바꾸면 render().
function commit(fn, opts){
  if(typeof fn==='function') fn();
  render();
  if(opts && opts.fit) opts.fit();
}
function undoWith(snap){ commit(()=>{ store=snap; reconcileUndoDeletes(); activeDay=0; }, {fit:fitAll}); }

// ───────────────── 지도 (해외=Google · 국내=카카오 듀얼 엔진) ─────────────────
const GMAPS_KEY='AIzaSyCE6I2dhqk2jzNvA0ZMzDSuPi7HAfWecAM';   // HTTP 리퍼러 제한으로 보호할 것
const KAKAO_KEY='088123c29d265c5f9cc9ec8d356f54c8';          // 국내 지도·장소검색 (플랫폼 도메인 제한, 카카오맵 활성화된 기존 앱 키)
let map=null, iw=null;        // Google 지도 / 공용 InfoWindow
let kmap=null, kpopupOv=null; // 카카오 지도 / 커스텀 팝업 오버레이
let engine='google';          // 현재 표시 중인 엔진
let activeDay = 0, markers = [], lines = [], ghostStays = [], pickMode = false, sortables = [];

function onMapPick(lat,lng,placeId){
  if(!pickMode)return;
  pickMode=false; document.getElementById('pickBanner').style.display='none';
  document.getElementById('spotLat').value=lat; document.getElementById('spotLng').value=lng;
  document.getElementById('spotPlaceId').value=placeId||'';   // 탭한 POI가 특정되면 그 id를 쓰고, 아니면 이전 검색값 무효화
  document.getElementById('coordHint').textContent=`좌표: ${lat.toFixed(4)}, ${lng.toFixed(4)} ✓`;
  fillSpotFromCoords(lat,lng,false,placeId);   // 이름·도시 비어있으면 자동 채움
  document.getElementById('spotModalBg').classList.add('show');
}
// 지도 우클릭/롱프레스 → 그 좌표로 새 장소 추가 모달 (현재 활성 일자, 없으면 1일차)
function addSpotAt(lat,lng,placeId,known){
  if(viewMode) return;
  const di=activeDay? activeDay-1 : 0;
  openSpotModal(di,-1);
  document.getElementById('spotLat').value=lat; document.getElementById('spotLng').value=lng;
  document.getElementById('spotPlaceId').value=placeId||'';
  document.getElementById('coordHint').textContent=`좌표: ${(+lat).toFixed(4)}, ${(+lng).toFixed(4)} ✓ (지도에서 지정)`;
  document.getElementById('spotName').value=''; _namePrefill='';
  fillSpotFromCoords(lat,lng,true,placeId,known);    // 지정 지점의 장소명·도시 자동 채움
  setTimeout(()=>document.getElementById('spotName').focus(),50);
}
// 지도 탭/클릭 → 그 좌표로 장소 추가.
// 폰에는 우클릭이 없어 예전엔 추가 경로가 아예 닿지 않았다(탭은 pickMode에서만 동작).
// 더블탭 확대와 구분해야 하므로 짧게 지연했다가, dblclick·드래그가 오면 취소한다.
const TAP_ADD_DELAY = 260;
let _tapT = null;
function cancelMapTap(){ if(_tapT){ clearTimeout(_tapT); _tapT=null; } }
function onMapTap(lat,lng,placeId){
  if(pickMode){ onMapPick(lat,lng,placeId); return; }   // 좌표 지정 중이면 그 흐름이 우선(지연 없음)
  if(viewMode) return;                          // 읽기전용에서는 추가하지 않는다
  // 메뉴가 열려 있으면 이 탭은 '닫기'다 — 닫으려다 장소가 추가되면 안 된다.
  const hm=document.getElementById('hdrMenu');
  if(hm && hm.classList.contains('open')) return;
  cancelMapTap();
  _tapT=setTimeout(()=>{ _tapT=null; addSpotAt(lat,lng,placeId); }, TAP_ADD_DELAY);
}
// 좌표 → {name, city} 한 번의 조회. 국내=카카오 coord2Address(한국어), 해외=구글 Places 인근검색(영어명).
// ── 국내 POI 레이어 ──────────────────────────────────────────────────────────
// 카카오맵 SDK는 바탕 지도의 POI를 눌렀다는 사실도, 그 장소의 id도 주지 않는다
// (Map 이벤트: click/dblclick/rightclick… 전부 좌표뿐). 그래서 좌표로 되짚는 추측이
// 불가피했고, 그 추측이 엉뚱한 상호를 넣었다.
// → 우리가 직접 장소를 조회해 마커로 깔고, 그걸 누르게 한다. 우리가 찍었으니
//   무엇을 눌렀는지 정확히 안다 — 해외의 placeId와 같은 수준이 된다.
const POI_CATS = ['FD6','CE7','AT4','AD5','CT1','MT1','SW8'];   // 음식점·카페·관광명소·숙박·문화시설·마트·지하철역
const POI_MAX_LEVEL = 4;    // 카카오 level은 작을수록 확대. 동네 수준 이상으로 확대했을 때만 표시
const POI_MAX = 60;
const POI_FALLBACK_RADIUS = 500;   // bounds를 못 쓸 때 중심에서 훑을 반경(m)         // 화면이 라벨로 뒤덮이지 않게
let poiOverlays=[], poiSeq=0, poiT=null;

function clearKakaoPOI(){ poiOverlays.forEach(o=>{ try{ o.remove(); }catch(e){} }); poiOverlays=[]; }
function scheduleKakaoPOI(){ clearTimeout(poiT); poiT=setTimeout(refreshKakaoPOI, 350); }   // 이동 중 연타 방지
function refreshKakaoPOI(){
  const S=window.kakao&&kakao.maps&&kakao.maps.services;
  if(engine!=='kakao'||!kmap||viewMode||!S||!S.Places){ clearKakaoPOI(); return; }
  if(kmap.getLevel()>POI_MAX_LEVEL){ clearKakaoPOI(); return; }   // 넓게 보는 중엔 의미 없음
  const seq=++poiSeq, ps=new S.Places(), found=new Map();
  // 지도가 아직 크기를 못 잡았으면(전환 직후·숨김 상태) getBounds()가 한 점으로 접혀 조회가 0건이 된다.
  // 그때는 중심 반경으로 대신 훑는다.
  const bd=kmap.getBounds(), sw=bd&&bd.getSouthWest(), ne=bd&&bd.getNorthEast();
  const hasArea = !!(sw&&ne) && Math.abs(ne.getLat()-sw.getLat())>1e-6 && Math.abs(ne.getLng()-sw.getLng())>1e-6;
  const opt = hasArea ? {bounds:bd}
    : {location:kmap.getCenter(), radius:POI_FALLBACK_RADIUS, sort:S.SortBy&&S.SortBy.DISTANCE};
  let left=POI_CATS.length;
  const step=()=>{ if(--left>0) return; if(seq!==poiSeq) return; drawKakaoPOI(Array.from(found.values())); };
  POI_CATS.forEach(code=>{
    try{
      ps.categorySearch(code,(data,status)=>{
        if(status===S.Status.OK&&Array.isArray(data)) data.forEach(d=>{ if(d&&d.id&&!found.has(d.id)) found.set(d.id,d); });
        step();
      },opt);
    }catch(e){ step(); }
  });
}
function drawKakaoPOI(list){
  clearKakaoPOI();
  list.slice(0,POI_MAX).forEach(p=>{
    const lat=+p.y, lng=+p.x;
    if(!isFinite(lat)||!isFinite(lng)||!p.place_name) return;
    const el=document.createElement('button');
    el.type='button'; el.className='poiChip';
    el.textContent=p.place_name;                            // 외부 데이터 → textContent (innerHTML 금지)
    el.title=p.road_address_name||p.address_name||p.place_name;
    el.addEventListener('click',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      cancelMapTap();                                       // 지도 탭의 지연 추가와 겹치지 않게
      addSpotAt(lat,lng,'',{ name:p.place_name, city:cityFromKakaoAddress(p.address_name||p.road_address_name||'') });
    });
    poiOverlays.push(Engines.kakao.marker(lat,lng,el));
  });
}

// 탭한 자리에서 '가장 가까운' 장소만 인정할 반경. 이보다 멀면 이름을 추측하지 않고 비워 둔다
// (엉뚱한 상호가 채워지는 것보다 빈 칸이 낫다).
const NEAR_POI_RADIUS = 40;
// 국내는 좌표→장소 API가 없어 주소만 나온다. 그래서 여행에 실제로 담기는 카테고리만 좁게 훑어
// 가장 가까운 상호를 찾는다: 음식점·카페·관광명소·숙박·문화시설.
const KAKAO_POI_CATS = ['FD6','CE7','AT4','AD5','CT1'];
function kakaoNearbyPOI(lat,lng){
  return new Promise(resolve=>{
    const S=window.kakao&&kakao.maps&&kakao.maps.services;
    if(!S||!S.Places){ resolve(null); return; }
    const ps=new S.Places(), loc=new kakao.maps.LatLng(+lat,+lng);
    let left=KAKAO_POI_CATS.length, best=null;
    const step=()=>{ if(--left<=0) resolve(best); };
    KAKAO_POI_CATS.forEach(code=>{
      try{
        ps.categorySearch(code,(data,status)=>{
          if(status===S.Status.OK&&data&&data.length){
            const c=data[0], d=Number(c.distance);
            const dist=isFinite(d)?d:NEAR_POI_RADIUS;
            if(c.place_name&&(!best||dist<best.dist)) best={name:c.place_name,dist};
          }
          step();
        },{location:loc, radius:NEAR_POI_RADIUS, sort:S.SortBy&&S.SortBy.DISTANCE});
      }catch(e){ step(); }
    });
  });
}
function reverseSpot(lat,lng,placeId){
  return new Promise(resolve=>{
    if(inKorea({lat:+lat,lng:+lng})){
      loadKakao().then(ok=>{
        if(!ok||!window.kakao||!kakao.maps.services){ resolve({}); return; }
        new kakao.maps.services.Geocoder().coord2Address(+lng,+lat,(res,status)=>{
          let building='', city='';
          if(status===kakao.maps.services.Status.OK&&res&&res.length){
            const r=res[0], a=r.address||{};
            building=(r.road_address&&r.road_address.building_name)||'';
            const one=a.region_1depth_name||'', two=a.region_2depth_name||'';
            const metro=/(특별시|광역시|특별자치시|특별자치도)$/.test(one);
            city= metro? one.replace(/(특별시|광역시|특별자치시|특별자치도)$/,'') : (two.replace(/(시|군)$/,'')||one);
          }
          // 건물명은 '그 건물'이지 '탭한 가게'가 아니다 → 가까운 실제 상호를 우선한다
          kakaoNearbyPOI(lat,lng).then(poi=>{
            resolve({ name:(poi&&poi.name)||building||null, city:city||null });
          }).catch(()=>resolve({ name:building||null, city:city||null }));
        });
      });
    }else{
      if(!window.google||!google.maps){ resolve({}); return; }
      const FIELDS=['displayName','formattedAddress','addressComponents'];
      google.maps.importLibrary('places').then(lib=>{
        const Place=lib&&lib.Place;
        if(!Place){ resolve({}); return; }
        const done=p=>resolve(p? { name:placeName(p)||null, city:cityFromGoogle(p.addressComponents)||null } : {});
        const nearby=()=>{
          // 탭한 POI를 특정하지 못한 경우(빈 자리). 예전엔 반경 100m의 '가장 유명한' 곳을 집어와
          // 엉뚱한 가게가 들어갔다 → 좁은 반경의 '가장 가까운' 곳만 본다.
          const rank=lib.SearchNearbyRankPreference&&lib.SearchNearbyRankPreference.DISTANCE;
          const req={ fields:FIELDS, locationRestriction:{center:{lat:+lat,lng:+lng}, radius:NEAR_POI_RADIUS}, maxResultCount:1, language:'en' };
          if(rank) req.rankPreference=rank;
          Place.searchNearby(req)
            .then(({places})=>done(places&&places[0]))
            .catch(()=>resolve({}));
        };
        if(placeId){
          try{
            const place=new Place({id:placeId, requestedLanguage:'en'});
            place.fetchFields({fields:FIELDS}).then(r=>done((r&&r.place)||place)).catch(nearby);
          }catch(e){ nearby(); }
          return;
        }
        nearby();
      }).catch(()=>resolve({}));
    }
  });
}
function reverseCity(lat,lng){ return reverseSpot(lat,lng).then(r=>r.city||null); }
// 도시/그룹 자동 채움(검색 폴백). force거나 비어있거나 자동 프리필 그대로일 때만.
function fillCityFromCoords(lat,lng,force){
  const el=document.getElementById('spotCity'); const at=el.value;
  if(!(force || !at.trim() || at.trim()===(_cityPrefill||'').trim())) return;
  reverseCity(lat,lng).then(city=>{ if(city && el.value===at){ el.value=city; _cityPrefill=city; } });
}
// 검색 결과가 이미 가진 도시명으로 즉시(동기) 채움 — 사용자 입력은 보존.
function fillCityValue(city){
  if(!city) return;
  const el=document.getElementById('spotCity');
  if(!el.value.trim() || el.value.trim()===(_cityPrefill||'').trim()){ el.value=city; _cityPrefill=city; }
}
// 이름 필드 자동 채움. force=false면 사용자 입력 보존(자동 프리필/빈값만 갱신).
// 검색 결과를 직접 고르는 건 명시적 선택이므로 force=true로 기존 값도 덮어쓴다.
function fillNameValue(name, force){
  if(!name) return;
  const el=document.getElementById('spotName');
  if(force || !el.value.trim() || el.value.trim()===(_namePrefill||'').trim()){ el.value=name; _namePrefill=name; }
}
// 지도로 위치 지정 → 이름·도시를 한 번의 조회로 채움. forceCity=true면 도시는 강제 갱신.
function fillSpotFromCoords(lat,lng,forceCity,placeId,known){
  const cityEl=document.getElementById('spotCity'), nameEl=document.getElementById('spotName');
  const cityAt=cityEl.value, nameAt=nameEl.value;
  const cityOK = forceCity || !cityAt.trim() || cityAt.trim()===(_cityPrefill||'').trim();
  const nameOK = !nameAt.trim() || nameAt.trim()===(_namePrefill||'').trim();
  if(!cityOK && !nameOK) return;
  // known: POI를 눌러 '무엇인지 이미 아는' 경우 — 좌표로 되짚는 추측을 아예 건너뛴다
  (known? Promise.resolve(known) : reverseSpot(lat,lng,placeId)).then(({name,city})=>{
    if(city && cityOK && cityEl.value===cityAt){ cityEl.value=city; _cityPrefill=city; }
    if(name && nameOK && nameEl.value===nameAt){ nameEl.value=name; _namePrefill=name; }
  });
}
// 한국 지번주소 "시도 시군구 …" → 도시명 (광역시는 시도, 그 외는 시군구에서 시/군 제거)
function cityFromKoreanAddr(addr){
  const t=(addr||'').trim().split(/\s+/); if(t.length<2) return '';
  const one=t[0], two=t[1];
  if(/(특별시|광역시|특별자치시)$/.test(one)) return one.replace(/(특별시|광역시|특별자치시)$/,'');
  return two.replace(/(시|군)$/,'') || one.replace(/(도|특별자치도)$/,'');
}
// 구글 Place → 표시 이름. displayName이 문자열이든 {text} 객체든 빈값이든 방어하고, 비면 주소 앞부분으로 폴백.
// (신 Places API 버전/필드에 따라 displayName이 문자열이 아닐 수 있어 이름 채움이 조용히 실패하던 문제 방어)
function placeName(p){
  const dn=p&&p.displayName;
  const s=(dn&&typeof dn==='object')?(dn.text||''):(dn||'');
  return (s || String((p&&p.formattedAddress)||'').split(',')[0]||'').trim();
}
// 구글 Place addressComponents → 도시명(locality 우선)
function cityFromGoogle(comps){
  if(!comps||!comps.length) return '';
  const pick=t=>{ const c=comps.find(x=>(x.types||[]).includes(t)); return c?(c.longText||c.shortText||''):''; };
  const loc=pick('locality'), aa1=pick('administrative_area_level_1'), aa2=pick('administrative_area_level_2');
  if(/^(tokyo|도쿄)/i.test(aa1) && loc && !/^(tokyo|도쿄)/i.test(loc)) return aa1;   // 도쿄 특별구(Minato City 등) → '도쿄'로 묶음
  return (loc||aa2||aa1||'').replace(/(특별시|광역시|특별자치시)$/,'').replace(/(시|군)$/,'');   // 한국 지명 접미사 정리
}
window.__gmapsReady=function(){
  map=new google.maps.Map(document.getElementById('map'),{
    center:{lat:40,lng:-3.7}, zoom:6, mapId:'DEMO_MAP_ID',
    disableDefaultUI:true, zoomControl:true, clickableIcons:true, gestureHandling:'greedy'
  });
  iw=new google.maps.InfoWindow();
  map.addListener('click',e=>{
    // POI 아이콘을 탭하면 e.placeId로 '탭한 그 장소'가 특정된다. 구글 기본 정보창은 막고 우리 흐름으로.
    if(e.placeId){ if(e.stop) e.stop(); onMapTap(e.latLng.lat(), e.latLng.lng(), e.placeId); return; }
    onMapTap(e.latLng.lat(), e.latLng.lng());
  });
  map.addListener('dblclick',cancelMapTap);        // 더블탭 확대를 장소 추가로 오인하지 않게
  map.addListener('drag',cancelMapTap);            // 패닝 중 발생한 탭은 무시
  map.addListener('rightclick',e=>{ if(!pickMode) addSpotAt(e.latLng.lat(), e.latLng.lng()); });
  render();
  google.maps.event.addListenerOnce(map,'idle',()=>{ if(engine==='google') fitEntry(); });   // 레이아웃 확정 후 초기 포커싱
};
(function(){
  const s=document.createElement('script');
  s.src=`https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&v=weekly&libraries=places,marker&loading=async&callback=__gmapsReady`;
  s.async=true;
  s.onerror=()=>toast('지도를 불러오지 못했습니다 — 네트워크/API 키 확인','#e63946');
  document.head.appendChild(s);
})();
// 카카오 지도 준비 (SDK는 loadKakao가 지연 로드)
async function ensureKakaoMap(){
  if(kmap) return true;
  if(!(await loadKakao())) return false;
  kmap=new kakao.maps.Map(document.getElementById('kmap'),{center:new kakao.maps.LatLng(36.5,127.9), level:12});
  kakao.maps.event.addListener(kmap,'click',me=>onMapTap(me.latLng.getLat(), me.latLng.getLng()));
  kakao.maps.event.addListener(kmap,'dblclick',cancelMapTap);
  kakao.maps.event.addListener(kmap,'drag',cancelMapTap);
  kakao.maps.event.addListener(kmap,'rightclick',me=>{ if(!pickMode) addSpotAt(me.latLng.getLat(), me.latLng.getLng()); });
  kakao.maps.event.addListener(kmap,'idle',scheduleKakaoPOI);   // 이동·확대가 멈추면 그 범위의 장소를 깐다
  return true;
}
// 지금 보는 범위(일자 필터 중이면 그 일자, 아니면 전체)의 좌표 스팟이 '전부' 국내일 때만 카카오.
// 해외 스팟이 하나라도 보이면 카카오는 그 지역을 못 그리므로 구글(전 세계 표시). 일자 이동 시 자동 전환.
// (예: 1일차 국내→카카오, 2일차 해외→구글, 전체 보기(국내+해외)→구글)
function desiredEngine(){
  const days = activeDay ? [trip().days[activeDay-1]] : trip().days;
  let kr=0,n=0;
  days.forEach(d=> d && d.spots.forEach(s=>{ if(hasLoc(s)){ n++; if(inKorea({lat:+s.lat,lng:+s.lng})) kr++; } }));
  return (n>0 && kr===n) ? 'kakao' : 'google';
}
function setEngine(e){
  if(engine===e) return;
  engine=e;
  document.getElementById('map').style.display = e==='google'?'block':'none';
  document.getElementById('kmap').style.display = e==='kakao'?'block':'none';
  if(e==='kakao') scheduleKakaoPOI(); else clearKakaoPOI();
  if(e==='kakao'&&kmap){ kmap.relayout(); }
  setTimeout(()=>fitCurrentView(),60);   // 전환 직후 현재 보는 범위로 포커싱
}
// 현재 보는 범위로 지도 맞춤 — 일자 필터 중이면 그 일자, 아니면 전체
function fitCurrentView(){
  if(activeDay){ const d=trip().days[activeDay-1]; if(d){ const pts=d.spots.filter(hasLoc).map(s=>[s.lat,s.lng]); if(pts.length){ fitTo(pts,64,15); return; } } }
  fitAll();
}
// 카카오 커스텀 팝업 (다크 테마, InfoWindow 대체)
function openKPopup(html,lat,lng){
  closeKPopup();
  const w=document.createElement('div'); w.className='kpopup';
  w.innerHTML=`<div class="popupC">${html}</div><button class="kclose">✕</button>`;
  w.querySelector('.kclose').onclick=closeKPopup;
  kpopupOv=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(lat,lng), content:w, yAnchor:1.18, clickable:true});
  kpopupOv.setMap(kmap);
}
function closeKPopup(){ if(kpopupOv){ kpopupOv.setMap(null); kpopupOv=null; } }

// ───────────────── 지도 엔진 어댑터 ─────────────────
// google/kakao 분기를 한 곳으로 격리. 모든 오버레이 핸들은 { remove() } 형태로 통일.
const Engines={
  google:{
    ready(){ return !!map; },
    marker(lat,lng,el,onClick){
      const m=new google.maps.marker.AdvancedMarkerElement({map, position:{lat,lng}, content:el});
      if(onClick) m.addEventListener('gmp-click',onClick);
      return { _m:m, remove(){ m.map=null; } };
    },
    polyline(pts,o){
      const opt={map, path:pts, geodesic:true};
      if(o.dashed) Object.assign(opt,{strokeOpacity:0, icons:[{icon:{path:'M 0,-1 0,1', strokeOpacity:o.opacity, strokeColor:o.color, scale:2}, offset:'0', repeat:'14px'}]});
      else Object.assign(opt,{strokeColor:o.color, strokeWeight:o.weight||3, strokeOpacity:o.opacity});
      const l=new google.maps.Polyline(opt);
      return { remove(){ l.setMap(null); } };
    },
    overlay(lat,lng,el){ const m=new google.maps.marker.AdvancedMarkerElement({map, position:{lat,lng}, content:el}); return { remove(){ m.map=null; } }; },
    moveMarker(lat,lng,el){ const m=new google.maps.marker.AdvancedMarkerElement({map, position:{lat,lng}, content:el, zIndex:9999}); return { move(la,ln){ m.position={lat:la,lng:ln}; }, remove(){ m.map=null; } }; },
    openPopup(html,lat,lng,anchor){ iw.setContent(`<div class="popupC">${html}</div>`); iw.open({map, anchor:anchor&&anchor._m}); },
    closePopup(){ if(iw) iw.close(); },
    fit(pts,padPx,maxZoom){
      const b=new google.maps.LatLngBounds(); pts.forEach(p=>b.extend({lat:+p[0],lng:+p[1]}));
      map.fitBounds(b, padPx==null?48:padPx);
      if(maxZoom) google.maps.event.addListenerOnce(map,'idle',()=>{ if(map.getZoom()>maxZoom) map.setZoom(maxZoom); });
    },
    panTo(lat,lng,minZoom){ map.panTo({lat,lng}); if(minZoom&&map.getZoom()<minZoom) map.setZoom(minZoom); },
    center(lat,lng,zoom){ if(zoom!=null) map.setZoom(zoom); map.setCenter({lat,lng}); },   // 즉시 이동(추적 카메라용)
    relayout(){ google.maps.event.trigger(map,'resize'); },
    waitTiles(timeout){ return new Promise(res=>{ let done=false; const fin=()=>{ if(done) return; done=true; res(); };
      google.maps.event.addListenerOnce(map,'tilesloaded',fin); setTimeout(fin, timeout||1600); }); }
  },
  kakao:{
    ready(){ return !!kmap; },
    marker(lat,lng,el,onClick){
      const ov=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(lat,lng), content:el, xAnchor:.5, yAnchor:.5, clickable:true});
      ov.setMap(kmap);
      if(onClick){ el.style.cursor='pointer'; el.onclick=onClick; }
      return { remove(){ ov.setMap(null); } };
    },
    polyline(pts,o){
      const l=new kakao.maps.Polyline({path:pts.map(p=>new kakao.maps.LatLng(p.lat,p.lng)),
        strokeColor:o.color, strokeWeight:o.dashed?2:(o.weight||3), strokeOpacity:o.opacity, strokeStyle:o.dashed?'dash':'solid'});
      l.setMap(kmap); return { remove(){ l.setMap(null); } };
    },
    overlay(lat,lng,el){ const ov=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(lat,lng), content:el, yAnchor:.5, clickable:false}); ov.setMap(kmap); return { remove(){ ov.setMap(null); } }; },
    moveMarker(lat,lng,el){ const ov=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(lat,lng), content:el, xAnchor:.5, yAnchor:.5, zIndex:9999}); ov.setMap(kmap); return { move(la,ln){ ov.setPosition(new kakao.maps.LatLng(la,ln)); }, remove(){ ov.setMap(null); } }; },
    openPopup(html,lat,lng){ openKPopup(html,lat,lng); },
    closePopup(){ closeKPopup(); },
    fit(pts,padPx,maxZoom){
      const b=new kakao.maps.LatLngBounds(); pts.forEach(p=>b.extend(new kakao.maps.LatLng(+p[0],+p[1])));
      kmap.relayout(); kmap.setBounds(b, padPx==null?48:padPx);
      if(maxZoom){ const minLv=Math.max(1,19-maxZoom); if(kmap.getLevel()<minLv) kmap.setLevel(minLv); }
    },
    panTo(lat,lng,minZoom){ kmap.panTo(new kakao.maps.LatLng(lat,lng)); if(minZoom){ const lv=Math.max(1,19-minZoom); if(kmap.getLevel()>lv) kmap.setLevel(lv); } },
    center(lat,lng,zoom){ if(zoom!=null) kmap.setLevel(Math.round(Math.max(1,19-zoom))); kmap.setCenter(new kakao.maps.LatLng(lat,lng)); },   // 즉시 이동(추적 카메라용)
    relayout(){ kmap.relayout(); },
    waitTiles(timeout){ return new Promise(res=>{ let done=false; const fin=()=>{ if(done) return; done=true; try{kakao.maps.event.removeListener(kmap,'tilesloaded',fin);}catch(e){} res(); };
      kakao.maps.event.addListener(kmap,'tilesloaded',fin); setTimeout(fin, timeout||1600); }); }
  }
};
function ME(){ return Engines[engine]; }   // 현재 활성 엔진

function cityColors(){
  const m = {}; let i = 0;
  trip().days.forEach(d=>d.spots.forEach(s=>{ if(!(s.city in m)){ m[s.city]=PALETTE[i%PALETTE.length]; i++; } }));
  return m;
}
// 커스텀 핀 DOM (AdvancedMarker content) — 기존 .num-icon 스타일 재사용
function mkPin(color,label,opt,cat){
  const size = opt?22:27;
  const el=document.createElement('div');
  el.className='num-icon';
  el.style.cssText=`width:${size}px;height:${size}px;background:${color};${opt?'opacity:.75;':''}`;
  el.textContent=label??'';
  // 카테고리는 배지로 붙인다 — 번호(동선 순서)를 대체하지 않게
  if(cat){ const b=document.createElement('span'); b.className='pinCat'; b.textContent=cat.icon; el.appendChild(b); }
  return el;
}
function dateOf(di){
  if(!trip().start) return '';
  const d = new Date(trip().start+'T00:00:00'); d.setDate(d.getDate()+di);
  return `${d.getMonth()+1}/${d.getDate()} (${'일월화수목금토'[d.getDay()]})`;
}
// 로컬 날짜를 YYYY-MM-DD로 (타임존 밀림 방지)
// di번째 날의 ISO 날짜 (시작일 미설정 시 빈 문자열)
function isoDateOf(di){ if(!trip().start) return ''; const d=new Date(trip().start+'T00:00:00'); d.setDate(d.getDate()+di); return toISO(d); }

// 백그라운드 재렌더(날씨·구간 결과·환율·가격 추적) — 열려 있는 ⋮/보기 메뉴를 닫아버리지 않게
// 메뉴가 닫힐 때까지 미룬다. 사용자 조작(commit)의 render는 그대로 즉시 실행된다.
function bgRender(fn){
  if(document.querySelector('.actionMenu[open],.viewMenu[open]')){ setTimeout(()=>bgRender(fn),800); return; }
  fn();
}
// ── 날씨 (Open-Meteo, 무키·CORS) — 그날·첫 장소 좌표 기준, 세션 캐시 ──
const WMO={0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌦',55:'🌧',56:'🌧',57:'🌧',
  61:'🌦',63:'🌧',65:'🌧',66:'🌧',67:'🌧',71:'🌨',73:'🌨',75:'❄️',77:'🌨',80:'🌦',81:'🌧',82:'⛈',
  85:'🌨',86:'❄️',95:'⛈',96:'⛈',99:'⛈'};
const _wx={}; let _wxT=null;   // 'lat,lng@date' → {icon,tmax,tmin} | null | 'wait'
function wxKey(lat,lng,iso){ return `${(+lat).toFixed(2)},${(+lng).toFixed(2)}@${iso}`; }
function requestWx(lat,lng,iso){
  if(!iso) return null;
  const days=Math.round((new Date(iso+'T00:00:00')-new Date(new Date().toDateString()))/864e5);
  if(days<0||days>15) return null;   // Open-Meteo 예보는 대략 16일 이내
  const k=wxKey(lat,lng,iso), c=_wx[k];
  if(c!==undefined) return c==='wait'?null:c;
  _wx[k]='wait';
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${iso}&end_date=${iso}`)
    .then(r=>r.json()).then(j=>{
      const d=j&&j.daily;
      _wx[k]=(d&&d.time&&d.time.length)? {icon:WMO[d.weather_code[0]]||'🌡', tmax:Math.round(d.temperature_2m_max[0]), tmin:Math.round(d.temperature_2m_min[0])} : null;
      clearTimeout(_wxT); _wxT=setTimeout(()=>bgRender(renderSidebar),300);
    }).catch(()=>{ _wx[k]=null; });
  return null;
}
function dayWeatherHtml(day,di){
  const first=day.spots.find(hasLoc), iso=isoDateOf(di);
  if(!first||!iso) return '';
  const w=requestWx(first.lat,first.lng,iso);
  if(!w) return '';
  return `<span class="wx" title="${esc(first.name)} 기준 예보">${w.icon} ${w.tmax}° <span style="opacity:.6">/ ${w.tmin}°</span></span>`;
}
function gmapsLink(s){ return `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}(${encodeURIComponent(s.name)})`; }
// 외부 지도 링크 — 국내는 카카오맵(한국서 실제 내비 가능), 해외는 구글
function extMapLink(s){
  return inKorea({lat:+s.lat,lng:+s.lng})
    ? {href:`https://map.kakao.com/link/to/${encodeURIComponent(s.name)},${s.lat},${s.lng}`, label:'카카오맵 길찾기 ↗'}
    : {href:gmapsLink(s), label:'Google 지도 ↗'};
}
function hasLoc(s){ return s && s.lat!=null && s.lng!=null && isFinite(+s.lat) && isFinite(+s.lng); }
// 색상 기준: 'city'(도시별) | 'day'(일자별). trip에 저장, 기본 city
function colorByMode(){ return (trip().colorBy==='city') ? 'city' : 'day'; }   // 기본 일자별 (경로 색 가독성)
function dayColor(di){ return PALETTE[di%PALETTE.length]; }
function spotColor(s,di,cityMap){ return colorByMode()==='day' ? dayColor(di) : ((cityMap||cityColors())[s.city]||'#888'); }
// 직선거리(하버사인, km) — 실제 도로거리는 아니지만 동선 감각용
function dayDistance(day, back){
  const loc=day.spots.filter(hasLoc); let sum=0;
  for(let i=1;i<loc.length;i++) sum+=haversine(loc[i-1],loc[i]);
  if(back&&loc.length) sum+=haversine(loc[loc.length-1],back);   // 숙소 복귀
  return sum;
}

// ── 구간 소요시간 (자동차) — 국내 카카오내비 · 해외 Google Routes, localStorage 캐시 ──
const LEG_KEY='tripcanvas_legs_v4';   // v4: 순수 코덱(SDK 비의존) — v3의 경로없음 오염 캐시 폐기
let legCache={};
try{ legCache=JSON.parse(localStorage.getItem(LEG_KEY))||{}; }catch(e){}
// 이동 수단 (일자별): car 자차 · transit 대중교통 · walk 도보 · bike 자전거
const MODE_ICON={car:'🚗',taxi:'🚕',transit:'🚌',train:'🚆',walk:'🚶',bike:'🚴',flight:'✈️'};
const MODE_NAME={car:'자차',taxi:'택시',transit:'대중교통',train:'기차',walk:'도보',bike:'자전거',flight:'비행기'};
const MODE_SPEED={car:40,taxi:40,transit:25,train:160,walk:4.5,bike:15,flight:700};   // km/h — 미캐시 구간 추정용. 택시는 도로(자차) 기준, 기차는 고속철 평균
function dayModeOf(day){ return MODE_ICON[day.mode]? day.mode : 'car'; }
// 구간(leg)별 이동수단: 도착 장소에 legMode가 지정돼 있으면 그걸, 없으면 일자 기본 수단.
// (예: 비행기 도착 구간만 ✈️, 그 안 이동은 일자 기본 🚶/🚕) — 지도·타임라인·재생·거리 공통.
function legModeOf(day, spot){ const m=spot&&spot.legMode; return (m&&MODE_ICON[m])? m : dayModeOf(day); }
// 항공 정보(항공편명·공항·시각) 한 줄 표기 (day.flight)
function flightHtml(day){
  const f=day.flight; if(!f) return '';
  const dep=[f.dep,f.depAt].filter(Boolean).map(esc).join(' ');
  const arr=[f.arr,f.arrAt].filter(Boolean).map(esc).join(' ');
  const route=[dep,arr].filter(Boolean).join(' → ');
  const bits=[f.code?esc(f.code):'', route].filter(Boolean);
  return bits.length ? `<div class="drive" style="color:#7cc7ff">✈️ ${bits.join(' · ')}</div>` : '';
}
function saveLegCache(){ try{ localStorage.setItem(LEG_KEY, JSON.stringify(legCache)); }catch(e){} }
function fmtDur(sec){ const m=Math.round(sec/60); return m<60? `${m}분` : `${Math.floor(m/60)}시간${m%60? ' '+(m%60)+'분':''}`; }
function legLabel(c){
  const km=(c.m/1000).toFixed(1),mode=c.mode||'car';
  if(mode==='car'&&c.m<2000){const wm=Math.max(1,Math.round(c.m/75));return `↳${km}km · 🚶${wm}분`;}
  return `↳${km}km · ${fmtDur(c.sec)}`;
}
function applyTheme(){ let theme='light'; try{ theme=localStorage.getItem(THEME_KEY)||'light'; }catch(_){} document.body.classList.toggle('theme-dark',theme==='dark'); }
function toggleTheme(){ const dark=!document.body.classList.contains('theme-dark'); document.body.classList.toggle('theme-dark',dark); try{localStorage.setItem(THEME_KEY,dark?'dark':'light');}catch(_){} }
applyTheme();
function legTitle(c){
  let t=(c.est?((c.mode==='flight'||c.mode==='train')?'직선거리 기반 추정':'자동차 경로 거리 기반 추정'):'실제 도로 기준');
  if(c.snapped)t+=' · 인근 지점에서 출발/도착 (원 지점이 도로·정류장에서 멀어 보정 — 공항 부지 중심 좌표 등)';
  if((c.mode==='car'||c.mode==='taxi')&&c.taxi)t+=` · 택시 약 ${c.taxi.toLocaleString()}원`;
  return t;
}
function legModeBtn(day,di,si,lm){
  if(si==null||si<0)return '';
  const set=!!(day.spots[si]&&day.spots[si].legMode),dmn=dayModeOf(day);
  if(viewMode)return `<span class="legModeBtn${set?' set':''}" title="${escAttr(MODE_NAME[lm])}">${MODE_ICON[lm]}</span>`;
  const t=set?`이 구간만 ${MODE_NAME[lm]} — 탭해서 변경 (계속 누르면 일정 기본으로 되돌아감)`:`일정 기본 ${MODE_NAME[dmn]} — 탭하면 이 구간만 바꿔요`;
  return `<button class="legModeBtn${set?' set':''}" onclick="event.stopPropagation();cycleLegMode(${di},${si})" title="${escAttr(t)}">${MODE_ICON[lm]}</button>`;
}
function normHM(v){
  const s=String(v||'').trim();let h,m;
  const c=/^(\d{1,2}):(\d{1,2})$/.exec(s);
  if(c){h=+c[1];m=+c[2];}
  else{const d=s.replace(/\D/g,'');if(!d)return '';if(d.length<=2){h=+d;m=0;}else if(d.length===3){h=+d.slice(0,1);m=+d.slice(1);}else{h=+d.slice(0,2);m=+d.slice(2,4);}}
  return (h>23||m>59)?'':String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}
document.addEventListener('input',e=>{const t=e.target;if(t&&t.classList&&t.classList.contains('timeIn'))t.value=t.value.replace(/[^\d:]/g,'').slice(0,5);});
document.addEventListener('blur',e=>{const t=e.target;if(t&&t.classList&&t.classList.contains('timeIn')&&t.value.trim()!=='')t.value=normHM(t.value);},true);
function planDepartISO(isoDate,localMinutes,timeZone){
  const minutes=typeof localMinutes==='number'?localMinutes:parseHM(localMinutes||'09:00');
  const iso=zonedMinutesToISOString(isoDate,minutes,timeZone||'');
  return iso&&new Date(iso).getTime()>Date.now()+60000?iso:null;
}

// 라우팅 transport는 routing.js에 격리하고 UI에는 fetchLeg 호환 shim만 제공한다.
const routingClient=TC_ROUTING.createRoutingClient({
  fetchImpl:(url,opts)=>fetch(url,opts), googleKey:GMAPS_KEY, encodePolyline, ringPts, haversine, inKorea
});
function setSheetSnap(snap){
  const sb=document.getElementById('sidebar'); if(!sb) return;
  sb.style.height=''; sb.dataset.snap=snap;
}
(function initMobileSheet(){
  const sb=document.getElementById('sidebar'); let drag=null,moved=false;
  sb.addEventListener('pointerdown',e=>{
    if(!e.target.closest('#sheetHandle')||!matchMedia('(max-width:760px)').matches) return;
    drag={y:e.clientY,h:sb.getBoundingClientRect().height}; moved=false; sb.classList.add('dragging'); e.preventDefault();
  });
  window.addEventListener('pointermove',e=>{
    if(!drag) return; const h=Math.max(innerHeight*.15,Math.min(innerHeight*.9,drag.h+drag.y-e.clientY));
    if(Math.abs(e.clientY-drag.y)>4)moved=true; sb.style.height=h+'px';
  });
  window.addEventListener('pointerup',()=>{
    if(!drag)return; const ratio=sb.getBoundingClientRect().height/innerHeight; drag=null; sb.classList.remove('dragging');
    setSheetSnap(ratio<.3?'collapsed':ratio<.68?'half':'expanded');
  });
  sb.addEventListener('click',e=>{
    if(e.target.closest('#sheetHandle')&&!moved){ setSheetSnap(sb.dataset.snap==='collapsed'?'half':sb.dataset.snap==='half'?'expanded':'collapsed'); }
    else if(sb.dataset.snap==='collapsed'&&e.target.closest('.dayCard')) setSheetSnap('half');
  });
  ['map','kmap'].forEach(id=>document.getElementById(id).addEventListener('pointerdown',()=>setSheetSnap('collapsed'),true));
})();
const fetchLeg=routingClient.fetchLeg;   // 기존 전역 호출부 호환 shim — UI는 transport 세부사항을 모름
function decodePts(enc){ return enc?decodePolyline(enc):null; }
// 캐시에 있으면 즉시 반환, 없으면 큐에 넣고 null (완료 시 DOM 패치 + 사이드바 갱신)
let legQueue=[], legBusy=false, legRefreshT=null;
const transitQuerySeen=new Map();
function legRequestKey(a,b,mode,when,timeZone){
  const base=legKey(a,b,mode);
  return mode==='transit'&&when?`${base}@${timeZone||'UTC'}@${when}`:base;
}
function requestLeg(a,b,mode,when,timeZone){
  mode=MODE_ICON[mode]?mode:'car';
  const base=legKey(a,b,mode), key=legRequestKey(a,b,mode,when,timeZone);
  const c=legCache[key];
  // 경로 없이 캐시된 항목(과거 레이스 오염) 자가 치유 → 재조회. 단 est(비행기·기차 등 추정)는 원래 경로가 없음
  if(c && c.sec && !c.path && !c.est){ delete legCache[key]; }
  else if(c){
    return c.sec?c:null;                                // 시각별 key라 다른 시간대/출발시각 결과와 충돌하지 않음
  }
  if(mode==='transit'&&when){
    const group=`${base}@${timeZone||'UTC'}@${when.slice(0,10)}`;
    const seen=transitQuerySeen.get(group)||new Set();
    if(!seen.has(key)&&seen.size>=6) return legCache[base]&&legCache[base].sec?legCache[base]:null;
    seen.add(key); transitQuerySeen.set(group,seen);          // 비동기 ETA 재계산이 진동해도 구간당 무한 재조회 방지
  }
  if(!legQueue.find(q=>q.key===key)){ legQueue.push({key,base,mode,when,timeZone,a:{lat:+a.lat,lng:+a.lng},b:{lat:+b.lat,lng:+b.lng}}); pumpLegs(); }
  const previous=legCache[base];
  return previous&&previous.sec?previous:null;           // 새 시각 조회 중에도 직전 경로는 표시만 유지
}
async function pumpLegs(){
  if(legBusy) return; legBusy=true;
  // 인코딩은 순수 JS(lib.js)라 SDK 대기 불필요
  while(legQueue.length){
    const {key,base,mode,a,b,when,timeZone}=legQueue.shift();
    if(legCache[key]) continue;
    let r=null;
    try{ r=await fetchLeg(a,b,mode,when); }catch(e){}
    if(r && mode==='transit' && when){ r.when=when; r.timeZone=timeZone||''; }
    legCache[key] = r || {fail:Date.now()};
    if(r){
      legCache[base]=r;                                  // 지도·재생은 가장 최근 실제 경로를 사용
      saveLegCache();
      document.querySelectorAll(`[data-leg="${key}"]`).forEach(el=>{
        el.textContent=legLabel(r);
        el.title=legTitle(r);
      });
      document.querySelectorAll(`[data-ileg="${key}"]`).forEach(el=>{   // 수단 아이콘은 옆의 버튼이 표시
        el.textContent=`이전 일정에서 ${(r.m/1000).toFixed(1)}km · ${fmtDur(r.sec)}`;
      });
      clearTimeout(legRefreshT);
      legRefreshT=setTimeout(()=>bgRender(render),450);   // 하루 합계 + 지도 경로선 갱신
    }
  }
  legBusy=false;
}
// ── 타임라인 (도착 예상시각) ──
// 구간 이동시간(분): 캐시된 경로 우선(자차 2km 미만은 도보 대안), 없으면 수단별 속도로 직선 추정
function legMinutes(a,b,mode,when,timeZone){
  mode=MODE_ICON[mode]?mode:'car';
  const c=legCache[legRequestKey(a,b,mode,when,timeZone)];
  if(c&&c.sec) return (mode==='car'&&c.m<2000)? c.m/75 : c.sec/60;
  return haversine(a,b)/MODE_SPEED[mode]*60;
}
// 일자 타임라인: 시작시각(startAt, 기본 09:00)부터 체류(stayMin, 기본 60분)+이동 누적.
// 순수 계산은 lib.js computeTimeline. startAnchor(전날 숙소 등)가 있으면 첫 유효 장소까지 이동시간을 먼저 더한다.
function dayTimeZone(day){ return (day&&day.timeZone)||trip().timeZone||''; }
function dayTimeline(day, startAnchor, di){
  const index=di!=null?di:trip().days.indexOf(day), iso=index>=0?isoDateOf(index):'', timeZone=dayTimeZone(day);
  return computeTimeline(day,{legMin:(a,b,context)=>{
    const mode=legModeOf(day,b), when=mode==='transit'?planDepartISO(iso,context.depart,timeZone):null;
    return legMinutes(a,b,mode,when,timeZone);
  },startAnchor});
}
function dayEtas(day, startAnchor, di){ return dayTimeline(day,startAnchor,di).map(x=>x.eta); }
function legDepartMinute(day,timeline,spotIndex){
  if(spotIndex<=0) return parseHM(day.startAt);
  const prev=day.spots[spotIndex-1], state=timeline[spotIndex-1];
  return state.eta+(state.wait||0)+(prev.stayMin!=null?+prev.stayMin:60);
}
// 도착시각 순으로 정렬. 고정 시각 장소는 그 시각으로 이동, 자동 시각 장소는 '직전 고정 시각'에
// 묶여 원래 상대순서를 유지(자동끼리 뒤섞이지 않음). 안정 정렬. 순서가 바뀌면 true.
function sortDayByTime(day){
  const before=day.spots.slice();
  let anchor=parseHM(day.startAt);
  const key=day.spots.map(s=>{ if(s.at) anchor=parseHM(s.at); return anchor; });   // 각 스팟의 기준 시각
  const order=day.spots.map((_,i)=>i).sort((a,b)=> (key[a]-key[b]) || (a-b));       // 동시각은 원래 순서 유지
  day.spots=order.map(i=>day.spots[i]);
  return before.some((s,i)=>s!==day.spots[i]);
}
// 하루 장소 비용 합계
// ── 통화·환율 (원/달러/엔/위안 → 원 환산) ──
const CUR = { KRW:{sym:'₩',name:'원'}, USD:{sym:'$',name:'달러'}, EUR:{sym:'€',name:'유로'}, JPY:{sym:'¥',name:'엔'}, CNY:{sym:'元',name:'위안'} };
const FX_KEY='tripcanvas_fx';
let fxRates = { KRW:1, USD:1380, EUR:1500, JPY:9.1, CNY:192 };   // 통화 1단위 = ? 원. 네트워크 실패 시 폴백(근사)
function toKRW(amount, cur){ return Math.round((+amount||0) * (fxRates[cur||'KRW']||1)); }
function fmtMoney(n){ return Math.round(+n||0).toLocaleString('en-US'); }
// 원본+환산 표기: KRW면 "68,000원", 아니면 "$50 ≈ 68,000원"
function costLabel(amount, cur){
  cur=cur||'KRW';
  const cu=CUR[cur];   // 외부 유입 데이터가 알 수 없는 통화(예: GBP)면 KRW로 폴백 — 렌더 크래시 방지
  return (!cu || cur==='KRW') ? `₩${fmtMoney(amount)}` : `${cu.sym}${fmtMoney(amount)} ≈ ₩${fmtMoney(toKRW(amount,cur))}`;
}
// 환율 로드: localStorage 캐시(하루 1회 갱신), open.er-api.com에서 USD 기준 시세 → 원 환산율 계산
function loadFx(){
  let cachedDay=null, cached=null;
  // 캐시는 기본값 '위에 덮어쓰기'(통째 교체 X) — 통화가 추가되면 옛 캐시에 없는 통화가 undefined가 돼 환산이 1:1로 깨진다
  try{ const c=JSON.parse(localStorage.getItem(FX_KEY)); if(c&&c.rates){ cached=c.rates; fxRates=Object.assign({}, fxRates, c.rates); cachedDay=c.day; } }catch(e){}
  const today=new Date().toISOString().slice(0,10);
  const complete = cached && Object.keys(CUR).every(k=>cached[k]);   // 새로 추가된 통화가 빠진 옛 캐시면 오늘치여도 다시 받는다
  if(cachedDay===today && complete) return;   // 오늘 이미 갱신됨
  fetch('https://open.er-api.com/v6/latest/USD').then(r=>r.json()).then(j=>{
    const R=j&&j.rates;
    if(j&&j.result==='success'&&R&&R.KRW&&R.JPY&&R.CNY&&R.EUR){
      fxRates={ KRW:1, USD:R.KRW, EUR:R.KRW/R.EUR, JPY:R.KRW/R.JPY, CNY:R.KRW/R.CNY };
      try{ localStorage.setItem(FX_KEY, JSON.stringify({day:today, rates:fxRates})); }catch(e){}
      bgRender(render);   // 환산액 갱신
    }
  }).catch(()=>{});   // 실패 시 폴백/캐시 유지
}
function dayCost(day){ return day.spots.reduce((a,s)=>a+(s.cost? toKRW(s.cost,s.cur):0),0); }
// 그 날짜에 배분된 예약비(숙박·렌터카·항공 하루치) — 원화 환산 합계
function dayBookingCost(iso){
  return bookingShareOn(tripBookings(), iso).reduce((a,x)=>a+toKRW(x.amount,x.cur),0);
}
function dayTaxiCost(day,di){
  const m=dayModeOf(day);
  return (m==='car'||m==='taxi')? ((dayRoute(day,backLegOf(day,di,dayReturnStay(trip().days,di)))||{}).taxi||0) : 0;
}
// 여행 전체 비용 — 장소 + 자차일 택시 + 예약 '전액'.
// 하루 비용은 예약을 날수로 나눈 몫이라, 예약 기간이 여행 일정 밖으로 나가면 하루 합계보다 전체가 크다(전체가 실제 총액).
function tripCostBreakdown(){
  const out={spots:0, taxi:0, hotel:0, car:0, flight:0, total:0};
  trip().days.forEach((d,i)=>{ out.spots+=dayCost(d); out.taxi+=dayTaxiCost(d,i); });
  tripBookings().forEach(b=>{
    const k=(b.type==='car'||b.type==='flight')? b.type : 'hotel';
    out[k]+=toKRW(+b.price||0, b.cur);
  });
  out.total=out.spots+out.taxi+out.hotel+out.car+out.flight;
  return out;
}
function tripCost(){ return tripCostBreakdown().total; }
// 일정 예상 종료 시각(분) — 마지막 장소 (예약 대기 반영한) 활동 시작 + 체류
function dayEndMin(day, startAnchor, bl){
  if(!day.spots.length) return null;
  const etas=dayEtas(day, startAnchor), last=day.spots.length-1, s=day.spots[last];
  const base = s.bookAt ? Math.max(etas[last], parseHM(s.bookAt)) : etas[last];
  const end = base + (s.stayMin!=null? +s.stayMin : 60);
  // 숙소로 돌아가는 시간까지 넣어야 '하루가 몇 시에 끝나는지'가 맞는다
  return bl ? end + legMinutes(bl.from, bl.to, bl.mode, bl.when, bl.timeZone) : end;
}
// 하루 전체 실도로 합계 (모든 구간이 캐시됐을 때만)
function dayRoute(day, bl){
  const loc=day.spots.filter(hasLoc);
  if(loc.length<2) return null;
  let sec=0,m=0,taxi=0;
  for(let i=1;i<loc.length;i++){
    const c=legCache[legKey(loc[i-1],loc[i],legModeOf(day,loc[i]))];
    if(!c||!c.sec) return null;
    sec+=c.sec; m+=c.m; taxi+=(c.taxi||0);
  }
  if(bl){   // 숙소 복귀 구간 — 아직 조회 중이면 하루 합계를 내지 않는다(부분 합계로 오해 방지)
    const c=legCache[bl.key];
    if(!c||!c.sec) return null;
    sec+=c.sec; m+=c.m; taxi+=(c.taxi||0);
  }
  return {sec,m,taxi};
}

// 목록·여행 모드·이미지에서 이름 앞에 붙일 카테고리 아이콘 (미지정이면 빈 문자열)
function catPrefix(s){ const c=spotCatOf(s); return c? c.icon+' ' : ''; }
// 카테고리 선택지는 SPOT_CATS 하나만 보고 만든다 (HTML에 중복 정의하지 않게)
(function(){ const sel=document.getElementById('spotCat'); if(!sel) return;
  sel.innerHTML='<option value="">미지정 (이름으로 자동 추측)</option>'
    + SPOT_CATS.map(c=>`<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
})();
// 마커 하나 추가 (엔진 공용) — markers에 {spot, open} 인터페이스로 저장. 숙소는 🏠 핀
function addPin(s,di,si,c){
  const cat=spotCatOf(s);
  const label=si+1;
  const html=`<h3>${cat?cat.icon+' ':''}${esc(s.name)}</h3><span class="badge" style="background:${c}">Day ${di+1} · ${dateOf(di)}</span>`+
    `<div>${esc(s.desc).replace(/\n/g,'<br>')}</div>`+
    `<div style="margin-top:6px"><a href="${escAttr(extMapLink(s).href)}" target="_blank" rel="noopener">${extMapLink(s).label}</a> &nbsp; `+
    `<a href="#" onclick="openSpotModal(${di},${si});return false;">✎ 편집</a></div>`;
  const pin=mkPin(c,label,s.opt,cat); pin.title=cat?`${cat.icon} ${cat.name} · ${s.name}`:s.name;
  const h=ME().marker(+s.lat,+s.lng,pin,()=>open());
  const open=()=>{ ME().openPopup(html, +s.lat, +s.lng, h); setSheetSnap('half'); selectSpotCard(di,si); };
  markers.push({spot:s, open, h});
}
// 그날 목록엔 없지만 동선이 닿는 숙소(연박 등) — 클릭 대상이 아닌 옅은 표식
function addGhostStay(s,color){
  const el=document.createElement('div');
  el.className='ghostStay'; el.textContent='🏠'; el.title=s.name;
  el.style.borderColor=color;
  ghostStays.push({h:ME().overlay(+s.lat,+s.lng,el)});
}
// 동선 라인 추가 (엔진 공용). dashed=일자 간 연결선
function addLine(pts,color,opacity,dashed){
  lines.push({h:ME().polyline(pts,{color,opacity,dashed})});
}
// 경로 중간의 소요시간 칩 (Day 보기 전용)
let legChips=[];
function addLegChip(pos,text){
  const el=document.createElement('div'); el.className='legChip'; el.textContent=text;
  legChips.push({h:ME().overlay(pos.lat,pos.lng,el)});
}
function clearOverlays(){
  markers.forEach(m=>m.h.remove()); markers=[];
  lines.forEach(l=>l.h.remove()); lines=[];
  ghostStays.forEach(g=>g.h.remove()); ghostStays=[];
  legChips.forEach(c=>c.h.remove()); legChips=[];
  if(iw) iw.close(); closeKPopup();   // 엔진 전환 대비 양쪽 팝업 닫기
}
// 오버레이 입력 시그니처 — 같으면 마커/라인 재생성 생략 (텍스트 편집 등에서 깜빡임·비용 제거)
let _ovSig='';
function overlaySig(t,colors){
  const p=[engine, activeDay, colorByMode()];
  t.days.forEach((day,di)=>{
    if(activeDay && di+1!==activeDay) return;
    p.push(dayModeOf(day));
    day.spots.forEach((s,si)=>{ if(hasLoc(s)) p.push(si,s.lat,s.lng,s.stay?1:0,s.opt?1:0,(s.cat||''),(s.legMode||''),spotColor(s,di,colors),esc(s.name),esc(s.desc||'')); });
    const loc=day.spots.filter(hasLoc);
    for(let i=1;i<loc.length;i++){ const c=legCache[legKey(loc[i-1],loc[i],legModeOf(day,loc[i]))]; p.push(c? (c.sec?(c.path?'p':'s'):'f') : 'n'); }
    const bl=backLegOf(day,di,dayReturnStay(t.days,di));   // 숙소 복귀 — 경로가 도착하면 다시 그려야 한다
    if(bl){ const c=legCache[bl.key]; p.push('B', c? (c.sec?(c.path?'p':'s'):'f') : 'n'); }
  });
  if(!activeDay){
    t.days.forEach((day,di)=>{ const loc=day.spots.filter(hasLoc); if(!loc.length)return;
      const from=startAnchorFor(di);
      if(from){ const c=legCache[legKey(from,loc[0],legModeOf(day,loc[0]))]; p.push('I', c? (c.sec?(c.path?'p':'s'):'f') : 'n'); } });
  }
  return p.join('|');
}
function render(){
  const t = trip(), colors = cityColors();
  // 엔진 결정: 국내 여행이면 카카오 (SDK 미준비 시 준비 후 재렌더, 그동안 구글로)
  const want=desiredEngine();
  if(want==='kakao' && !kmap){ ensureKakaoMap().then(ok=>{ if(ok) render(); }); }
  const eng=(want==='kakao' && kmap)?'kakao':'google';
  setEngine(eng);
  const mapReady = ME().ready();
  const sig = mapReady? overlaySig(t,colors) : null;
  if(mapReady && sig!==_ovSig){
    _ovSig=sig;
    clearOverlays();
    t.days.forEach((day,di)=>{
      if(activeDay && di+1!==activeDay) return;
      day.spots.forEach((s,si)=>{
        if(!hasLoc(s)) return;               // 좌표 미지정 장소는 핀 생략 (카드엔 남음)
        addPin(s,di,si,spotColor(s,di,colors));
      });
      // 일자 내 동선 — 실경로 우선. 조회 중(미캐시)엔 그리지 않고,
      // 결과가 나온 뒤에도 경로가 없는 구간(실패)만 직선으로 채움 → 직선→실경로 깜빡임 제거
      const locSpots = day.spots.filter(hasLoc);
      const lc=dayColor(di), lop=activeDay?0.9:0.7;   // 경로선은 색 모드와 무관하게 항상 일자 색 (핀·카드는 도시별/일자별 따름). 전체 보기도 또렷하게(0.7)
      for(let i=1;i<locSpots.length;i++){
        const A=locSpots[i-1], B=locSpots[i], lm=legModeOf(day,B);   // 구간별 수단(도착 장소 기준)
        const cch=legCache[legKey(A,B,lm)];
        if(!cch) continue;   // 조회 중 — 선 없이 대기 (완료 시 디바운스 재렌더로 채워짐)
        const path=(cch.sec&&cch.path)?decodePts(cch.path):null;
        addLine(path||[{lat:+A.lat,lng:+A.lng},{lat:+B.lat,lng:+B.lng}], lc, lop, false);
        // Day 보기에선 경로 중간에 소요시간 칩
        if(activeDay && cch.sec){
          const mid = path? path[Math.floor(path.length/2)]
                          : {lat:(+A.lat + +B.lat)/2, lng:(+A.lng + +B.lng)/2};
          addLegChip(mid, (lm==='car'&&cch.m<2000)? `🚶${Math.max(1,Math.round(cch.m/75))}분` : `${MODE_ICON[lm]}${fmtDur(cch.sec)}`);
        }
      }
      // 숙소 복귀 — 자동으로 이어 붙인 구간이라 점선으로 구분한다
      const bl=backLegOf(day,di,dayReturnStay(t.days,di));
      if(bl){
        const bch=legCache[bl.key];
        if(bch){
          const bpath=(bch.sec&&bch.path)?decodePts(bch.path):null;
          addLine(bpath||[{lat:+bl.from.lat,lng:+bl.from.lng},{lat:+bl.to.lat,lng:+bl.to.lng}], lc, lop*.85, true);
        }
        // 연박처럼 그날 목록엔 없는 숙소면 선 끝이 빈 곳이 되지 않게 옅은 🏠를 둔다
        if(locSpots.indexOf(bl.to)<0) addGhostStay(bl.to, lc);
      }
    });
    // 일자 간 연결 (전체 보기) — 점선. 색은 도착 일자 색(나머지 선과 동일 체계). 조회 중엔 미표시
    if(!activeDay){
      t.days.forEach((day,di)=>{
        const loc = day.spots.filter(hasLoc);
        if(!loc.length) return;
        const from=startAnchorFor(di);   // 정책 반영 이월 시작점 (none이면 null → 연결선 없음)
        if(from){
          const cch=legCache[legKey(from,loc[0],legModeOf(day,loc[0]))];
          if(cch){
            const path=(cch.sec&&cch.path)?decodePts(cch.path):null;
            addLine(path||[{lat:+from.lat,lng:+from.lng},{lat:+loc[0].lat,lng:+loc[0].lng}], dayColor(di), .8, true);
          }
        }
      });
    }
  }
  renderSidebar(); renderFilter(); renderLegend();
  document.getElementById('tripSel').innerHTML = viewMode
    ? `<option selected>👀 ${esc(viewMode.name)}</option>`
    : store.trips.map(x=>`<option value="${escAttr(x.id)}" ${x.id===store.activeId?'selected':''}>${esc(x.name)}</option>`).join('');
  const picker=document.getElementById('tripPickerName');
  if(picker) picker.textContent=(viewMode?'👀 ':((t.sample||t.id==='spain2026')?'샘플 · ':''))+(t.name||'여행 선택');
  save();
}
// pts([[lat,lng],…])에 맞춰 프레이밍. maxZoom(구글 기준)은 정착 후 보정
function fitTo(pts,pad,maxZoom){
  if(!pts.length || !ME().ready()) return;
  ME().fit(pts, pad, maxZoom);
}
// 여행 진입 시 포커스: 위치 있는 첫 일자 지역 (없으면 전체)
function fitEntry(){
  const d=trip().days.find(d=>d.spots.some(hasLoc));
  if(d){ fitTo(d.spots.filter(hasLoc).map(s=>[s.lat,s.lng]),64,15); }
  else fitAll();
}
function fitAll(){
  const pts=[]; trip().days.forEach(d=>d.spots.forEach(s=>{if(hasLoc(s))pts.push([s.lat,s.lng])}));
  fitTo(pts,60);
}
// ───────────────── 여행 재생 애니메이션 (재미) ─────────────────
// 전체 동선을 하나의 좌표열로 펼친 뒤(구간별 실경로 우선, 없으면 직선) 이동수단 아이콘을 따라 이동시킴.
let animMarker=null, animRAF=null, animEndT=null, animWaiting=false, playSeq=0;
let playSpeed=1, _playDi=-1;   // 재생 배속(0.5/1/2×) · 현재 재생 중인 일자(날짜 카드 전환 감지)
let play=null;                  // 재생 세션 핸들(없으면 미재생) — pause/resume/seek 등 컨트롤 노출
const PLAY_ZOOM_IN=13, PLAY_ZOOM_OUT=9;   // 재생 중 도시 내(줌인)·도시 간(줌아웃) 레벨
const PLAY_TILE_TIMEOUT=3500, PLAY_SETTLE=400;   // 타일 로딩 최대 대기(ms)·로딩 후 정착 지연(ms) — 깔끔한 출발 우선
// dayAnchor(day)·dayStartAnchor(days,di)는 lib.js(순수·테스트 대상)에 있음.
// startAnchorFor(di): di일이 이월받는 출발 앵커(정책 반영, startPolicy==='none'이면 null).
// 지도 일자 간 점선·재생·사이드바 거리·타임라인·여행 모드가 모두 이 한 함수를 공유한다.
function startAnchorFor(di){ return dayStartAnchor(trip().days, di); }
// 렌터카 픽업·반납 항목 — 예약(trip.bookings)에서 파생해 그날 일정에 끼워 넣는다.
// 픽업·반납 장소는 자유 텍스트(좌표 없음)라 동선·ETA·앵커에는 넣지 않는다 — '언제 어디서'만 알려주는 표시 항목.
// 픽업·반납 지점 표기 — 장소와 공항코드는 한 쌍(carReturnPoint)이라 있는 것만 붙인다
function carEventPlaceLabel(e){
  if(e.place && e.code) return `${e.place} (${e.code})`;
  return e.place || e.code || e.title || '';
}
function carEventRowHtml(e){
  const label = e.kind==='pickup' ? '렌터카 픽업' : '렌터카 반납';
  const place = carEventPlaceLabel(e)||label;
  const tip = `${label}${e.time?` ${e.time}`:''} · ${place}${(e.place||e.code)?'':' — 예약에 픽업·반납 장소를 넣으면 여기 표시됩니다'} · 예약에 입력한 정보라 동선·도착 예상 계산에는 들어가지 않습니다`;
  const name = viewMode
    ? `<span class="spotIdentity nm"><span class="spotName">${esc(place)}</span></span>`
    : `<button type="button" class="spotIdentity nm" onclick="openBookingModal('${escAttr(e.id)}')" aria-label="${escAttr(`${label} · ${place} · 예약 상세 열기`)}"><span class="spotName">${esc(place)}</span></button>`;
  // 시각은 ETA 칸에 넣지 않는다 — 그 칸은 '이 날 계산된 도착 예상 순서'를 뜻하는데 이 항목은 그 순서에 속하지 않는다
  const sub = [label, e.time?esc(e.time):'', (e.place||e.code)?'':'장소 미입력'].filter(Boolean).join(' · ');
  return `<div class="spot carbk" style="--c:#7a86ad" title="${escAttr(tip)}">
    <div class="spotMain"><span class="spotTime eta">🚗</span>${name}<span class="spotMenuSpacer" aria-hidden="true"></span></div>
    <div class="spotMeta"><span class="spotMetaItem opt">${sub} · 예약</span></div>
  </div>`;
}
// 숙소 복귀 구간 서술자 — 데이터에 없는 합성 구간이라 '일자 기본 수단'으로 본다.
// (도착 장소의 legMode는 '그 장소로 오는' 구간용이라 복귀에 빌려 쓰면 틀린다)
// 출발시각은 복귀를 뺀 그날 종료시각 = dayEndMin(day, anchor) — 여기서만 back 없이 불러 순환을 막는다.
function backLegOf(day, di, back){
  const loc=day.spots.filter(hasLoc);
  if(!back || !loc.length) return null;
  const from=loc[loc.length-1], mode=localMode(dayModeOf(day)), timeZone=dayTimeZone(day);
  const when = mode==='transit'
    ? planDepartISO(di>=0?isoDateOf(di):'', dayEndMin(day, startAnchorFor(di)), timeZone)
    : null;
  return {from, to:back, mode, when, timeZone, key:legRequestKey(from,back,mode,when,timeZone)};
}
// 시각적 🏠 '전날 숙소' 이월 항목용 — 시작 앵커가 숙소(stay)일 때만.
function carryStayFor(di){ const a=startAnchorFor(di); return (a&&a.stay)?a:null; }
// 일자 컨텍스트(한 번에 계산) — 사이드바·여행모드·이미지·재생이 공유해 anchor/carry 혼동 방지.
// ETA·종료·이미지·여행모드 타임라인은 anchor(전날 숙소 또는 마지막 장소, 정책 반영)를 쓰고,
// 화면의 🏠 '전날 숙소' 항목 표시에만 carry(숙소일 때만)를 쓴다.
function dayContext(di){
  const day=trip().days[di], anchor=startAnchorFor(di), back=dayReturnStay(trip().days,di);
  return { day, anchor, carry:(anchor&&anchor.stay)?anchor:null, back, backLeg:backLegOf(day,di,back),
           timeline:dayTimeline(day,anchor,di), mode:dayModeOf(day), timeZone:dayTimeZone(day) };
}
function animPath(){
  const flat=[]; const days=trip().days;
  // 일자 필터 중이면 해당 일자만, 아니면 전체. 각 일자의 이월 시작점은 startAnchorFor(정책 반영, none이면 없음).
  const range = activeDay ? [activeDay-1] : days.map((_,i)=>i);
  range.forEach((di)=>{
    const day=days[di]; const loc=day.spots.filter(hasLoc); if(!loc.length) return;
    const pushSeg=(A,B)=>{
      const dm=legModeOf(day,B);                       // 구간별 수단(도착 장소 기준)
      const c=legCache[legKey(A,B,dm)];
      const pts=(c&&c.sec&&c.path)?decodePts(c.path):[{lat:+A.lat,lng:+A.lng},{lat:+B.lat,lng:+B.lng}];
      // 도시 간이면 줌아웃, 도시 내면 줌인. 이름만으론 오판(인근 산·명소가 지자체명이 다름) → 거리도 함께 본다.
      // 이름이 다르면서 충분히 멀 때(15km↑)만 도시 간. 이름이 없으면 거리(25km)로. → 인근 명소 줌아웃/정지 남발 방지.
      const ca=(A.city||'').trim(), cb=(B.city||'').trim(), dist=haversine(A,B);
      const inter = (ca&&cb)? (ca!==cb && dist>15) : dist>25;
      const zoom = inter? PLAY_ZOOM_OUT : PLAY_ZOOM_IN;
      // 각 점에 구간 메타(from/to/mode/소요/일자)를 실어 재생 HUD(현재 구간·날짜 카드)에서 사용.
      const from=A.name||'출발', to=B.name||'도착', sec=(c&&c.sec)?c.sec:null;
      pts.forEach(p=>flat.push({lat:+p.lat,lng:+p.lng,mode:dm,zoom,di,from,to,sec}));
    };
    const anchor=startAnchorFor(di);               // 정책 반영 이월 시작점 (none이면 null, 빈날 건너뜀)
    if(anchor) pushSeg(anchor,loc[0]);             // 이월 숙소/이전 위치 → 오늘 첫 장소
    for(let i=1;i<loc.length;i++) pushSeg(loc[i-1],loc[i]);
  });
  return flat;
}
function updatePlayBtn(){ const b=document.getElementById('playBtn'); if(b) b.textContent=play?'⏹ 정지':'▶️ 재생'; }
function updatePlayPauseBtn(){ const b=document.getElementById('playPause'); if(b) b.textContent=(play&&play.paused())?'▶':'⏸'; }
function updatePlaySegInfo(){ const el=document.getElementById('playSegInfo'); if(el&&play) el.textContent=(play.getLegIndex()+1)+' / '+play.legStarts.length; }
// 재생 HUD: 현재 구간(from→to · 소요) + 전체 재생 시 날짜 전환 카드
function updatePlayHud(A){
  const leg=document.getElementById('playLeg');
  if(leg) leg.textContent = A.from+' → '+A.to + (A.sec!=null? ' · '+MODE_ICON[A.mode]+' '+fmtDur(A.sec) : '');
  if(!activeDay && A.di!==_playDi){                    // 전체 재생 중 날짜가 바뀌면 카드 플래시
    _playDi=A.di; const day=trip().days[A.di];
    if(day){
      const sub=day.title || (day.spots.find(hasLoc)||{}).city || '';
      const card=document.getElementById('playDayCard');
      if(card){ card.textContent='Day '+(A.di+1)+(sub?' · '+sub:''); card.classList.remove('show'); void card.offsetWidth; card.classList.add('show');
        clearTimeout(card._t); card._t=setTimeout(()=>card.classList.remove('show'),1900); }
    }
  }
}
function updatePlayProgress(frac){ const f=document.getElementById('playBarFill'); if(f) f.style.width=(Math.max(0,Math.min(1,frac))*100).toFixed(1)+'%'; }
function resetPlayHud(){
  _playDi=-1;
  const f=document.getElementById('playBarFill'); if(f) f.style.width='0%';
  const leg=document.getElementById('playLeg'); if(leg) leg.textContent='';
  const si=document.getElementById('playSegInfo'); if(si) si.textContent='';
  const card=document.getElementById('playDayCard'); if(card){ clearTimeout(card._t); card.classList.remove('show'); }
}
// 배속 버튼 (0.5×/1×/2×)
(function(){ const sp=document.getElementById('playSpeeds'); if(!sp) return;
  sp.addEventListener('click',e=>{ const b=e.target.closest('button[data-sp]'); if(!b) return;
    playSpeed=+b.dataset.sp; sp.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); });
})();
// 백그라운드(탭 숨김) 전환 시 자동 '일시정지'(정지 아님) — 위치 보존, 복귀 후 직접 이어보기
document.addEventListener('visibilitychange',()=>{ if(document.hidden && play && !play.paused()) play.pause(); });
// 🚗는 측면뷰(수평 옆모습)라 회전/기울이면 '눕거나 서 보인다'. → 회전 없이 진행 방향의
// 동/서 성분으로 좌우만 뒤집어(scaleX) 항상 똑바로 선 수평 자동차를 유지한다.
// 순수 남북 이동(ex≈0)에선 방향이 애매하므로 직전 좌우를 그대로 유지(깜빡 뒤집힘 방지).
let _carFaceEast=false;
function headingTransform(A,B){
  const ex=B.lng-A.lng, ny=B.lat-A.lat;
  if(!ex && !ny) return null;
  if(Math.abs(ex) > 1e-7) _carFaceEast = ex>0;          // 동/서 성분이 있을 때만 방향 갱신
  return `scaleX(${_carFaceEast?-1:1})`;                 // 회전 없음 — 항상 수평·똑바로
}
function stopPlay(){
  playSeq++;                                         // 대기 중이던 타일 로딩 재개 무효화
  play=null;                                         // 세션 종료
  if(animRAF) cancelAnimationFrame(animRAF); animRAF=null; animWaiting=false;
  if(animEndT){ clearTimeout(animEndT); animEndT=null; }
  if(animMarker){ animMarker.remove(); animMarker=null; }
  if(document.body.classList.contains('playing')){ document.body.classList.remove('playing'); if(ME().ready()) ME().relayout(); }
  resetPlayHud();
  updatePlayBtn(); updatePlayPauseBtn();
}
// 탐색(seek) 순수 계산 — jsdom 테스트 대상
/** frac(0~1) → phase 인덱스·누적거리·구간내 경과ms */
function playSeekTarget(phases, gtotal, frac){
  const d=Math.max(0,Math.min(1,frac))*gtotal;
  let pi=0; while(pi<phases.length-1 && d>phases[pi].b+1e-6) pi++;
  const ph=phases[pi]; return {pIdx:pi, d, elapsed:((d-ph.a)/((ph.b-ph.a)||1))*ph.dur};
}
/** 누적거리 d가 속한 leg(구간) 인덱스 */
function playLegIndexAt(legStarts, d){ let i=0; while(i<legStarts.length-1 && d>=legStarts[i+1]-1e-6) i++; return i; }
// 재생 HUD 컨트롤 배선 (일시정지·이전/다음 구간·진행바 드래그 탐색)
(function(){
  const pp=document.getElementById('playPause'); if(pp) pp.onclick=()=>{ if(play) play.toggle(); };
  const pv=document.getElementById('playPrev'); if(pv) pv.onclick=()=>{ if(play) play.prevSeg(); };
  const nx=document.getElementById('playNext'); if(nx) nx.onclick=()=>{ if(play) play.nextSeg(); };
  const bar=document.getElementById('playBar'); if(!bar) return;
  const frac=e=>{ const r=bar.getBoundingClientRect(); return (e.clientX-r.left)/(r.width||1); };
  let dragging=false, wasPlaying=false;
  bar.addEventListener('pointerdown',e=>{ if(!play) return; dragging=true; try{bar.setPointerCapture(e.pointerId);}catch(_e){} wasPlaying=!play.paused(); if(wasPlaying) play.pause(); play.seekPreview(frac(e)); e.preventDefault(); });
  bar.addEventListener('pointermove',e=>{ if(dragging&&play) play.seekPreview(frac(e)); });
  const end=()=>{ if(!dragging) return; dragging=false; if(play){ play.seekCommit(); if(wasPlaying) play.resume(); } };
  bar.addEventListener('pointerup',end); bar.addEventListener('pointercancel',end);
})();
function playTrip(){
  if(play){ stopPlay(); return; }                   // 토글: 재생/일시정지 중이면 정지
  stopPlay();                                       // 종료 직후 남은 타이머·마커 정리
  const myseq=playSeq;                              // 이 재생 세션 식별(대기 재개 유효성 검사용)
  if(!ME().ready()){ toast('지도를 불러오는 중이에요','#8892b0'); return; }
  const flat=animPath();
  if(flat.length<2){ toast('재생할 동선이 없어요','#8892b0'); return; }
  // 위치는 실거리 누적(gcum)으로 보간. 카메라가 '구간마다 고정'이라 페이싱은 팔로우-카메라용
  // 줌가중(2^zoom)이 아니라 '구간별 소요시간'으로 잡는다 — 안 그러면 도로 점이 많은 도시간
  // 구간이 일자별 재생에서 과도하게 느려진다(점 수 기반 dur + 낮은 픽셀가중의 불일치).
  const gcum=[0];                                   // 실거리 누적(위치 보간용)
  for(let i=1;i<flat.length;i++) gcum[i]=gcum[i-1]+haversine(flat[i-1],flat[i]);
  const gtotal=gcum[gcum.length-1]||1;
  document.body.classList.add('playing');           // 사이드바 접어 지도를 크게
  ME().relayout();                                   // 시작 카메라는 아래 enterPhase(첫 구간 fit)가 잡음
  const el=document.createElement('div'); el.style.cssText='will-change:transform';
  const car=document.createElement('span');         // 회전은 안쪽 span에 (바깥 펄스 애니와 분리)
  car.textContent=MODE_ICON[flat[0].mode]||'🚗';
  car.style.cssText='display:inline-block;font-size:28px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));transition:transform .12s linear';
  el.appendChild(car);
  el.animate([{transform:'scale(1)'},{transform:'scale(1.15)'}],{duration:600,iterations:Infinity,direction:'alternate',easing:'ease-in-out'});
  animMarker=ME().moveMarker(flat[0].lat,flat[0].lng,el);
  // 줌이 바뀌는 누적거리 '경계' → 구간(phase) 분할. 각 구간은 '카메라 고정'으로 재생:
  // 진입 시 구간 전체를 한 화면에 담고 타일 로딩을 끝낸 뒤, 이동 중엔 카메라를 전혀 안 움직임
  // → 새 타일 로딩이 발생하지 않아(자동차는 오버레이라 타일 무관) 네트워크와 무관하게 매끄럽게 미끄러짐.
  const bounds=[];
  for(let i=1;i<flat.length;i++){ const zi=flat[i].zoom||PLAY_ZOOM_IN, zp=flat[i-1].zoom||PLAY_ZOOM_IN; if(zi!==zp) bounds.push({dist:gcum[i], zoom:zi}); }
  const cuts=[0]; bounds.forEach(b=>cuts.push(b.dist)); cuts.push(gtotal);
  const phases=[];
  for(let k=0;k<cuts.length-1;k++){
    const a=cuts[k], b=cuts[k+1]; if(b-a<1e-6) continue;
    const zoom = k===0? (flat[0].zoom||PLAY_ZOOM_IN) : bounds[k-1].zoom;   // 구간 내 줌 상한(도시=13, 도시간=9)
    let mnLa=90,mxLa=-90,mnLn=180,mxLn=-180; const pts=[];
    for(let i=0;i<flat.length;i++){ if(gcum[i]>=a-1e-6 && gcum[i]<=b+1e-6){ const p=flat[i]; pts.push([p.lat,p.lng]);
      mnLa=Math.min(mnLa,p.lat); mxLa=Math.max(mxLa,p.lat); mnLn=Math.min(mnLn,p.lng); mxLn=Math.max(mxLn,p.lng); } }
    if(!pts.length){ pts.push([flat[0].lat,flat[0].lng]); mnLa=mxLa=flat[0].lat; mnLn=mxLn=flat[0].lng; }
    // 화면 대각(구간이 화면을 채우는 정도) 대비 실제 경로 길이 → 직선이면 ~1, 굽이질수록↑.
    // dur을 '구간이 화면을 가로지르는 시간'으로 잡아 점 수·재생범위(일자/전체)와 무관하게 속도 일정.
    const span=Math.max(0.4, haversine({lat:mnLa,lng:mnLn},{lat:mxLa,lng:mxLn}));
    const dur=Math.min(9000, Math.max(2500, Math.max(1,(b-a)/span)*4200));   // ≈4.2초/화면
    phases.push({a,b,zoom,pts,dur});
  }
  let d=0, lastTs=null, seg=0, pIdx=0, elapsed=0, paused=false;   // elapsed=현재 구간 경과(ms)
  const applyPos=()=>{                                  // d로부터 마커 위치·방향만 갱신(카메라는 고정)
    while(seg<flat.length-2 && gcum[seg+1]<d) seg++;
    while(seg>0 && gcum[seg]>d) seg--;                  // 탐색으로 뒤로 이동 시 보정
    const A=flat[seg], B=flat[seg+1], segLen=(gcum[seg+1]-gcum[seg])||1, f=(d-gcum[seg])/segLen;
    animMarker.move(A.lat+(B.lat-A.lat)*f, A.lng+(B.lng-A.lng)*f);
    const tf=headingTransform(A,B); if(tf) car.style.transform=tf;   // 진행 방향으로 회전
    const ic=MODE_ICON[A.mode]||'🚗'; if(car.textContent!==ic) car.textContent=ic;
    updatePlayHud(A);                                  // 현재 구간·날짜 카드
  };
  const endPlay=()=>{                                   // 종료: 일자 재생이면 그 일자 프레임, 아니면 전체 보기
    const ad=activeDay; stopPlay();
    if(ad){ const dd=trip().days[ad-1]; if(dd){ fitTo(dd.spots.filter(hasLoc).map(s=>[s.lat,s.lng]),64,15); return; } }
    fitAll();
  };
  const step=(ts)=>{
    if(paused) return;
    if(lastTs==null) lastTs=ts;
    const dt=Math.min(34, ts-lastTs); lastTs=ts;       // 프레임 잭·탭 복귀 갭 클램프 — 렉 걸려도 점프 대신 감속
    const ph=phases[pIdx];
    elapsed+=dt*playSpeed;                             // 배속 반영(0.5/1/2×)
    const t=Math.min(1, elapsed/ph.dur);               // 구간별 소요시간 기준 진행(구간 내 등속)
    d=ph.a+(ph.b-ph.a)*t;
    applyPos();                                         // 마커만 이동 · 카메라 고정 → 새 타일 로딩 없음
    updatePlayProgress(d/gtotal); updatePlaySegInfo();  // 진행바·구간번호
    if(t>=1){                                           // 이 구간 끝 → 다음 구간(fit+대기) 또는 종료
      pIdx++;
      if(pIdx<phases.length) enterPhase();
      else { animRAF=null; animEndT=setTimeout(endPlay,700); }
      return;
    }
    animRAF=requestAnimationFrame(step);
  };
  // 구간 진입: 구간 전체를 한 화면에 담고(줌 상한=구간 줌) 타일 로딩 완료+정착 후 카메라 고정 재생
  const enterPhase=(keepElapsed)=>{
    animRAF=null; animWaiting=true; updatePlayBtn();
    ME().fit(phases[pIdx].pts, 90, phases[pIdx].zoom);
    ME().waitTiles(PLAY_TILE_TIMEOUT).then(()=>{
      if(myseq!==playSeq) return;                       // 대기 중 정지/재시작됨 → 무시
      setTimeout(()=>{
        if(myseq!==playSeq) return;
        animWaiting=false; lastTs=null; if(!keepElapsed) elapsed=0;   // 새 구간 0부터(탐색이면 경과 유지)
        applyPos(); updatePlayProgress(d/gtotal); updatePlaySegInfo();
        if(!paused) animRAF=requestAnimationFrame(step);
        updatePlayBtn(); updatePlayPauseBtn();
      }, PLAY_SETTLE);
    });
  };
  // 구간(leg) 시작 누적거리 — 이전/다음 구간 이동·구간 수 표시
  const legStarts=[0];
  for(let i=1;i<flat.length;i++){ if(flat[i].from!==flat[i-1].from || flat[i].to!==flat[i-1].to) legStarts.push(gcum[i]); }
  const pause=()=>{ if(paused) return; paused=true; if(animRAF){cancelAnimationFrame(animRAF);animRAF=null;} lastTs=null; updatePlayBtn(); updatePlayPauseBtn(); };
  const resume=()=>{ if(!paused) return; paused=false; lastTs=null; if(!animWaiting) animRAF=requestAnimationFrame(step); updatePlayBtn(); updatePlayPauseBtn(); };
  const seekPreview=(frac)=>{ d=Math.max(0,Math.min(1,frac))*gtotal; applyPos(); updatePlayProgress(d/gtotal); updatePlaySegInfo(); };
  const seekCommit=()=>{ const tt=playSeekTarget(phases,gtotal,d/gtotal); pIdx=tt.pIdx; elapsed=tt.elapsed; if(animRAF){cancelAnimationFrame(animRAF);animRAF=null;} enterPhase(true); };
  const prevSeg=()=>{ const i=playLegIndexAt(legStarts,d); const tgt=(i>0&&(d-legStarts[i])<0.3)?legStarts[i-1]:legStarts[i]; seekPreview(tgt/gtotal); seekCommit(); };
  const nextSeg=()=>{ const i=playLegIndexAt(legStarts,d); seekPreview((i<legStarts.length-1?legStarts[i+1]:gtotal)/gtotal); seekCommit(); };
  play={ paused:()=>paused, pause, resume, toggle:()=>paused?resume():pause(), seekPreview, seekCommit, prevSeg, nextSeg, legStarts, getLegIndex:()=>playLegIndexAt(legStarts,d) };
  updatePlayPauseBtn();
  enterPhase(false);                                   // 첫 구간부터 fit+타일 대기 후 출발
}
function renderFilter(){
  const bar = document.getElementById('filterbar'); bar.innerHTML='';
  // 범위 전환: 재생 중이면 새 범위로 재생 재시작(현재 재생을 멈추고 새 일정으로), 아니면 해당 영역으로 프레이밍
  const setScope=(ad, fitFn)=>{
    const wasPlaying = !!play;
    if(wasPlaying) stopPlay();
    activeDay=ad; render();
    if(wasPlaying) playTrip();                          // 새 범위(일자/전체)로 재생 재시작
    else fitFn();
  };
  const all = document.createElement('button'); all.className='chip'+(activeDay?'':' active'); all.textContent='전체';
  all.onclick=()=>setScope(0, fitAll); bar.appendChild(all);
  const today=new Date(); today.setHours(0,0,0,0);
  const start=trip().start?new Date(trip().start+'T00:00:00'):null;
  const todayDi=start?Math.floor((today-start)/86400000):-1;
  const todayBtn=document.createElement('button'); todayBtn.className='chip'+(activeDay===todayDi+1?' active':''); todayBtn.textContent='오늘';
  if(todayDi<0||todayDi>=trip().days.length){ todayBtn.disabled=true; todayBtn.title='여행 기간이 아닙니다'; }
  else todayBtn.onclick=()=>setScope(todayDi+1,()=>fitTo(trip().days[todayDi].spots.filter(hasLoc).map(s=>[s.lat,s.lng]),64,15));
  bar.appendChild(todayBtn);
  trip().days.forEach((d,i)=>{
    const b=document.createElement('button'); b.className='chip'+(activeDay===i+1?' active':''); b.title=d.title;
    b.innerHTML = colorByMode()==='day'
      ? `<span class="dot" style="background:${dayColor(i)};width:7px;height:7px;margin-right:4px"></span>D${i+1}`
      : 'D'+(i+1);
    b.onclick=()=>setScope(i+1, ()=>fitTo(d.spots.filter(hasLoc).map(s=>[s.lat,s.lng]),64,15));
    bar.appendChild(b);
  });
  // 예약 절약 기회 — 발견되면 필터바에서 항상 보이게 (탭 → 예약 추적). 확정과 잠재를 구분한다.
  const bs=tripSavingInfo();
  if(bs.confirmed>0||bs.potential>0){
    const sv=document.createElement('button'); sv.className='chip pxChip'+(bs.confirmed>0?'':' pxChipWarn');
    sv.textContent=bs.confirmed>0? `💰 ₩${fmtMoney(bs.confirmed)} 절약 가능` : `🟠 더 저렴한 옵션 발견`;
    sv.title=bs.confirmed>0? '동일 조건의 더 저렴한 가격이 확인됐어요 — 탭해서 확인'
                           : `최대 ₩${fmtMoney(bs.potential)} 저렴 — 조건 확인 필요. 탭해서 비교`;
    sv.onclick=openBookingList;
    bar.appendChild(sv);
  }
  const colors=cityColors(), menu=document.createElement('details'); menu.className='viewMenu';
  const cityButtons=Object.entries(colors).map(([city,c])=>`<button class="chip cityFocusBtn" data-city="${escAttr(city)}"><span class="dot" style="background:${c}"></span>${esc(city)}</button>`).join('');
  menu.innerHTML=`<summary>☷ 보기 설정⌄</summary><div class="viewMenuPanel">
    <div class="viewMenuLabel">색상 기준</div><button class="chip" id="colorModeBtn">🎨 ${colorByMode()==='day'?'일자별':'도시별'} 색상</button>
    <button class="chip" id="playBtn">${play?'⏹ 재생 정지':'▶ 경로 재생'}</button><button class="chip" id="themeBtn">◐ 테마 전환</button>
    <div class="viewMenuLabel">도시 포커스</div><div class="cityFocus">${cityButtons||'<span class="hint">도시 없음</span>'}</div></div>`;
  bar.appendChild(menu);
  menu.querySelector('#colorModeBtn').onclick=()=>commit(()=>{ trip().colorBy=colorByMode()==='day'?'city':'day'; });
  menu.querySelector('#playBtn').onclick=playTrip;
  menu.querySelector('#themeBtn').onclick=toggleTheme;
  menu.querySelectorAll('.cityFocusBtn').forEach(button=>button.onclick=()=>{
    const city=button.dataset.city,pts=[]; trip().days.forEach(d=>d.spots.forEach(s=>{if(s.city===city&&hasLoc(s))pts.push([s.lat,s.lng])})); fitTo(pts,80,15);
  });
  // 여행 전체 비용 — 항상 보이게, 탭하면 내역. 예약은 전액이라 '하루 비용'(날수로 나눈 몫)과 기준이 다르다
  const cb=tripCostBreakdown();
  if(cb.total>0){
    const rows=[['장소',cb.spots],['택시(자차·택시 일자)',cb.taxi],['숙박',cb.hotel],['렌터카',cb.car],['항공',cb.flight]].filter(r=>r[1]>0);
    const cost=document.createElement('details'); cost.className='viewMenu costMenu';
    cost.innerHTML=`<summary title="${escAttr('장소 비용 + 자차·택시 일자의 택시비 + 예약 총액 — 탭하면 내역')}">💳 ₩${fmtMoney(cb.total)}⌄</summary><div class="viewMenuPanel">
      <div class="viewMenuLabel">전체 예상 비용</div>
      ${rows.map(r=>`<div class="costRow"><span>${esc(r[0])}</span><b>₩${fmtMoney(r[1])}</b></div>`).join('')}
      <div class="costRow costTotal"><span>합계</span><b>₩${fmtMoney(cb.total)}</b></div>
      <div class="hint">예약은 총액 기준이에요 — 일자 카드의 '하루 비용'은 이걸 날수로 나눈 하루치입니다.</div></div>`;
    bar.appendChild(cost);
  }
}
function renderLegend(){
  let body;
  if(colorByMode()==='day'){
    body='<b style="font-size:12px">일자</b><br>'+
      trip().days.map((d,i)=>`<span class="legDay" data-di="${i}" style="cursor:pointer"><span class="dot" style="background:${dayColor(i)}"></span>Day ${i+1}${d.title?' · '+esc(d.title):''}</span>`).join('<br>');
  }else{
    const colors=cityColors();
    body='<b style="font-size:12px">도시</b><br>'+
      Object.entries(colors).map(([n,c])=>`<span class="dot" style="background:${c}"></span>${esc(n)}`).join('<br>');
  }
  document.getElementById('legend').innerHTML=body+'<br><span style="color:#f6bd60">- - -</span> 일자 간 이동';
  document.querySelectorAll('#legend .legDay').forEach(el=>{
    el.onclick=()=>{ const i=+el.dataset.di; activeDay=i+1; render();
      fitTo(trip().days[i].spots.filter(hasLoc).map(s=>[s.lat,s.lng]),64,15); };
  });
}
function renderSidebar(){
  const sb=document.getElementById('sidebar'); sb.innerHTML='';
  if(!sb.dataset.snap) sb.dataset.snap='half';
  const handle=document.createElement('button'); handle.id='sheetHandle'; handle.type='button'; handle.setAttribute('aria-label','일정 패널 높이 조절'); handle.title='위아래로 드래그해 일정 패널 높이 조절'; sb.appendChild(handle);
  // 이전 Sortable 인스턴스 정리 (누수 방지)
  sortables.forEach(s=>{try{s.destroy();}catch(e){}}); sortables=[];
  const colors=cityColors();
  const dayList=document.createElement('div'); dayList.id='dayList';
  trip().days.forEach((day,di)=>{
    const headC = colorByMode()==='day' ? dayColor(di) : (day.spots.length?(colors[day.spots[0].city]||'#556'):'#556');
    const card=document.createElement('div'); card.className='dayCard'+(activeDay&&activeDay!==di+1?' dim':''); card.style.setProperty('--c',headC);
    // 전날 숙소(🏠 등록)가 있으면 오늘 첫 일정으로 '가상 이월' — prevLoc를 숙소로 시드해 첫 장소에 이동거리 표시
    const ctx=dayContext(di), carry=ctx.carry;   // anchor=ETA용(숙소/전날 마지막), carry=🏠 표시용(숙소만)
    let spotsHtml='', prevLoc=carry;
    const tl=ctx.timeline, etas=tl.map(x=>x.eta), dm=ctx.mode, iso=isoDateOf(di), timeZone=ctx.timeZone;   // ETA는 anchor 기준 — 비숙소 전날 마지막 장소도 반영
    // 렌터카 픽업·반납 (표시 전용 — 동선·ETA와 무관). 일정의 장소와 연결된 건 그 장소 행에 붙으므로 독립 행에서 뺀다
    const carLinks=carSpotLinks(trip().days);
    const carEv=carEventsOn(tripBookings(), iso).filter(e=>!carLinks[e.kind][e.id]);
    day.spots.forEach((s,si)=>{
      const dotC = hasLoc(s)?spotColor(s,di,colors):'#4a5170';
      const incoming=prevLoc, inMode=legModeOf(day,s);   // 이 지점으로 '들어오는' 구간(수단) — 아래 ETA 안내에 사용
      // 구간: 캐시된 경로가 있으면 그걸, 아니면 직선거리 + 백그라운드 조회
      let legHtml='';
      if(hasLoc(s)&&prevLoc){
        const lm=legModeOf(day,s), depart=legDepartMinute(day,tl,si), when=lm==='transit'?planDepartISO(iso,depart,timeZone):null;
        const lid=legRequestKey(prevLoc,s,lm,when,timeZone), lc=requestLeg(prevLoc,s,lm,when,timeZone);   // 구간별 출발시각·시간대
        const failed=!lc && legCache[lid] && legCache[lid].fail;   // 인근 도로 스냅까지 실패
        legHtml = legModeBtn(day,di,si,lm) + (lc
          ? `<span class="leg" data-leg="${lid}" title="${legTitle(lc)}">${legLabel(lc)}</span>`
          : `<span class="leg${failed?' legfail':''}" data-leg="${lid}"${failed?' title="경로를 찾을 수 없어 직선거리로 표시 — 인근 도로 탐색(최대 2.4km)까지 실패했습니다. 장소 편집에서 검색으로 위치를 다시 잡아 보세요"':''}>↳${haversine(prevLoc,s).toFixed(1)}km${failed?' ⚠️':''}</span>`);
      }
      if(hasLoc(s)) prevLoc=s;
      // 예약 시각이 도착 예상시각(ETA)보다 이르면 경고 (예약 놓칠 위험)
      const bookMin=s.bookAt?parseHM(s.bookAt):null;
      const bookWarn=(bookMin!=null && etas[si]-bookMin>5);   // ETA가 예약보다 5분 이상 늦음
      const cat=spotCatOf(s);
      const meta=[];
      if(s.stay){
        // 이름 앞 🏠가 이미 숙소임을 말한다 → 아이콘이 못 전달하는 연박 수만 남긴다.
        // 단 카테고리를 다른 걸로 지정해 아이콘이 🏠가 아니면 숙소라는 사실을 계속 알려준다.
        const nights=stayNights(s)>1?`${stayNights(s)}박`:'';
        const label=(cat&&cat.id==='stay')? nights : `🏠 숙소${nights?` · ${nights}`:''}`;
        if(label) meta.push(`<span class="spotMetaItem stayMeta">${label}</span>`);
      }
      if(s.opt) meta.push(`<span class="spotMetaItem opt">선택 코스</span>`);
      if(!hasLoc(s)) meta.push(`<button type="button" class="spotMetaItem noloc" onclick="event.stopPropagation();openSpotModal(${di},${si})">📍 위치 지정</button>`);
      if(s.cost){
        const cu=CUR[s.cur], nk=cu&&s.cur!=='KRW';
        meta.push(`<span class="spotMetaItem cost"${nk?` title="${costLabel(s.cost,s.cur)}"`:''}>💳 ${nk?`${cu.sym}${fmtMoney(s.cost)}`:`₩${fmtMoney(s.cost)}`}</span>`);
        if(nk) meta.push(`<span class="spotMetaItem cost costConverted" aria-label="원화 환산 약 ${fmtMoney(toKRW(s.cost,s.cur))}원">약 ₩${fmtMoney(toKRW(s.cost,s.cur))}</span>`);
      }
      if(s.bookAt){
        const late=bookWarn? Math.round(etas[si]-bookMin) : 0;
        const bt=bookWarn
          ? `예약·입장 ${s.bookAt} · 도착 예상 ${hm(etas[si])} — 약 ${late}분 늦어요. 앞 일정을 줄이거나 예약을 옮기세요`
          : `예약·입장 ${s.bookAt} (상대가 정한 약속) — 도착 예상 ${hm(etas[si])}`;
        meta.push(`<span class="spotMetaItem book${bookWarn?' bookwarn':''}" title="${escAttr(bt)}">🎫 ${esc(s.bookAt)}${bookWarn?' ⚠️':''}</span>`);
        // 예약 시각까지 기다리는 시간(타임라인에 반영됨) — 숨은 동작을 눈에 보이게
        const w=Math.round(tl[si].wait||0);
        if(w>0) meta.push(`<span class="spotMetaItem book" title="${escAttr(`도착 예상 ${hm(etas[si])} → 예약 ${s.bookAt}까지 대기. 다음 장소 도착 예상에 이 대기가 반영됩니다`)}">⏳ ${w}분 대기</span>`);
      }
      { const bu=safeUrl(s.bookUrl); if(bu) meta.push(`<a class="spotMetaItem book" href="${escAttr(bu)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="예약 링크 열기">🔗 예약 링크</a>`); }
      // 이 장소에서 차를 받거나 돌려준다 — 예약과 연결해 두면 도착 순서와 어긋나지 않게 여기 붙는다
      [['carPickupId','렌터카 픽업','carPickupTime'],['carReturnId','렌터카 반납','carReturnTime']].forEach(([f,label,tf])=>{
        const bk=s[f]? bookingOf(s[f]) : null; if(!bk||bk.type!=='car') return;
        const t=bk[tf]?` ${bk[tf]}`:'';
        const tip=`${label}${t} · ${esc(bk.title)} — 탭해서 예약 상세 보기`;
        meta.push(`<button type="button" class="spotMetaItem carbkChip" onclick="event.stopPropagation();openBookingModal('${escAttr(bk.id)}')" title="${escAttr(tip)}">🚗 ${label}${esc(t)}</button>`);
      });
      // 예약 가격 추적 상태 (연결된 예약이 있을 때) — 탭하면 상세·가격 기록
      { const bk=s.bookingId? bookingOf(s.bookingId):null;
        if(bk) meta.push(`<button type="button" class="spotMetaItem pxBtn" onclick="event.stopPropagation();openBookingModal('${escAttr(bk.id)}')" title="예약 가격 추적 — 탭해서 상세와 가격 기록 보기">${bookingBadgeHtml(bk)}</button>`);
        else if(s.stay && !viewMode) meta.push(`<button type="button" class="spotMetaItem pxBtn pxStart" onclick="event.stopPropagation();startHotelTracking(${di},${si})" title="예약가와 기간을 넣으면 시세를 계속 확인해 더 싼 곳이 나오면 알려줘요">💰 가격 추적 시작</button>`); }
      // 영업시간 경고: 그 날 요일·도착 예상시각에 문 닫혀 있으면 ⚠️
      if(s.hours && iso){
        const wd=new Date(iso+'T00:00:00').getDay();
        const open=isOpenAt(s.hours, wd, Math.round(etas[si]));
        if(open===false) meta.push(`<span class="spotMetaItem closed" title="${'일월화수목금토'[wd]}요일 도착 예상 ${hm(etas[si])}에 영업 종료/휴무 — 시간을 확인하세요">🚫 영업시간 확인</span>`);
      }
      const metaHtml=meta.length?`<div class="spotMeta">${meta.join(' ')}</div>`:'';
      // 시각 배지: 📌=내가 고정한 도착 / 없으면 자동 계산한 도착 예상 / ⚠️=고정 시각이 이동상 불가능
      const natMin=tl[si].natural, natTxt=(natMin>=1440? `${Math.floor(natMin/1440)}일 뒤 ${hm(natMin)}` : hm(natMin));   // 24시간 초과분은 '며칠 뒤'로
      // 기차·비행기는 거리 기반 '추정'이라 실제 시간표를 못 이긴다 → 시간표대로 넣은 고정 도착에 충돌 경고를 띄우지 않음
      const bySchedule = !!(incoming && (inMode==='train'||inMode==='flight'));
      const showConflict = tl[si].conflict && !bySchedule;
      const etaTip = tl[si].fixed
        ? (tl[si].conflict
            ? (bySchedule
                ? `📌 도착 고정 ${esc(s.at)} — ${MODE_NAME[inMode]} 시간표 기준. 앱 추정(${natTxt})보다 빠르지만 정상입니다`
                : `📌 도착 고정 ${esc(s.at)} — 이동시간상 ${natTxt}에야 도착합니다. 앞 일정을 줄이거나 이 시각을 늦추세요`)
            : `📌 도착 고정 — 직접 정한 시각. 자동 계산 대신 이 시각을 씁니다 (이 날은 시각 순서로 정렬됩니다)`)
        : `도착 예상 — 시작 시각 + 이동시간 + 머무는 시간으로 자동 계산한 추정값`;
      spotsHtml+=`<div class="spot" data-di="${di}" data-si="${si}" style="--c:${dotC}">
        <div class="spotMain">
          <span class="spotTime eta${tl[si].fixed?' fixed':''}" title="${escAttr(etaTip)}">${tl[si].fixed?'📌':''}${hm(etas[si])}${showConflict?'⚠️':''}</span>
          <button type="button" class="spotIdentity nm" onclick="focusSpot(${di},${si})" title="${escAttr(s.name)}" aria-label="${escAttr(cat?`${cat.name} ${s.name}`:s.name)} 지도에서 보기"><span class="spotOrder">${si+1}.</span>${cat?`<span class="spotCat" title="${escAttr(cat.name)}" aria-hidden="true">${cat.icon}</span>`:''}<span class="spotName">${esc(s.name)}</span></button>
          <details class="actionMenu" onclick="event.stopPropagation()"><summary aria-label="${escAttr(s.name)} 작업 메뉴">⋮</summary><div class="actionMenuPanel">
          <button class="iconb mvup" onclick="moveSpot(${di},${si},-1)" title="위로">↑ <span>위로</span></button>
          <button class="iconb mvdown" onclick="moveSpot(${di},${si},1)" title="아래로">↓ <span>아래로</span></button>
          <button class="iconb" onclick="openSpotModal(${di},${si})" title="편집">✎ <span>편집</span></button>
          <button class="iconb" onclick="copySpot(${di},${si})" title="복사">⧉ <span>복사</span></button>
          <button class="iconb danger" onclick="deleteSpot(${di},${si})" title="삭제">⌫ <span>삭제</span></button>
          </div></details>
        </div>
        ${metaHtml}${legHtml?`<div class="spotLeg">${legHtml}</div>`:''}
      </div>`;
    });
    card.innerHTML=`<div class="dayHead">
        <div class="dayHeadMain"><div class="dayTitle" title="Day ${di+1} · ${escAttr(day.title)}"><span class="dragHandle" title="드래그로 일자 순서 변경">⠿</span> Day ${di+1} · ${esc(day.title)}</div>
        <details class="actionMenu" onclick="event.stopPropagation()"><summary aria-label="Day ${di+1} 작업 메뉴">⋮</summary><div class="actionMenuPanel"><button class="iconb" onclick="openDayModal(${di})" title="일자 편집">✎ <span>편집</span></button><button class="iconb" onclick="copyDay(${di})" title="일자 복사">⧉ <span>복사</span></button><button class="iconb danger" onclick="deleteDay(${di})" title="일자 삭제">⌫ <span>삭제</span></button></div></details></div>
        <div class="dayHeadMeta"><span class="date" onclick="event.stopPropagation();openDayModal(${di})" title="${timeZone?'클릭해서 날짜·시간대 지정/수정':'클릭해서 날짜·시간대 지정 — 시간대를 넣으면 이 날 대중교통 시간이 정확해집니다'}">${dateOf(di)||'📅 날짜 지정'} · ${timeZone?`🌐 ${esc(timeZone)}`:'🌐 시간대 미설정'}</span><button class="iconb modeBtn" onclick="event.stopPropagation();cycleMode(${di})" title="이동 수단: ${MODE_NAME[dm]} — 클릭해서 변경">${MODE_ICON[dm]}</button>${dayWeatherHtml(day,di)}</div>
      </div><div class="dayBody">
        ${day.drive?`<div class="drive">${esc(day.drive)}</div>`:''}
        ${flightHtml(day)}
        ${(()=>{   // 일자 간 자동 이동시간: 이월 시작점 → 오늘 첫 장소 (숙소 이월 시엔 🏠 항목+구간거리로 대체, none이면 미표시)
          const first=day.spots.find(hasLoc), from=startAnchorFor(di);
          if(carry||!from||!first) return '';
          const fi=day.spots.indexOf(first), im=legModeOf(day,first), depart=legDepartMinute(day,tl,fi), when=im==='transit'?planDepartISO(iso,depart,timeZone):null;
          const iid=legRequestKey(from,first,im,when,timeZone), ic=requestLeg(from,first,im,when,timeZone);
          const ibtn=legModeBtn(day,di,day.spots.indexOf(first),im);   // 이 구간(도시 간 이동인 경우가 많음)만 수단 변경
          return ic
            ? `<div class="drive" style="color:#9fb8e8" title="이전 일자 기준점 · ${legTitle(ic)}">${ibtn}<span data-ileg="${iid}">이전 일정에서 ${(ic.m/1000).toFixed(1)}km · ${fmtDur(ic.sec)}</span></div>`
            : `<div class="drive" style="color:#9fb8e8">${ibtn}<span data-ileg="${iid}">이전 일정에서 직선 ${haversine(from,first).toFixed(1)}km</span></div>`;
        })()}
        ${(()=>{const rt=dayRoute(day,ctx.backLeg); if(rt) return `<div class="dist">📏 하루 동선 약 ${(rt.m/1000).toFixed(1)}km · ${MODE_ICON[dm]}${fmtDur(rt.sec)}${((dm==='car'||dm==='taxi')&&rt.taxi)?` · 🚕약 ${rt.taxi.toLocaleString()}원`:''} <span style="opacity:.55">(${dm==='flight'?'직선':'도로 기준'})</span></div>`;
          return dayDistance(day,ctx.back)>0?`<div class="dist">📏 하루 동선 약 ${dayDistance(day,ctx.back).toFixed(1)}km <span style="opacity:.55">(직선)</span></div>`:'';})()}
        ${(()=>{const e=dayEndMin(day, ctx.anchor, ctx.backLeg); return (e!=null&&e>22*60)?`<div class="overload" title="시작시각+체류+이동 기준 예상 종료">⚠️ 일정 과밀 — 예상 종료 ${hm(e)}${e>=24*60?' (익일)':''}</div>`:'';})()}
        ${(()=>{
          const road=(dm==='car'||dm==='taxi');
          const parts=[['장소',dayCost(day)],['택시',road?((dayRoute(day,ctx.backLeg)||{}).taxi||0):0],['예약',iso?dayBookingCost(iso):0]]
            .filter(p=>p[1]>0);
          const tot=parts.reduce((a,p)=>a+p[1],0); if(!tot) return '';
          const detail=parts.length>1?` <span style="opacity:.55">(${parts.map(p=>`${p[0]} ₩${p[1].toLocaleString()}`).join(' + ')})</span>`:'';
          return `<div class="dist" title="${escAttr('여러 날 걸친 예약(숙박·렌터카·항공)은 날수로 나눈 하루치로 넣습니다')}">💳 하루 비용 약 ₩${tot.toLocaleString()}${detail}</div>`;
        })()}
        ${carry?`<div class="spot carry" style="--c:#7a86ad" title="전날 숙소 — 오늘 첫 일정으로 자동 이월 (탭하면 지도에서 보기 · 장소 편집의 🏠 숙소 체크로 관리)"><div class="spotMain"><span class="spotTime eta">🏠</span><button type="button" class="spotIdentity nm" onclick="focusLatLng(${+carry.lat},${+carry.lng})" title="${escAttr(carry.name)}" aria-label="${escAttr(carry.name)} 지도에서 보기"><span class="spotName">${esc(carry.name)}</span></button><span class="spotMenuSpacer" aria-hidden="true"></span></div><div class="spotMeta"><span class="spotMetaItem opt">전날 숙소</span></div></div>`:''}
        ${carEv.filter(e=>e.kind==='pickup').map(carEventRowHtml).join('')}
        <div class="spotList" data-di="${di}">${spotsHtml}</div>
        ${carEv.filter(e=>e.kind==='return').map(carEventRowHtml).join('')}
        ${(()=>{   // 동선 마무리 — 그날 마지막 장소에서 숙소로 돌아가는 구간을 자동으로 보여준다(데이터에는 넣지 않음)
          const bl=ctx.backLeg; if(!bl) return '';
          const c=requestLeg(bl.from,bl.to,bl.mode,bl.when,bl.timeZone);
          const legTxt = c
            ? `<span class="leg" data-leg="${bl.key}" title="${legTitle(c)}">${legLabel(c)}</span>`
            : `<span class="leg" data-leg="${bl.key}">↳${haversine(bl.from,bl.to).toFixed(1)}km</span>`;
          return `<div class="spot back" style="--c:#7a86ad" title="오늘 묵는 숙소 — 동선이 닫히도록 자동으로 이어 붙였습니다 (탭하면 지도에서 보기)">
            <div class="spotMain"><span class="spotTime eta">🏠</span><button type="button" class="spotIdentity nm" onclick="focusLatLng(${+bl.to.lat},${+bl.to.lng})" title="${escAttr(bl.to.name)}" aria-label="${escAttr(bl.to.name)}로 복귀 · 지도에서 보기"><span class="spotName">${esc(bl.to.name)}</span></button><span class="spotMenuSpacer" aria-hidden="true"></span></div>
            <div class="spotMeta"><span class="spotMetaItem opt">${MODE_ICON[bl.mode]||''} 숙소 복귀 · 자동</span></div>
            <div class="spotLeg">${legTxt}</div>
          </div>`;
        })()}
        <button class="addSpot addSpotBtn" data-di="${di}" onclick="openSpotModal(${di},-1)">＋ 장소 추가</button>${day.spots.filter(hasLoc).length>=3?`<button class="addSpot optBtn" onclick="optimizeDay(${di})" title="이 날의 방문 순서를 이동거리 최소로 재배열">🧭 동선 최적화</button>`:''}
        ${day.note?`<div class="note">📝 ${esc(day.note)}</div>`:''}
      </div>`;
    card.querySelector('.dayHead').onclick=(e)=>{
      if(e.target.closest('.iconb'))return;
      activeDay=di+1;render();
      const pts=day.spots.filter(hasLoc).map(s=>[s.lat,s.lng]);
      fitTo(pts,64,15);
    };
    // 일자 내 장소 드래그(일자 간 이동도 허용)
    if(window.Sortable && !viewMode) sortables.push(Sortable.create(card.querySelector('.spotList'),{
      group:'spots', animation:150, filter:'.iconb,.noloc', preventOnFilter:false,
      delay:120, delayOnTouchOnly:true, ghostClass:'sortable-ghost', chosenClass:'sortable-chosen',
      onEnd:onSpotDrop
    }));
    dayList.appendChild(card);
  });
  sb.appendChild(dayList);
  // 일자 카드 드래그(순서 변경 → 날짜 자동 재배치)
  if(window.Sortable && !viewMode) sortables.push(Sortable.create(dayList,{
    handle:'.dayHead', animation:150, filter:'.iconb', preventOnFilter:false,
    delay:120, delayOnTouchOnly:true, ghostClass:'sortable-ghost', chosenClass:'sortable-chosen',
    onEnd:onDayDrop
  }));
  const add=document.createElement('button'); add.className='btn'; add.id='addDayBtn'; add.textContent='＋ 일자 추가';
  add.onclick=()=>{ commit(()=>{ trip().days.push({title:'',drive:'',note:'',spots:[]}); }); openDayModal(trip().days.length-1); };
  sb.appendChild(add);
  applySpotSelection();   // 재렌더 후에도 선택 카드 강조 유지
}
// 일자 순서 변경 핸들러 (Sortable) — 인덱스 기반이라 날짜는 자동으로 따라감
function onDayDrop(evt){
  if(evt.oldIndex===evt.newIndex) return;
  const days=trip().days;
  const [moved]=days.splice(evt.oldIndex,1);
  days.splice(evt.newIndex,0,moved);
  activeDay=0;
  // render()는 Sortable 인스턴스를 재생성하므로 onEnd 스택 밖(다음 틱)에서 실행
  setTimeout(()=>{ commit(); toast('일자 순서 변경됨'); },0);
}
// 장소 순서/일자 이동 핸들러 (Sortable)
function onSpotDrop(evt){
  const fromDi=+evt.from.dataset.di, toDi=+evt.to.dataset.di;
  if(fromDi===toDi && evt.oldIndex===evt.newIndex) return;
  const fromSpots=trip().days[fromDi].spots, toSpots=trip().days[toDi].spots;
  const [moved]=fromSpots.splice(evt.oldIndex,1);
  toSpots.splice(evt.newIndex,0,moved);
  // 고정 시각이 있는 날이면 드롭 후 시간순으로 재정렬 (입력한 시각이 순서를 결정)
  const resorted = trip().days[toDi].spots.some(x=>x.at) && sortDayByTime(trip().days[toDi]);
  setTimeout(()=>{ commit();
    if(fromDi!==toDi) toast(`Day ${toDi+1}(으)로 이동${resorted?' · 시간순 정렬':''}`);
    else if(resorted) toast('시간순으로 정렬됨'); },0);
}
// ── 장소 카드 선택 상태 (지도 핀·목록 탭 공통) ──
// 재렌더로 DOM이 새로 만들어져도 유지되도록 상태를 변수로 들고, 렌더 후 applySpotSelection()으로 복원한다.
let selectedSpot=null;   // {di,si} | null
function selectSpotCard(di,si){ selectedSpot=(di==null)?null:{di:+di,si:+si}; applySpotSelection(); }
function applySpotSelection(){
  document.querySelectorAll('.spot.is-selected,.dayCard.is-selected').forEach(el=>el.classList.remove('is-selected'));
  const el=selectedSpot && document.querySelector(`.spot[data-di="${selectedSpot.di}"][data-si="${selectedSpot.si}"]`);
  if(selectedSpot && !el) selectedSpot=null;   // 삭제·이동으로 사라진 선택은 해제
  if(el){
    el.classList.add('is-selected');
    const card=el.closest('.dayCard'); if(card) card.classList.add('is-selected');
  }
  refreshAddSpotLabels();
}
// '＋ 장소 추가'가 어디에 넣을지 밝힌다 — 선택 위치는 카드 강조 말고는 눈에 안 보인다.
// 선택은 render() 없이도 바뀌므로(장소 탭) 라벨 갱신을 applySpotSelection에 묶는다.
function refreshAddSpotLabels(){
  document.querySelectorAll('.addSpotBtn[data-di]').forEach(btn=>{
    const di=+btn.getAttribute('data-di'), day=trip().days[di]; if(!day) return;
    const sel=(selectedSpot&&selectedSpot.di===di&&day.spots[selectedSpot.si])? selectedSpot.si : null;
    btn.textContent = sel!=null? `＋ ${sel+1}번 뒤에 장소 추가` : '＋ 장소 추가';
    btn.title = sel!=null? `선택한 ${sel+1}. ${day.spots[sel].name} 바로 뒤에 넣습니다 — 다른 장소를 탭하면 그 뒤로 바뀝니다`
                         : '이 날 맨 뒤에 넣습니다 — 장소를 탭해 선택하면 그 바로 뒤에 넣어요';
  });
}
window.focusSpot=(di,si)=>{
  selectSpotCard(di,si);
  const s=trip().days[di].spots[si];
  if(!hasLoc(s)){ openSpotModal(di,si); return; }   // 위치 미지정이면 지정 모달 열기
  if(activeDay && activeDay!==di+1){ activeDay=0; render(); }
  if(!ME().ready()) return;
  ME().panTo(+s.lat, +s.lng, 13);
  setSheetSnap('half');
  setTimeout(()=>{ const m=markers.find(m=>m.spot===s); if(m) m.open(); },400);
};
// 좌표로 지도 포커스 (전날 숙소 이월 항목 탭 등 — 특정 spot 인덱스가 없을 때)
window.focusLatLng=(lat,lng)=>{
  if(activeDay){ activeDay=0; render(); }             // 필터 걸려 해당 핀이 숨겨져 있을 수 있어 전체로
  if(!ME().ready()) return;
  ME().panTo(+lat, +lng, 13);
  setSheetSnap('half');
  setTimeout(()=>{ const m=markers.find(m=>Math.abs(+m.spot.lat-lat)<1e-6 && Math.abs(+m.spot.lng-lng)<1e-6); if(m) m.open(); },400);
};
// 화살표 이동: 도구 항상 노출 + 옮긴 장소를 커서 아래에 고정(스크롤 보정)해 연속 클릭 가능
// 일자 카드의 수단 아이콘 탭 → 자차→대중교통→도보→자전거 순환 (상세 설정은 일자 편집 모달)
// 동선 최적화 — 좌표 있는 장소를 이동거리 최소 순서로 재배열 (첫 지점 고정, 마지막 숙소면 고정, 좌표없음은 뒤로)
window.optimizeDay=(di)=>{
  if(viewMode) return;
  const day=trip().days[di];
  const idxLoc=day.spots.map((s,i)=>hasLoc(s)?i:-1).filter(i=>i>=0);
  if(idxLoc.length<3){ toast('최적화하려면 좌표 있는 장소가 3곳 이상 필요해요','#8892b0'); return; }
  const coords=idxLoc.map(i=>({lat:+day.spots[i].lat, lng:+day.spots[i].lng}));
  const lastStay=!!day.spots[idxLoc[idxLoc.length-1]].stay;   // 마지막이 숙소면 복귀지로 고정
  const order=optimizeRoute(coords,{fixStart:true, fixEnd:lastStay});
  const before=routeLength(coords), after=routeLength(coords,order);
  if(after>=before-0.05){ toast('이미 최적에 가까운 동선이에요 👍'); return; }
  const snap=snapshot();
  const newLoc=order.map(o=>day.spots[idxLoc[o]]);
  const unloc=day.spots.filter(s=>!hasLoc(s));   // 좌표 미지정은 순서 뒤로 유지
  const hasBook=newLoc.some(s=>s.bookAt);
  commit(()=>{ day.spots=newLoc.concat(unloc); activeDay=di+1; });
  const pts=day.spots.filter(hasLoc).map(s=>[s.lat,s.lng]); fitTo(pts,64,15);
  toast(`동선 최적화: 약 ${before.toFixed(1)}→${after.toFixed(1)}km${hasBook?' · 예약시각 순서 확인!':''}`, '#2a9d3f', {fn:()=>undoWith(snap)});
};
window.cycleMode=(di)=>{
  if(viewMode) return;
  const order=['car','taxi','transit','train','walk','bike','flight'];
  const d=trip().days[di];
  commit(()=>{ d.mode=order[(order.indexOf(dayModeOf(d))+1)%order.length]; });
  toast(`Day ${di+1} 기본 이동 수단: ${MODE_ICON[d.mode]} ${MODE_NAME[d.mode]} — 구간 아이콘을 누르면 그 구간만 바꿔요`);
};
// 구간 수단 순환: 일정 기본(legMode 없음) → 각 수단 → 다시 기본. 도시 간 이동처럼 '한 구간만' 다를 때.
const LEG_MODE_ORDER=['','car','taxi','transit','train','walk','bike','flight'];
window.cycleLegMode=(di,si)=>{
  if(viewMode) return;
  const day=trip().days[di], s=day&&day.spots&&day.spots[si]; if(!s) return;
  const next=LEG_MODE_ORDER[(LEG_MODE_ORDER.indexOf(s.legMode||'')+1)%LEG_MODE_ORDER.length];
  commit(()=>{ if(next) s.legMode=next; else delete s.legMode; });
  const dmn=dayModeOf(day);
  toast(next ? `이 구간만: ${MODE_ICON[next]} ${MODE_NAME[next]}`
             : `이 구간: 일정 기본(${MODE_ICON[dmn]} ${MODE_NAME[dmn]})으로 되돌림`);
};
window.moveSpot=(di,si,dir)=>{
  if(viewMode) return;
  const arr=trip().days[di].spots, ni=si+dir;
  if(ni<0||ni>=arr.length)return;
  const sb=document.getElementById('sidebar');
  const btnCls = dir<0?'mvup':'mvdown';
  const before=document.querySelector(`.spot[data-di="${di}"][data-si="${si}"] .${btnCls}`)?.getBoundingClientRect().top;
  commit(()=>{ [arr[si],arr[ni]]=[arr[ni],arr[si]]; });
  const afterBtn=document.querySelector(`.spot[data-di="${di}"][data-si="${ni}"] .${btnCls}`);
  const after=afterBtn?.getBoundingClientRect().top;
  if(before!=null && after!=null) sb.scrollTop += (after-before); // 같은 버튼이 커서 자리에 오도록
};
window.copySpot=(di,si)=>{
  if(viewMode)return;
  const spots=trip().days[di].spots, source=spots[si]; if(!source)return;
  const copy=JSON.parse(JSON.stringify(source)); copy.name=`${source.name} 복사본`;
  delete copy.carPickupId; delete copy.carReturnId;   // 차를 받는 곳은 한 곳 — 복사본까지 픽업 지점이 되면 안 된다
  commit(()=>spots.splice(si+1,0,copy)); toast('장소를 복사했습니다');
};
window.deleteSpot=(di,si)=>{
  if(viewMode||!confirm('이 장소를 삭제할까요?'))return;
  const spots=trip().days[di].spots; if(!spots[si])return;
  const snap=snapshot(); spots.splice(si,1); commit(); toast('장소 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};
window.copyDay=di=>{
  if(viewMode)return;
  const days=trip().days, source=days[di]; if(!source)return;
  const copy=JSON.parse(JSON.stringify(source)); copy.title=`${source.title||`Day ${di+1}`} 복사본`;
  commit(()=>days.splice(di+1,0,copy)); toast('일자를 복사했습니다');
};
window.deleteDay=di=>{
  if(viewMode)return;
  const days=trip().days; if(days.length<=1){toast('여행에는 일자가 하나 이상 필요합니다','#e53935');return;}
  if(days[di].spots.length&&!confirm('이 일자의 장소도 함께 삭제됩니다. 계속할까요?'))return;
  const snap=snapshot(); days.splice(di,1); activeDay=0; commit(); toast('일자 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};

// ───────────────── 장소 모달 ─────────────────
let editing = null; // {di, si} si=-1이면 추가
let _pickedHours = null;   // 검색 결과에서 선택한 영업시간 (저장 시 반영)
// 모달을 열 때 자동으로 채운 도시값(일자 첫 장소 기준 등). 사용자가 손대지 않은 '자동 프리필'인 동안엔
// 지도 클릭·검색 지정으로 실제 도시를 덮어써도 되지만, 직접 입력한 값은 보존한다.
let _cityPrefill = '';
let _namePrefill = '';   // 자동 채운 이름(검색/역지오코딩) — 사용자 입력과 구분
window.openSpotModal=(di,si)=>{
  if(viewMode){ toast('읽기전용 보기입니다 — "내 여행으로 저장" 후 편집하세요','#8892b0'); return; }
  // 새 장소는 '선택한 장소 바로 뒤'에 넣는다 — 선택이 없거나 다른 날이면 맨 뒤(기존 동작)
  const after=(si<0 && selectedSpot && selectedSpot.di===di && trip().days[di].spots[selectedSpot.si]) ? selectedSpot.si : null;
  editing={di,si,after};
  const isNew = si<0;
  document.getElementById('spotModalTitle').textContent = isNew?'장소 추가':'장소 편집';
  document.getElementById('spotDelBtn').style.display = isNew?'none':'block';
  const s = isNew? {name:'',city:trip().days[di].spots[0]?.city||'',desc:'',opt:false,lat:'',lng:''} : trip().days[di].spots[si];
  _pickedHours = s.hours||null;   // 편집 시 기존 영업시간 보존
  document.getElementById('spotName').value=s.name;
  document.getElementById('spotCity').value=s.city;
  _cityPrefill = s.city||'';   // 이후 자동 채움이 이 프리필 값은 덮어써도 됨(사용자 입력은 아님)
  _namePrefill = '';           // 기존 이름은 사용자 값 → 자동 채움이 안 덮게(빈 값일 때만 채움)
  document.getElementById('spotDesc').value=s.desc||'';
  document.getElementById('spotCat').value=s.cat||'';
  document.getElementById('spotOpt').checked=!!s.opt;
  document.getElementById('spotStay').checked=!!s.stay;
  document.getElementById('spotNights').value=stayNights(s);
  toggleNights();
  document.getElementById('spotAt').value=s.at||'';
  document.getElementById('spotLegMode').value=s.legMode||'';   // 이 지점으로 오는 구간 수단(빈값=일정 기본)
  document.getElementById('spotStayMin').value=(s.stayMin!=null? s.stayMin : 60);
  document.getElementById('spotCost').value=(s.cost!=null? fmtMoney(s.cost) : '');
  document.getElementById('spotCur').value=s.cur||'KRW';
  updateCostHint();
  document.getElementById('spotBookAt').value=s.bookAt||'';
  document.getElementById('spotBookUrl').value=s.bookUrl||'';
  document.getElementById('spotAdvanced').open=!isNew&&!!(s.legMode||s.cost||s.bookAt||s.bookUrl||s.opt||s.stay);
  document.getElementById('spotLat').value=s.lat; document.getElementById('spotLng').value=s.lng;
  document.getElementById('spotPlaceId').value=s.placeId||'';
  document.getElementById('coordHint').textContent = s.lat?`좌표: ${(+s.lat).toFixed(4)}, ${(+s.lng).toFixed(4)}`:'좌표: 미지정 (검색 또는 지도 클릭)';
  document.getElementById('spotSearch').value=''; document.getElementById('searchRes').innerHTML='';
  const daySel=document.getElementById('spotDay');
  daySel.innerHTML=trip().days.map((d,i)=>`<option value="${i}" ${i===di?'selected':''}>Day ${i+1} · ${esc(d.title||dateOf(i))}</option>`).join('');
  document.getElementById('spotModalBg').classList.add('show');
};
document.getElementById('spotCancel').onclick=()=>document.getElementById('spotModalBg').classList.remove('show');
document.getElementById('spotAdvanced').addEventListener('toggle',e=>{
  const badge=document.querySelector('#spotModalBg .stepBadge'); if(badge) badge.textContent=e.target.open?'상세 설정':'기본 정보';
});
// 비용 입력: 천 단위 쉼표 + 통화별 원화 환산 힌트
function updateCostHint(){
  const el=document.getElementById('costKrwHint');
  const d=document.getElementById('spotCost').value.replace(/[^\d]/g,''), cur=document.getElementById('spotCur').value;
  if(!d){ el.textContent=''; return; }
  const rate=fxRates[cur], rateStr=rate<100?rate.toFixed(1):fmtMoney(rate);
  el.textContent = cur==='KRW' ? `= ₩${fmtMoney(d)}`
    : `≈ ₩${fmtMoney(toKRW(+d,cur))}  (1${CUR[cur].sym} ≈ ₩${rateStr})`;
}
document.getElementById('spotCost').addEventListener('input',function(){ const d=this.value.replace(/[^\d]/g,''); this.value=d?(+d).toLocaleString('en-US'):''; updateCostHint(); });
document.getElementById('spotCur').addEventListener('change',updateCostHint);
document.getElementById('spotSave').onclick=()=>{
  const name=document.getElementById('spotName').value.trim();
  const lat=parseFloat(document.getElementById('spotLat').value), lng=parseFloat(document.getElementById('spotLng').value);
  if(!name){toast('이름을 입력하세요','#e63946');return;}
  if(isNaN(lat)||isNaN(lng)){toast('위치를 지정하세요 (검색 또는 지도 클릭)','#e63946');return;}
  const costV=parseInt(document.getElementById('spotCost').value.replace(/[^\d]/g,''));   // 쉼표 제거 후 숫자
  const curV=document.getElementById('spotCur').value;
  const s={name,city:document.getElementById('spotCity').value.trim()||'기타',desc:document.getElementById('spotDesc').value.trim(),
    opt:document.getElementById('spotOpt').checked,stay:document.getElementById('spotStay').checked,
    // 연박 수는 숙소일 때만 저장, 1박이면 생략(기본값 — 하위호환)
    nights:(document.getElementById('spotStay').checked && stayNights({nights:document.getElementById('spotNights').value})>1)
      ? stayNights({nights:document.getElementById('spotNights').value}) : undefined,
    at:normHM(document.getElementById('spotAt').value)||undefined,
    legMode:(document.getElementById('spotLegMode').value||undefined),   // 구간별 수단(빈값이면 일정 기본)
    stayMin:Math.max(0,parseInt(document.getElementById('spotStayMin').value)||60),
    cost:(isNaN(costV)?null:Math.max(0,costV)),
    cur:(curV&&curV!=='KRW'?curV:undefined),   // KRW는 기본값이라 저장 생략(하위호환)
    bookAt:normHM(document.getElementById('spotBookAt').value)||'',
    bookUrl:document.getElementById('spotBookUrl').value.trim(),
    placeId:(document.getElementById('spotPlaceId').value||undefined),   // 예약 가격 추적의 호텔 identity
    cat:(document.getElementById('spotCat').value||undefined),           // 미지정이면 이름 추론에 맡긴다
    hours:_pickedHours||undefined,lat,lng};
  const targetDay=parseInt(document.getElementById('spotDay').value);
  const isEdit=editing.si>=0;
  if(isEdit && targetDay===editing.di){
    trip().days[targetDay].spots[editing.si]=s;         // 같은 날 편집은 제자리 교체 (맨 뒤로 밀지 않음)
  }else{
    if(isEdit) trip().days[editing.di].spots.splice(editing.si,1);   // 다른 날로 옮길 때만 이동
    const dst=trip().days[targetDay].spots;
    // 새 장소는 선택한 장소 바로 뒤 — 일자를 바꿨거나 선택이 없으면 맨 뒤
    const at=(!isEdit && editing.after!=null && targetDay===editing.di) ? Math.min(editing.after+1, dst.length) : dst.length;
    dst.splice(at,0,s);
  }
  // 고정 시각이 있으면 그날을 시간순으로 자동 정렬 (제자리 편집이라 시각이 그대로면 순서 안 바뀜)
  const sorted = trip().days[targetDay].spots.some(x=>x.at) && sortDayByTime(trip().days[targetDay]);
  // 방금 넣은 장소를 선택해 둔다 — 연달아 추가하면 계속 그 뒤로 붙는다.
  // 렌더 전이라 DOM은 없다 → selectSpotCard가 아니라 상태만 두고, 렌더 끝의 applySpotSelection이 복원한다.
  if(!isEdit){ const ni=trip().days[targetDay].spots.indexOf(s); if(ni>=0) selectedSpot={di:targetDay, si:ni}; }
  document.getElementById('spotModalBg').classList.remove('show');
  commit(); toast(sorted?'저장됨 · 시간순 정렬':'저장됨');
};
document.getElementById('spotDelBtn').onclick=()=>{
  const snap=snapshot();
  trip().days[editing.di].spots.splice(editing.si,1);
  document.getElementById('spotModalBg').classList.remove('show');
  commit(); toast('장소 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};
// 장소 검색 — 국내(한글)는 카카오 우선, 그 외 Google Places (routedSearch)
let searching=false;
async function doSearch(){
  const q=document.getElementById('spotSearch').value.trim(); if(!q)return;
  if(searching) return;                                  // 진행 중 재호출 차단(연타 방지)
  const res=document.getElementById('searchRes');
  searching=true;
  try{
    // 편집 중인 일자의 기존 도시를 앵커로 활용 (있으면 주변 우선)
    const city=document.getElementById('spotCity').value.trim();
    const ck=q.toLowerCase()+'|'+city.toLowerCase();
    const hit=_searchCache[ck];
    let list;
    if(hit && Date.now()-hit.t<SEARCH_TTL){ list=hit.list; }   // 동일 검색 단기 캐시
    else{
      res.innerHTML='<div>검색 중…</div>';
      const anchor=city? await cityAnchorOf(city) : null;
      list=await routedSearch(q, anchor, 5);
      if(list.length) _searchCache[ck]={list, t:Date.now()};    // 결과만 캐시(오류는 재시도 가능하게)
    }
    if(!list.length){   // 무결과 vs 오류(인증·할당량·네트워크) 구분해 안내
      res.innerHTML=`<div>${esc(list.err? SEARCH_ERR_MSG[list.err]||SEARCH_ERR_MSG.error : '결과 없음 — 다른 키워드나 지도 클릭으로 지정해주세요')}</div>`;
      return;
    }
    res.innerHTML='';
    list.forEach(it=>{
      const d=document.createElement('div');
      d.textContent=it.name+(it.addr?` — ${it.addr}`:'');
      d.onclick=()=>{
        document.getElementById('spotLat').value=it.lat; document.getElementById('spotLng').value=it.lng;
        document.getElementById('spotPlaceId').value=it.placeId||'';   // 구글 결과면 호텔 identity용 placeId 보존
        fillNameValue(it.name, true);   // 검색 결과 선택은 명시적 → 기존 이름도 그 장소 이름으로 갱신
        document.getElementById('coordHint').textContent=`좌표: ${(+it.lat).toFixed(4)}, ${(+it.lng).toFixed(4)} ✓`+(it.hours?' · 영업시간 반영됨':'');
        if(it.city) fillCityValue(it.city);              // 결과가 아는 도시로 즉시 채움(신뢰성↑)
        else fillCityFromCoords(it.lat, it.lng, false);  // 없으면 역지오코딩 폴백
        _pickedHours = it.hours||null;   // 저장 시 spot.hours로 반영
        if(it.cat) document.getElementById('spotCat').value=it.cat;   // 검색 결과가 아는 분류를 그대로 채움

        res.innerHTML='';
      };
      res.appendChild(d);
    });
  }catch(e){   // 예상 못한 예외도 원인 분류해 안내(상세는 콘솔에만)
    const code=classifySearchErr(e); console.warn('검색 실패['+code+']:', (e&&e.message)||e);
    res.innerHTML=`<div>${esc(SEARCH_ERR_MSG[code]||SEARCH_ERR_MSG.error)}</div>`;
  }
  finally{ searching=false; }
}
document.getElementById('spotSearchBtn').onclick=doSearch;
document.getElementById('spotSearch').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});
// 지도 클릭 지정
document.getElementById('pickOnMap').onclick=()=>{
  pickMode=true;
  document.getElementById('spotModalBg').classList.remove('show');
  document.getElementById('pickBanner').style.display='block';
};
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&pickMode){pickMode=false;document.getElementById('pickBanner').style.display='none';document.getElementById('spotModalBg').classList.add('show');} });

// ───────────────── 일자 모달 ─────────────────
let editingDay=null;
window.openDayModal=(di)=>{
  if(viewMode){ toast('읽기전용 보기입니다 — "내 여행으로 저장" 후 편집하세요','#8892b0'); return; }
  editingDay=di;
  const d=trip().days[di];
  document.getElementById('dayModalTitle').textContent=`Day ${di+1} 편집 · ${dateOf(di)}`;
  document.getElementById('dayDate').value=isoDateOf(di);
  document.getElementById('dayStart').value=d.startAt||'09:00';
  document.getElementById('dayTimeZone').value=d.timeZone||'';
  document.getElementById('dayCarry').checked = (d.startPolicy!=='none');   // 전날 위치 이월 on/off
  document.getElementById('dayMode').value=dayModeOf(d);
  const f=d.flight||{};
  document.getElementById('flightCode').value=f.code||'';
  document.getElementById('flightDep').value=f.dep||'';
  document.getElementById('flightArr').value=f.arr||'';
  document.getElementById('flightDepAt').value=f.depAt||'';
  document.getElementById('flightArrAt').value=f.arrAt||'';
  toggleFlightFields();
  document.getElementById('dayTitle').value=d.title||'';
  document.getElementById('dayDrive').value=d.drive||'';
  document.getElementById('dayNote').value=d.note||'';
  document.getElementById('dayModalBg').classList.add('show');
};
// 연박 수 입력은 '숙소'일 때만 노출
function toggleNights(){
  const on=document.getElementById('spotStay').checked;
  document.getElementById('nightsWrap').style.display = on?'flex':'none';
  document.getElementById('nightsHint').style.display = on?'block':'none';
}
document.getElementById('spotStay').onchange=toggleNights;
// 항공 정보 입력은 이동수단이 비행기일 때만 노출
function toggleFlightFields(){ document.getElementById('flightFields').style.display = document.getElementById('dayMode').value==='flight'?'block':'none'; }
document.getElementById('dayMode').onchange=toggleFlightFields;
// 공항 코드(IATA 등)만 짧게 입력하면 구글 Places로 공항명 조회해 자동 채움. 긴 이름은 그대로.
async function lookupAirport(el){
  const v=el.value.trim();
  if(!/^[A-Za-z가-힣]{2,4}$/.test(v)) return;                 // 코드처럼 짧을 때만 (이미 이름이면 건드리지 않음)
  el.disabled=true;
  try{
    const r=(await googlePlaces(v+' airport', null, 1)).list[0];
    if(r && r.name && el.value.trim()===v) el.value=`${r.name} (${v.toUpperCase()})`;
  }catch(e){} finally{ el.disabled=false; }
}
['flightDep','flightArr'].forEach(id=>document.getElementById(id).addEventListener('blur',e=>lookupAirport(e.target)));
document.getElementById('dayCancel').onclick=()=>document.getElementById('dayModalBg').classList.remove('show');
document.getElementById('daySave').onclick=()=>{
  const d=trip().days[editingDay];
  const dayTz=document.getElementById('dayTimeZone').value.trim();
  if(dayTz&&!validTimeZone(dayTz)){ toast('시간대는 Europe/Madrid 같은 IANA 형식으로 입력해 주세요','#e63946'); return; }
  d.title=document.getElementById('dayTitle').value.trim();
  d.startAt=normHM(document.getElementById('dayStart').value)||'09:00';
  if(dayTz) d.timeZone=dayTz; else delete d.timeZone;
  if(document.getElementById('dayCarry').checked) delete d.startPolicy; else d.startPolicy='none';   // 이월 정책
  d.mode=document.getElementById('dayMode').value;
  const fc=document.getElementById('flightCode').value.trim(), fdp=document.getElementById('flightDep').value.trim(),
    far=document.getElementById('flightArr').value.trim(), fda=normHM(document.getElementById('flightDepAt').value), faa=normHM(document.getElementById('flightArrAt').value);
  if(fc||fdp||far||fda||faa) d.flight={code:fc,dep:fdp,arr:far,depAt:fda,arrAt:faa};
  else delete d.flight;
  d.drive=document.getElementById('dayDrive').value.trim();
  d.note=document.getElementById('dayNote').value.trim();
  // 이 날짜에 맞춰 여행 시작일 역산 (Day들은 시작일 기준 연속) — 빈 값이면 시작일 해제
  const dv=document.getElementById('dayDate').value;
  if(dv){ const nd=new Date(dv+'T00:00:00'); nd.setDate(nd.getDate()-editingDay); trip().start=toISO(nd); }
  else { trip().start=''; }
  document.getElementById('dayModalBg').classList.remove('show'); commit(); toast('저장됨');
};
document.getElementById('dayDelBtn').onclick=()=>{
  if(trip().days.length<=1){toast('여행에는 일자가 하나 이상 필요합니다','#e53935');return;}
  if(trip().days[editingDay].spots.length && !confirm('이 일자의 장소도 함께 삭제됩니다. 계속할까요?'))return;
  const snap=snapshot();
  trip().days.splice(editingDay,1); activeDay=0;
  document.getElementById('dayModalBg').classList.remove('show'); commit(); toast('일자 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};

// ───────────────── 여행 관리 ─────────────────
document.getElementById('tripSel').onchange=e=>{ commit(()=>{ store.activeId=e.target.value; activeDay=0; }, {fit:fitEntry}); };
function createNewTrip(askName){
  const name=askName===false?'새 여행':prompt('새 여행 이름은?','새 여행'); if(name===null)return;
  const t={id:uid(),name:name||'새 여행',start:new Date().toISOString().slice(0,10),days:[{title:'',drive:'',note:'',spots:[]}]};
  commit(()=>{ store.trips.push(t); store.activeId=t.id; activeDay=0; });
  document.getElementById('tripModalBg').classList.add('show');
  document.getElementById('tripName').value=t.name; document.getElementById('tripStart').value=t.start;
  document.getElementById('tripTimeZone').value='';
}
document.getElementById('newTripBtn').onclick=()=>createNewTrip(true);
document.getElementById('tripEditBtn').onclick=()=>{
  document.getElementById('tripName').value=trip().name;
  document.getElementById('tripStart').value=trip().start||'';
  document.getElementById('tripTimeZone').value=trip().timeZone||'';
  document.getElementById('tripModalBg').classList.add('show');
  loadSnapList();
};
document.getElementById('tripCancel').onclick=()=>document.getElementById('tripModalBg').classList.remove('show');
document.getElementById('tripSave').onclick=()=>{
  const timeZone=document.getElementById('tripTimeZone').value.trim();
  if(timeZone&&!validTimeZone(timeZone)){ toast('시간대는 Asia/Tokyo 같은 IANA 형식으로 입력해 주세요','#e63946'); return; }
  trip().name=document.getElementById('tripName').value.trim()||'이름 없는 여행';
  trip().start=document.getElementById('tripStart').value;
  if(timeZone) trip().timeZone=timeZone; else delete trip().timeZone;
  document.getElementById('tripModalBg').classList.remove('show'); commit(); toast('저장됨');
};
// 여행 삭제 (활성/비활성 공통) — 설정 모달·여행 목록 양쪽에서 사용
function deleteTrip(id){
  const t=store.trips.find(x=>x.id===id); if(!t) return false;
  if(!confirm(`"${t.name}" 여행을 삭제할까요?`)) return false;
  const snap=snapshot();
  cloudDelete(id,t);   // 로그인 상태면 tombstone 기록, 오프라인이면 재시도 큐에 보존
  store.trips=store.trips.filter(x=>x.id!==id);
  if(!store.trips.length){ store.trips=[{id:uid(),name:'새 여행',start:new Date().toISOString().slice(0,10),days:[{title:'',drive:'',note:'',spots:[]}]}]; }
  if(id===store.activeId){ store.activeId=store.trips[0].id; activeDay=0; }   // 보고 있던 여행을 지운 경우만 전환
  commit(null, {fit:fitEntry});
  // undo 시 삭제된 여행이 다시 활성화되어 render→save로 클라우드에도 재업로드됨
  toast(`"${t.name}" 삭제됨`,'#8892b0',{fn:()=>undoWith(snap)});
  return true;
}
document.getElementById('tripDelBtn').onclick=()=>{
  if(deleteTrip(store.activeId)) document.getElementById('tripModalBg').classList.remove('show');
};
// 여행 목록 — 전환(이름 탭)·삭제(🗑)를 한 화면에서
function renderTripList(){
  const box=document.getElementById('tripListBody');
  box.innerHTML=store.trips.map(t=>{
    const days=(t.days||[]).length, spots=(t.days||[]).reduce((a,d)=>a+((d.spots||[]).length),0);
    const act=t.id===store.activeId;
    return `<div class="tripRow${act?' active':''}">
      <span class="tn" onclick="switchTrip('${escAttr(t.id)}')" title="이 여행으로 전환">${act?'▶ ':''}${esc(t.name||'(이름 없음)')}
        <span class="opt">${t.start?esc(t.start)+' · ':''}${days}일 · ${spots}곳</span></span>
      <button class="iconb" onclick="event.stopPropagation();removeTrip('${escAttr(t.id)}')" title="이 여행 삭제" style="color:#ff8fa3">🗑</button>
    </div>`;
  }).join('');
}
window.switchTrip=(id)=>{
  if(id===store.activeId){ document.getElementById('tripListBg').classList.remove('show'); return; }
  commit(()=>{ store.activeId=id; activeDay=0; }, {fit:fitEntry});
  document.getElementById('tripListBg').classList.remove('show');
};
window.removeTrip=(id)=>{ if(deleteTrip(id)) renderTripList(); };   // 목록은 열어둔 채 계속 정리 가능
document.getElementById('tripListBtn').onclick=()=>{
  if(viewMode){ toast('읽기전용 보기입니다 — "내 여행으로 저장" 후 이용하세요','#8892b0'); return; }
  renderTripList(); document.getElementById('tripListBg').classList.add('show');
};
document.getElementById('tripListClose').onclick=()=>document.getElementById('tripListBg').classList.remove('show');
document.getElementById('tripListNew').onclick=()=>{
  document.getElementById('tripListBg').classList.remove('show');
  document.getElementById('newTripBtn').click();
};

// ───────────────── 예약 가격 추적 (다중 소스 · 실데이터) ─────────────────
// "이미 세운 계획에서 출발 전까지 계속 돈을 아껴주는" 기능. 예약(booking)·호텔 identity·매핑 캐시(ptoken)는
// 여행 데이터(trip.bookings)에 저장돼 공유·클라우드 동기화를 따라가고, 가격 관측 기록은 기기 로컬 +
// (로그인 시) hotel_price_snapshots 클라우드 테이블에 쌓인다.
// 구조: Metasearch(Discovery, /api/hotel-offers 서버 프록시 — 키는 서버 전용) → Offer 정규화 →
// 조건 매칭(price.js matchQuality) → Saving Decision(decideSaving: 확정/잠재 분리) → UI·알림.
// 가짜/모의 가격은 production에서 쓰지 않는다 — 소스 미연결이면 그 상태를 그대로 보여준다.
const PRICE_KEY='tripcanvas_prices_v1';
const BK_TYPE={hotel:{icon:'🏨',name:'숙박'},car:{icon:'🚗',name:'렌터카'},flight:{icon:'✈️',name:'항공'}};
// 오류 분류(§35) → 사용자 안내문. 상세 원문은 콘솔·서버 로그에만.
const PX_ERR_MSG={
  AUTH_REQUIRED:'가격 소스가 아직 연결되지 않았어요 — 서버에 메타서치 API 키 설정이 필요합니다',
  AUTH_ERROR:'가격 소스 인증 오류 — 관리자 확인이 필요해요',
  RATE_LIMIT:'조회 한도를 넘었어요 — 잠시 후 다시 시도해주세요',
  PROPERTY_NOT_FOUND:'이 이름으로 호텔을 찾지 못했어요 — 예약처 표기와 같은 이름으로 바꿔보세요',
  LOCATION_NOT_FOUND:'픽업 장소를 확인해주세요 — 공항코드(PMI 등)를 넣으면 정확해져요',
  PAST_DATE:'체크인이 이미 지난 예약이에요 — 지난 날짜의 시세는 조회할 수 없어요',
  INVALID_NAME:'호텔 이름이 비어 있어요 — 예약 이름을 확인해주세요',
  INVALID_DATES:'체크인·체크아웃 날짜 형식을 확인해주세요',
  INVALID_DATE_ORDER:'체크아웃이 체크인보다 뒤여야 해요 — 예약 날짜를 확인해주세요',
  invalid_request:'예약 정보가 조회 조건에 맞지 않아요 — 이름과 날짜를 확인해주세요',
  NO_AVAILABILITY:'해당 날짜에 판매 중인 가격이 없어요',
  NETWORK_ERROR:'네트워크 오류 — 연결을 확인하고 다시 시도해주세요',
  PROVIDER_ERROR:'가격 소스 오류 — 잠시 후 다시 시도해주세요',
  INVALID_RESPONSE:'가격 소스 응답을 해석하지 못했어요',
  UNMATCHED:'호텔 자동 매칭이 확실하지 않아요 — 후보에서 직접 선택해주세요'
};
// 기기 로컬 기록: {bookingId: {obs:[하루 1점], offers:[마지막 성공 조회의 판매처별 비교], at:성공시각, err:{code,at}|null, candidates?, alert?}}
let priceStore={};
try{
  const raw=JSON.parse(localStorage.getItem(PRICE_KEY))||{};
  // v1(관측 배열) → v2 레코드 마이그레이션 + MVP 모의 시세 기록 제거(실데이터 원칙)
  Object.keys(raw).forEach(k=>{
    const v=raw[k];
    const rec=Array.isArray(v)? {obs:v,offers:[],at:null,err:null} : (v&&typeof v==='object'? v:null);
    if(!rec) return;
    rec.obs=(Array.isArray(rec.obs)?rec.obs:[]).filter(o=>o&&!/\(모의\)/.test(String(o.provider||o.seller||'')));
    rec.offers=Array.isArray(rec.offers)?rec.offers:[];
    priceStore[k]=rec;
  });
}catch(e){}
function savePrices(){ try{ localStorage.setItem(PRICE_KEY, JSON.stringify(priceStore)); }catch(e){} }
function recOf(id){ return priceStore[id]||(priceStore[id]={obs:[],offers:[],at:null,err:null}); }
// 어느 여행에도 없는 예약의 기록 정리 (여행/예약 삭제 뒤 잔재)
function prunePrices(){
  const ids=new Set(); store.trips.forEach(t=>(t.bookings||[]).forEach(b=>ids.add(b.id)));
  let changed=false;
  Object.keys(priceStore).forEach(k=>{ if(!ids.has(k)){ delete priceStore[k]; changed=true; } });
  if(changed) savePrices();
}
function tripBookings(){ return trip().bookings||[]; }
function bookingOf(id){ return tripBookings().find(b=>b.id===id)||null; }
function todayISO(){ return toISO(new Date()); }
function fmtDT(iso){ const d=new Date(iso); return isNaN(+d)?'':`${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
// 호텔 identity — 연결된 🏠 숙소 스팟의 이름·placeId·좌표를 쓴다 (이름만으로 검색하지 않기 위해)
// SerpApi(google_hotels)는 한글 호텔명 쿼리로는 엉뚱한 숙소를 돌려준다(좌표 검색 파라미터도 없다).
// Google Places는 한글 질의도 영문명으로 답하므로, 한글 이름은 한 번 변환해 예약에 캐시한다.
// 한 번 매칭에 성공하면 ptoken이 저장돼 이후에는 검색 단계 자체를 건너뛴다.
async function enNameForBooking(b, idn){
  const name=String((idn&&idn.name)||b.title||'').trim();
  if(!/[가-힣]/.test(name)) return name;
  if(b.enName) return b.enName;
  try{
    const near=(isFinite(Number(idn&&idn.lat))&&isFinite(Number(idn&&idn.lng)))?{lat:+idn.lat,lng:+idn.lng}:null;
    const hit=(await googlePlaces(name, near, 1)).list[0];
    if(hit&&hit.name&&!/[가-힣]/.test(hit.name)){ b.enName=hit.name; save(); return hit.name; }
  }catch(_){}
  return name;   // 변환 실패 시 원래 이름으로 시도(후보 선택 UI가 마지막 안전망)
}
function identityForBooking(b){
  let found=null;
  trip().days.forEach(d=>d.spots.forEach(s=>{ if(s.bookingId===b.id) found=s; }));
  return found? {name:found.name||b.title, placeId:found.placeId, lat:(hasLoc(found)? +found.lat:undefined), lng:(hasLoc(found)? +found.lng:undefined)}
              : {name:b.title};
}
function hotelStateOf(b){
  if(!b||(b.type!=='hotel'&&b.type!=='car')) return null;   // 렌터카도 같은 판단 엔진 사용(항공은 소스 준비 전)
  return TC_PRICE.hotelTrackState(b, priceStore[b.id]||null, {today:todayISO(), krwRate:fxRates[b.cur||'KRW']||1});
}
function tripSavingInfo(){
  return TC_PRICE.tripHotelSummary(tripBookings(), priceStore, {today:todayISO(), krwRateOf:c=>fxRates[c||'KRW']||1});
}
// 상태 배지 — 🔴 확정 절약(가장 눈에 띔) / 🟠 미검증 저가(단정 금지) / 🟢 유지 권장 / 🟡 추적 중 / ⚠️ 실패
function bookingBadgeHtml(b){
  if(!b) return '';
  if(b.type==='flight'){
    return b.track!==false? `<span class="pxBadge pxWatch" title="항공 가격 소스는 준비 중 — 지금은 예약 기록용">🟡 추적 예정</span>`
                          : `<span class="pxBadge pxOff">추적 꺼짐</span>`;
  }
  const st=hotelStateOf(b);
  if(st&&st.state==='SAVING_AVAILABLE'){ const o=st.confirmed.offer;
    return `<span class="pxBadge pxSave" title="${escAttr(`${o.seller} ${costLabel(TC_PRICE.offerPrice(o),b.cur)} · ✓ 동일 조건${o.verified?' 확인됨':''}${st.fee?' · 취소 수수료 반영':''}`)}">🔴 ₩${fmtMoney(toKRW(st.confirmed.saving,b.cur))} 절약 가능</span>`; }
  if(st&&st.state==='CHEAPER_UNVERIFIED'){ const o=st.potential.offer;
    return `<span class="pxBadge pxWarn" title="${escAttr(`${o.seller}에서 최대 ${costLabel(st.potential.delta,b.cur)} 저렴 — 현재 예약과 조건이 다르거나 확인되지 않았어요`)}">🟠 더 저렴한 옵션 발견</span>`; }
  if(st&&st.state==='GOOD_PRICE') return `<span class="pxBadge pxGood" title="현재가가 관측 최저 수준 — 지금 예약 유지 권장">🟢 좋은 가격</span>`;
  if(st&&st.state==='ERROR') return `<span class="pxBadge pxWarn" title="${escAttr(PX_ERR_MSG[(st.err&&st.err.code)||'PROVIDER_ERROR']||'가격 확인 실패')}">⚠️ 확인 실패</span>`;
  if(b.track!==false) return `<span class="pxBadge pxWatch" title="시세를 계속 확인 중 — 아직 의미 있는 하락이 없어요">🟡 가격 추적 중</span>`;
  return `<span class="pxBadge pxOff">추적 꺼짐</span>`;
}

// ── Discovery Provider (클라이언트 registry) — UI·로직은 이 계약만 안다. 실제 서비스 의존은 서버 adapter에만 ──
const MetasearchHotelProvider={
  id:'metasearch',
  supports(b){ return b.type==='hotel'; },
  async searchOffers(b){
    const idn=identityForBooking(b);
    const qName=await enNameForBooking(b, idn);   // 조회·응답 모두 영문으로 맞춰야 이름 매칭이 성립한다
    const r=await fetch('/api/hotel-offers',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:qName, placeId:idn.placeId, lat:idn.lat, lng:idn.lng, ptoken:b.ptoken,
        checkIn:b.start, checkOut:b.end, adults:b.adults||2, rooms:b.rooms||1, currency:b.cur||'KRW', country:'kr', language:'en'})});
    const js=await r.json().catch(()=>null);
    if(!r.ok) throw Object.assign(new Error('offers_failed'),{code:(js&&js.error)||'PROVIDER_ERROR', detail:(js&&js.detail)||''});
    return js;
  }
};
// 렌터카 시장 탐색 — 현재 예약 업체(RecordGo 등)의 재확인이 아니라, 같은 지역·기간의 다른 판매처 대안을 찾는다.
// 서버 레지스트리에 연결된 Discovery API가 없으면 AUTH_REQUIRED가 내려오고, UI는 수동 관측 fallback을 안내한다.
const CarMarketProvider={
  id:'car-market',
  supports(b){ return b.type==='car'; },
  async searchOffers(b){
    // 반납 지점은 (장소,코드) 한 쌍으로 — 편도 반납에 픽업 공항코드를 물려주면 엉뚱한 곳의 시세를 조회한다
    const rp=carReturnPoint(b);
    const r=await fetch('/api/car-offers',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ pickup:b.carPickup||b.title, pickupCode:b.carPickupCode,
        'return':rp.place||(rp.code?'':b.title), returnCode:rp.code,
        pickupAt:(b.start||'')+'T'+(b.carPickupTime||'10:00'), returnAt:(b.end||'')+'T'+(b.carReturnTime||'10:00'),
        driverAge:b.driverAge, currency:b.cur||'KRW', vehicleClass:b.carClass, transmission:b.transmission })});
    const js=await r.json().catch(()=>null);
    if(!r.ok) throw Object.assign(new Error('car_offers_failed'),{code:(js&&js.error)||'PROVIDER_ERROR', detail:(js&&js.detail)||''});
    return js;
  }
};
const PRICE_DISCOVERY=[MetasearchHotelProvider,CarMarketProvider];   // 항공은 향후 같은 계약의 Provider를 추가
// 가격 소스 상태(§34) — 세션당 1회 조회
let _pxHealth;
async function loadPxHealth(){
  if(_pxHealth!==undefined) return _pxHealth;
  _pxHealth=null;
  try{ const r=await fetch('/api/hotel-offers?health=1'); const js=await r.json(); if(r.ok&&js&&Array.isArray(js.providers)) _pxHealth=js.providers; }catch(e){}
  return _pxHealth;
}
function pxSourceLineHtml(list){
  if(!list) return '가격 소스 상태 확인 불가 — 서버 함수(/api) 접근 필요 (로컬 정적 서버에선 미지원)';
  const ko={CONNECTED:'연결됨',AUTH_REQUIRED:'인증 필요',UNAVAILABLE:'미지원'};
  return '가격 소스: '+list.map(p=>`${esc(p.id)} ${ko[p.status]||esc(p.status)}`).join(' · ');
}

// ── 절약 기회 알림 이벤트 — 지금은 토스트 1채널. 웹 알림·이메일·푸시·카카오는 리스너만 추가 ──
const savingListeners=[];
function onSavingOpportunity(fn){ savingListeners.push(fn); }
function emitSavingOpportunity(op){ savingListeners.forEach(fn=>{ try{ fn(op); }catch(e){} }); }
onSavingOpportunity(op=>{
  const b=bookingOf(op.bookingId);
  toast(`💰 "${op.title}" ${op.sellerName} ✓ 동일 조건 — 약 ₩${fmtMoney(toKRW(op.savingAmount,(b&&b.cur)))} 절약 가능`, '#7c5cff', {label:'보기', fn:openBookingList});
});

// ── PriceTrackingService: Discovery 조회 → 정규화·매칭 → 관측 기록 → 판단·알림 ──
// 자동 하루 1회(staleHours) + 실패 백오프 + 수동 확인 쿨다운 + 동일 요청 공유 — 외부 API 비용 제어.
const _pxInflight=new Map();
async function checkBookingPrice(id,opts){
  const b=bookingOf(id); if(!b||b.track===false) return null;
  const provider=PRICE_DISCOVERY.find(x=>x.supports(b)); if(!provider) return null;   // 소스 없는 종류는 조회하지 않음(가짜 데이터 금지)
  if(!b.start||!b.end) return null;                                                   // 기간 없이는 검색 불가 (상세 화면이 안내)
  const today=todayISO(); if(b.end<=today) return null;                               // 숙박 종료 → 추적 중단
  if(b.start<today) return null;   // 체크인이 지남 → 재예약 의미 없고, 시세 소스도 지난 날짜를 조회할 수 없다
  const rec=recOf(id), now=Date.now(), CFG=TC_PRICE.PRICE_CFG;
  const age=rec.at? now-Date.parse(rec.at) : Infinity;
  if(opts&&opts.force){ if(age<CFG.cooldownMin*60e3) return {cooldown:true}; }        // 수동 확인 쿨다운 — 최신 저장값 유지
  else{
    if(age<CFG.staleHours*3600e3) return null;                                        // 신선 → 자동 조회 생략
    if(rec.err&&rec.err.at&&now-Date.parse(rec.err.at)<CFG.errBackoffMin*60e3) return null;   // 실패 직후 재시도 억제
  }
  const idn=identityForBooking(b);
  const key=[b.ptoken||idn.placeId||idn.name, b.start, b.end, b.adults||2, b.rooms||1, b.cur||'KRW'].join('|');
  let job=_pxInflight.get(key);                                                        // 동일 호텔·날짜·인원 요청은 사이클 내 공유
  if(!job){ job=provider.searchOffers(b).finally(()=>_pxInflight.delete(key)); _pxInflight.set(key,job); }
  let resp;
  try{ resp=await job; }
  catch(e){
    const code=(e&&e.code)||'NETWORK_ERROR', detail=(e&&e.detail)||'';
    // 저장된 매핑이 잘못되면 검색 단계를 건너뛴 채 매번 같은 실패가 난다 → 매물 관련 실패면 매핑을 버려 다음 조회에서 다시 찾게 한다
    if(b.ptoken && (code==='PROPERTY_NOT_FOUND'||code==='NO_AVAILABILITY'||code==='INVALID_RESPONSE'||code==='PROVIDER_ERROR')){ delete b.ptoken; save(); }
    rec.err={code, at:new Date().toISOString(), detail:detail||undefined};   // 실패해도 기존 관측·오퍼는 보존(§36) — 최신 가격으로 오인 금지
    savePrices(); return null;
  }
  if(resp.status==='UNMATCHED'){
    rec.err={code:'UNMATCHED', at:new Date().toISOString()};
    rec.candidates=(resp.candidates||[]).slice(0,3).map(c=>({name:String(c.name||''), token:String(c.token||'')}));
    savePrices(); return null;
  }
  const atIso=new Date().toISOString();
  const offers=(resp.offers||[]).slice(0,12).map(o=>({
    seller:String(o.seller||''), roomName:(o.roomName?String(o.roomName):undefined),
    price:+o.price||0, total:(+o.total>0? +o.total:undefined), cur:o.cur||b.cur||'KRW',
    refundable:o.refundable, breakfast:o.breakfast, link:(typeof o.link==='string'?o.link:undefined),
    vehicleName:(o.vehicleName?String(o.vehicleName):undefined), vehicleClass:(o.vehicleClass?String(o.vehicleClass):undefined),
    transmission:(o.transmission?String(o.transmission):undefined), mileage:(o.mileage?String(o.mileage):undefined),
    insurance:(o.insurance?String(o.insurance):undefined), deposit:(+o.deposit>0? +o.deposit:undefined),
    pickupCode:(o.pickupCode?String(o.pickupCode):undefined), returnCode:(o.returnCode?String(o.returnCode):undefined),
    verified:!!o.verified, verifiedBy:o.verifiedBy
  }));
  offers.forEach(o=>{ o.quality = b.type==='car' ? TC_PRICE.carMatchQuality(b,o) : TC_PRICE.matchQuality(b,o); });
  rec.offers=offers; rec.at=atIso; rec.err=null; delete rec.candidates;
  if(resp.property&&resp.property.token&&b.ptoken!==resp.property.token) b.ptoken=resp.property.token;   // property 매핑 캐시(§23) — 다음부턴 검색 1회 생략, render의 save()로 저장
  // 하루 1점 관측: 확정 후보 우선, 없으면 최저가 — 등급을 함께 남겨 '미확정' 기록임을 구분
  const decided=TC_PRICE.decideSaving(b,offers,{today});
  const top=decided.confirmed? decided.confirmed.offer
    : offers.slice().sort((a,x)=>TC_PRICE.offerPrice(a)-TC_PRICE.offerPrice(x))[0];
  if(top){
    const point={price:TC_PRICE.offerPrice(top), cur:b.cur||'KRW', seller:top.seller, quality:top.quality, verified:!!top.verified, at:atIso};
    const last=rec.obs[rec.obs.length-1];
    if(last&&String(last.at||'').slice(0,10)===atIso.slice(0,10)) rec.obs[rec.obs.length-1]=point;
    else rec.obs.push(point);
    if(rec.obs.length>CFG.maxObs) rec.obs.splice(0,rec.obs.length-CFG.maxObs);
  }
  // 새 확정 절약 기회만 알림 — 같은 가격 반복 알림 금지(§29)
  const st=hotelStateOf(b);
  if(st&&st.state==='SAVING_AVAILABLE'&&st.confirmed){
    const eff=TC_PRICE.offerPrice(st.confirmed.offer);
    if(!rec.alert||eff<rec.alert.price-1){
      rec.alert={price:eff, at:atIso};
      emitSavingOpportunity({bookingId:b.id, title:b.title, sellerName:st.confirmed.offer.seller,
        previousPrice:b.price, newPrice:eff, currency:b.cur||'KRW',
        savingAmount:st.confirmed.saving, savingRate:st.confirmed.rate,
        matchQuality:st.confirmed.offer.quality, verified:!!st.confirmed.offer.verified,
        deepLink:safeUrl(st.confirmed.offer.link||'')||undefined, detectedAt:atIso});
    }
  }
  savePrices();
  pushPriceSnapshot(b, rec, top);
  return {ok:true};
}
let priceBusy=false;
async function checkTripPrices(opts){
  if(viewMode||priceBusy) return;   // 읽기전용 보기 여행의 기록은 쌓지 않는다
  priceBusy=true;
  let changed=false;
  try{ for(const b of tripBookings()){ const r=await checkBookingPrice(b.id,opts); if(r&&r.ok) changed=true; } }
  finally{ priceBusy=false; }
  if(changed) bgRender(()=>{
    render();
    if(document.getElementById('bookingListBg').classList.contains('show')) renderBookingList();
    if(document.getElementById('bookingModalBg').classList.contains('show')&&editingBooking) renderBookingStatusBox(bookingOf(editingBooking));
  });
}

// ── 클라우드 관측 공유 (hotel_price_snapshots, RLS 본인 행) — 서버 cron 기록 + 기기 간 히스토리 병합 ──
let _pxCloudWarned=false;
function pushPriceSnapshot(b, rec, top){
  if(!sb||!user||!top) return;
  sb.from('hotel_price_snapshots').insert({user_id:user.id, trip_client_id:trip().id, booking_id:b.id,
    seller:top.seller, price:TC_PRICE.offerPrice(top), currency:b.cur||'KRW',
    quality:top.quality||'SIMILAR', verified:!!top.verified, ptoken:b.ptoken||null, offers:rec.offers.slice(0,10)})
    .then(({error})=>{ if(error&&!_pxCloudWarned){ _pxCloudWarned=true; reportOperationalError('price.cloud',error); } })
    .catch(()=>{});
}
async function pullPriceSnapshots(){
  if(!sb||!user) return;
  const ids=[]; store.trips.forEach(t=>(t.bookings||[]).forEach(b=>{ if(b.type==='hotel') ids.push(b.id); }));
  if(!ids.length) return;
  try{
    const since=new Date(Date.now()-7*864e5).toISOString();
    const {data,error}=await sb.from('hotel_price_snapshots')
      .select('booking_id,seller,price,currency,quality,verified,offers,observed_at')
      .in('booking_id',ids).gte('observed_at',since).order('observed_at',{ascending:true}).limit(200);
    if(error||!data||!data.length) return;
    let changed=false;
    data.forEach(r=>{
      const rec=recOf(r.booking_id), day=String(r.observed_at).slice(0,10);
      if(!rec.obs.some(o=>String(o.at||'').slice(0,10)===day)){
        rec.obs.push({price:+r.price||0, cur:r.currency||'KRW', seller:r.seller||'', quality:r.quality||'SIMILAR', verified:!!r.verified, at:r.observed_at});
        rec.obs.sort((a,x)=>String(a.at||'').localeCompare(String(x.at||'')));
        changed=true;
      }
      if(Array.isArray(r.offers)&&r.offers.length&&(!rec.at||String(r.observed_at)>String(rec.at))){
        rec.offers=r.offers.slice(0,12); rec.at=r.observed_at; rec.err=null; changed=true;
      }
    });
    if(changed){ savePrices(); render(); }
  }catch(e){}
}

// ── 예약 목록 모달 (여행 단위 절감 대시보드 + 예약별 상태) ──
function renderBookingList(){
  const bookings=tripBookings(), s=tripSavingInfo();
  // 확정·잠재(조건 확인 필요)·실제 절약을 절대 섞지 않는다 (§31)
  document.getElementById('bookingSummary').innerHTML = bookings.length? `<div class="pxSummary">
      <div><span>현재 예약 총액</span><b>₩${fmtMoney(s.booked)}</b></div>
      <div class="pxSaveRow"><span>현재 확정 절약 가능</span><b>${s.confirmed>0?`₩${fmtMoney(s.confirmed)}`:'—'}</b></div>
      ${s.potential>0?`<div class="pxPotRow"><span>조건 확인 필요</span><b>최대 ₩${fmtMoney(s.potential)}</b></div>`:''}
      ${s.actual>0?`<div class="pxActualRow"><span>TripCanvas로 실제 절약</span><b>₩${fmtMoney(s.actual)}</b></div>`:''}
    </div>`:'';
  document.getElementById('bookingListBody').innerHTML = bookings.length? bookings.map(b=>{
    const period=[b.start,b.end].filter(Boolean).map(esc).join(' ~ ');
    const sub=[period, b.provider?esc(b.provider):'', costLabel(b.price,b.cur)].filter(Boolean).join(' · ');
    return `<div class="tripRow pxRow" onclick="openBookingModal('${escAttr(b.id)}')" title="탭해서 상세·판매처 비교·가격 기록 보기">
      <span class="tn">${BK_TYPE[b.type]?BK_TYPE[b.type].icon:'🏨'} ${esc(b.title)}<span class="opt">${sub}</span></span>
      ${bookingBadgeHtml(b)}
    </div>`;
  }).join('') : `<div class="hint" style="padding:14px 4px">아직 등록한 예약이 없어요. 예약한 숙소의 가격을 등록해 두면 출발 전까지 계속 확인해서 더 좋은 조건이 생기면 알려드릴게요.</div>`;
  loadPxHealth().then(h=>{ try{ const el=document.getElementById('pxSourceLine'); if(el) el.innerHTML=pxSourceLineHtml(h); }catch(e){} });   // catch: 문서가 이미 닫힌 뒤 도착한 응답
}
function openBookingList(){
  renderBookingList();
  document.getElementById('bookingListBg').classList.add('show');
  checkTripPrices();   // 열 때 시세 갱신 (신선하면 조회 생략, 완료 시 목록 재렌더)
}
document.getElementById('bookingBtn').onclick=openBookingList;
document.getElementById('bookingListClose').onclick=()=>document.getElementById('bookingListBg').classList.remove('show');
document.getElementById('bookingAdd').onclick=()=>openBookingModal(null);

// 숙소 카드에서 바로 예약 추적 시작 — 이름·연결·기간을 미리 채운다(사용자는 예약가만 넣으면 된다)
// 자동 소스가 없는 현재 예약처(직판 사이트 등) 가격은 사용자가 확인해 기록한다 — 입력만 수동, 판단은 자동.
// 같은 상품의 재확인이므로 quality는 EXACT: 예약가보다 의미 있게 내려가면 기존 엔진이 확정 절약으로 판단한다.
function recordCarManualPrice(id, price){
  const b=bookingOf(id); if(!b||!(price>0)) return false;
  const rec=recOf(id), at=new Date().toISOString(), seller=(b.provider||'현재 예약처');
  rec.offers=(rec.offers||[]).filter(o=>!o.manual);   // 이전 수동 관측 오퍼는 최신 값으로 교체
  rec.offers.push({seller, price, total:price, cur:b.cur||'KRW', quality:'EXACT', verified:false, manual:1,
    link:safeUrl(b.url||'')||undefined});
  rec.obs=rec.obs||[];
  const last=rec.obs[rec.obs.length-1];
  if(!last||String(last.at).slice(0,10)!==at.slice(0,10)||last.price!==price)
    rec.obs.push({price, cur:b.cur||'KRW', seller, quality:'EXACT', verified:false, manual:1, at});
  if(rec.obs.length>TC_PRICE.PRICE_CFG.maxObs) rec.obs=rec.obs.slice(-TC_PRICE.PRICE_CFG.maxObs);
  rec.at=at; rec.err=null; delete rec.candidates;
  savePrices(); return true;
}
window.startHotelTracking=(di,si)=>{
  const s=trip().days[di]&&trip().days[di].spots[si]; if(!s) return;
  openBookingModal(null);
  document.getElementById('bkType').value='hotel'; toggleBkFields();
  document.getElementById('bkTitle').value=s.name||'';
  const idx=bkStayOptions().findIndex(o=>o.s===s);
  if(idx>=0) document.getElementById('bkSpot').value=String(idx);
  const iso=isoDateOf(di);
  if(iso){
    document.getElementById('bkStart').value=iso;
    const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+stayNights(s));
    document.getElementById('bkEnd').value=toISO(d);
  }
  document.getElementById('bkPrice').focus();
};

// ── 예약 추가/상세·편집 모달 ──
let editingBooking=null;   // 예약 id | null(추가)
// 일정에서 🏠 숙소로 등록된 장소들 — 호텔 예약을 일정 카드와 연결하는 선택지
function bkStayOptions(){
  const out=[];
  trip().days.forEach((d,di)=>d.spots.forEach(s=>{ if(s.stay) out.push({di,s}); }));
  return out;
}
// 렌터카 픽업·반납을 붙일 후보 — 일정의 모든 장소 (공항·역처럼 숙소가 아닌 곳에서 받는 게 보통이라 stay로 좁히지 않는다)
function bkAllSpotOptions(){
  const out=[];
  trip().days.forEach((d,di)=>d.spots.forEach((s,si)=>out.push({di,si,s})));
  return out;
}
function fillBkCarSpotSelects(b){
  const opts=bkAllSpotOptions(), links=carSpotLinks(trip().days);
  const build=(/**@type {string}*/selId, /**@type {string}*/kind)=>{
    const cur=b? links[kind][b.id] : null;
    document.getElementById(selId).innerHTML='<option value="">— 연결 안 함 —</option>'+
      opts.map(o=>`<option value="${o.di}.${o.si}"${(cur&&cur.di===o.di&&cur.si===o.si)?' selected':''}>Day ${o.di+1} · ${esc(o.s.name)}</option>`).join('');
  };
  build('bkCarPickupSpot','pickup'); build('bkCarReturnSpot','return');
}
function fillBkSpotSelect(b){
  const opts=bkStayOptions();
  const cur=b? opts.findIndex(o=>o.s.bookingId===b.id):-1;
  document.getElementById('bkSpot').innerHTML='<option value="">— 연결 안 함 —</option>'+
    opts.map((o,i)=>`<option value="${i}" ${i===cur?'selected':''}>Day ${o.di+1} · ${esc(o.s.name)}</option>`).join('');
}
function toggleBkFields(){
  const type=document.getElementById('bkType').value, hotel=type==='hotel';
  document.getElementById('bkSpotWrap').style.display = hotel?'block':'none';
  document.getElementById('bkHotelFields').style.display = hotel?'block':'none';
  document.getElementById('bkCarFields').style.display = type==='car'?'block':'none';
  document.getElementById('bkProviderLabel').textContent = type==='flight'?'항공사 또는 예약처':'예약처';
  document.getElementById('bkTitleLabel').textContent = {hotel:'숙소 이름 * (예약처 표기와 같게 — 검색 정확도)',car:'렌터카 (차종·업체) *',flight:'항공편 (구간·편명) *'}[type]||'예약 이름 *';
  document.getElementById('bkFreeUntilWrap').style.display = document.getElementById('bkFreeCancel').checked?'block':'none';
}
window.openBookingModal=(id)=>{
  if(viewMode){ toast('읽기전용 보기입니다 — "내 여행으로 저장" 후 이용하세요','#8892b0'); return; }
  const b=id? bookingOf(id):null;
  if(id&&!b) return;
  editingBooking=b?b.id:null;
  document.getElementById('bkModalTitle').textContent=b?'예약 상세·편집':'예약 추가';
  document.getElementById('bkDelBtn').style.display=b?'block':'none';
  document.getElementById('bkType').value=b?b.type:'hotel';
  fillBkSpotSelect(b);
  fillBkCarSpotSelects(b);
  document.getElementById('bkTitle').value=b?b.title:'';
  document.getElementById('bkProvider').value=(b&&b.provider)||'';
  document.getElementById('bkPrice').value=b?fmtMoney(b.price):'';
  document.getElementById('bkCur').value=(b&&b.cur)||'KRW';
  document.getElementById('bkStart').value=(b&&b.start)||'';
  document.getElementById('bkEnd').value=(b&&b.end)||'';
  document.getElementById('bkAdults').value=(b&&b.adults)||2;
  document.getElementById('bkRooms').value=(b&&b.rooms)||1;
  document.getElementById('bkRoom').value=(b&&b.roomName)||'';
  document.getElementById('bkBreakfast').value=(b&&b.breakfast===true)?'1':(b&&b.breakfast===false)?'0':'';
  document.getElementById('bkCarPickup').value=(b&&b.carPickup)||'';
  document.getElementById('bkCarPickupCode').value=(b&&b.carPickupCode)||'';
  document.getElementById('bkCarReturn').value=(b&&b.carReturn)||'';
  document.getElementById('bkCarReturnCode').value=(b&&b.carReturnCode)||'';
  document.getElementById('bkCarPickupTime').value=(b&&b.carPickupTime)||'';
  document.getElementById('bkCarReturnTime').value=(b&&b.carReturnTime)||'';
  document.getElementById('bkCarClass').value=(b&&b.carClass)||'';
  document.getElementById('bkCarTrans').value=(b&&b.transmission)||'';
  document.getElementById('bkCarMileage').value=(b&&b.mileage)||'';
  document.getElementById('bkCarIns').value=(b&&b.insurance)||'';
  document.getElementById('bkFreeCancel').checked=!!(b&&(b.refundable!==undefined? b.refundable : b.freeCancelUntil));
  document.getElementById('bkFreeUntil').value=(b&&b.freeCancelUntil)||'';
  document.getElementById('bkFee').value=(b&&b.cancelFee)?fmtMoney(b.cancelFee):'';
  document.getElementById('bkUrl').value=(b&&b.url)||'';
  document.getElementById('bkTrack').checked=b?b.track!==false:true;
  toggleBkFields();
  renderBookingStatusBox(b);
  document.getElementById('bookingModalBg').classList.add('show');
};
// 현재가·판매처 비교·매칭 후보·가격 기록 — 편집 중인 기존 예약에만 표시
function renderBookingStatusBox(b){
  const box=document.getElementById('bkStatus');
  if(!b){ box.innerHTML=''; return; }
  if(b.type==='flight'){
    box.innerHTML=`<div class="pxState pxWatch">🟡 항공 가격 소스는 준비 중 — 지금은 예약 기록용으로 저장돼요</div>`;
    return;
  }
  const rec=priceStore[b.id]||{obs:[],offers:[]}, st=hotelStateOf(b), CFG=TC_PRICE.PRICE_CFG;
  const missing=!b.start||!b.end;
  let head='';
  if(missing) head=`<div class="pxState pxWatch">체크인·체크아웃 날짜를 입력하면 가격 추적을 시작해요</div>`;
  else if(b.start&&b.start<todayISO()) head=`<div class="pxState pxOff">체크인이 지나 가격 추적을 마쳤어요</div>`;
  else if(b.track===false) head=`<div class="pxState pxOff">가격 추적이 꺼져 있어요 — 켜면 시세를 계속 확인합니다</div>`;
  else if(st&&st.state==='SAVING_AVAILABLE'){
    const o=st.confirmed.offer, eff=TC_PRICE.offerPrice(o), link=safeUrl(o.link||'');
    head=`<div class="pxState pxSave">🔴 재예약 시 약 ${costLabel(st.confirmed.saving,b.cur)} 절약 — ${esc(o.seller)} <span class="pxQ pxQok">✓ 동일 조건${o.verified?' 확인됨':''}</span></div>
      <div class="hint">현재 예약 ${costLabel(b.price,b.cur)} → ${esc(o.seller)} ${costLabel(eff,b.cur)}${st.fee?` · 취소 수수료 ${costLabel(st.fee,b.cur)} 반영`:''} — 재예약·기존 예약 취소는 직접 결정하세요</div>
      <div class="pxActions">${link?`<a class="btn" href="${escAttr(link)}" target="_blank" rel="noopener">판매처에서 확인 ↗</a>`:''}<button type="button" class="btn" id="bkRebooked">재예약했어요</button></div>`;
  }
  else if(st&&st.state==='CHEAPER_UNVERIFIED'){
    const o=st.potential.offer, link=safeUrl(o.link||'');
    head=`<div class="pxState pxWarnT">🟠 ${esc(o.seller)}에서 최대 ${costLabel(st.potential.delta,b.cur)} 저렴한 옵션 발견</div>
      <div class="hint">현재 예약과 일부 조건이 다르거나 확인되지 않았어요 — 확정 절약으로 계산하지 않습니다. 아래 비교에서 조건을 확인하세요.</div>
      ${link?`<div class="pxActions"><a class="btn" href="${escAttr(link)}" target="_blank" rel="noopener">판매처에서 확인 ↗</a></div>`:''}`;
  }
  else if(st&&st.state==='GOOD_PRICE') head=`<div class="pxState pxGood">🟢 좋은 가격 — 지금 예약을 유지하세요</div><div class="hint">현재 시세가 관측된 가격 중 최저 수준입니다</div>`;
  else if(st&&st.state==='ERROR'&&b.type==='car'&&st.err&&st.err.code==='AUTH_REQUIRED'){
    head=`<div class="pxState pxWatch">자동 시장 추적 미연결 — 렌터카 가격 API가 아직 연결되지 않았어요</div>
      <div class="hint">아래에서 <b>현재 예약처 가격을 직접 기록</b>하면 최저가 비교·절약 판단은 자동으로 동작합니다</div>`;
  }
  else if(st&&st.state==='ERROR'){ const ec=(st.err&&st.err.code)||'PROVIDER_ERROR';
    const ed=(st.err&&st.err.detail)?` <span class="opt">· ${esc(String(st.err.detail).slice(0,120))}</span>`:'';
    head=`<div class="pxState pxWarnT">⚠️ 현재 가격을 확인하지 못했어요</div><div class="hint">${esc(PX_ERR_MSG[ec]||'')} <span class="opt">(${esc(ec)})</span>${ed}</div>`; }
  else head=`<div class="pxState pxWatch">🟡 가격 추적 중 — 아직 의미 있는 하락이 없어요</div>`;
  // 시세 조회는 1실 기준이라, 2실 이상 예약은 총액이 달라진다 — 절약액을 그대로 믿지 않도록 알린다
  if(b.type==='hotel' && !missing && b.track!==false && (b.rooms||1)>1)
    head+=`<div class="hint">비교 가격은 <b>1실 기준</b>이에요 — 이 예약은 ${b.rooms}실이라 실제 총액은 다를 수 있습니다</div>`;
  // 매칭 후보 — 낮은 신뢰도는 자동 확정하지 않고 사용자가 고른다 (§22)
  const cand=(rec.err&&rec.err.code==='UNMATCHED'&&rec.candidates&&rec.candidates.length)?
    `<label>호텔 자동 매칭이 확실하지 않아요 — 맞는 호텔을 선택해주세요</label><div class="pxHist">`+rec.candidates.map((c,i)=>
      `<div><span>${esc(c.name)}</span><button type="button" class="btn pxPick" data-i="${i}" style="font-size:11px;padding:2px 8px">이 호텔이에요</button></div>`).join('')+`</div>` : '';
  // 판매처별 가격 비교 — 신뢰도(✓ 동일 조건 / 조건 확인 필요)를 반드시 구분 표시 (§16·21)
  const qLabel=o=>{ const q=o.quality||TC_PRICE.matchQuality(b,o);
    return (q==='EXACT'||q==='EQUIVALENT')
      ? `<span class="pxQ pxQok">✓ 동일 조건${o.verified?' 확인됨':''}</span>`
      : (q==='SIMILAR'? `<span class="pxQ pxQask">조건 확인 필요</span>` : `<span class="pxQ">비교 불가</span>`); };
  const offersHtml=(rec.offers||[]).slice(0,6).map(o=>{
    const link=safeUrl(o.link||'');
    const carMeta=(b.type==='car')?[o.vehicleName||o.vehicleClass,o.transmission,o.mileage,o.insurance].filter(Boolean).join(' · '):'';
    return `<div><span>${esc(o.seller)}${o.roomName?` <span class="opt">${esc(o.roomName)}</span>`:''}${carMeta?` <span class="opt">${esc(carMeta)}</span>`:''}</span>
      <span class="pxOfferR"><b>${costLabel(TC_PRICE.offerPrice(o),b.cur)}</b> ${qLabel(o)}${link?` <a href="${escAttr(link)}" target="_blank" rel="noopener" title="판매처에서 확인">↗</a>`:''}</span></div>`;
  }).join('');
  // 마지막 확인 시각 — 오래됨·실패를 그대로 알린다 (§33·36)
  let checkedLine='';
  if(rec.at){
    const ageH=(Date.now()-Date.parse(rec.at))/3600e3;
    checkedLine=`<div class="hint">마지막 가격 확인 ${fmtDT(rec.at)}${ageH>CFG.staleNoticeHours?' — <b>가격 정보가 오래되었습니다</b>':''}${rec.err?` · 최근 재확인 실패 — 마지막 성공 조회 기준으로 표시 중`:''}</div>`;
  } else if(rec.err&&rec.err.code!=='UNMATCHED') checkedLine=`<div class="hint">아직 성공한 가격 조회가 없어요 (${fmtDT(rec.err.at)} 시도)</div>`;
  const hist=(rec.obs||[]).slice(-8).reverse().map(o=>
    `<div><span>${esc(String(o.at||'').slice(5,10).replace('-','/'))} · ${esc(o.seller||o.provider||'')}${(o.quality&&o.quality!=='EXACT'&&o.quality!=='EQUIVALENT')?' <span class="pxQ pxQask">미확정</span>':''}</span><b>${costLabel(o.price,o.cur)}</b></div>`).join('');
  box.innerHTML=`${head}
    ${b.freeCancelUntil?`<div class="hint">무료 취소 ${esc(b.freeCancelUntil)}까지${todayISO()<=b.freeCancelUntil?'':' — 기한이 지나 취소 수수료가 적용됩니다'}</div>`:''}
    ${cand}
    ${offersHtml?`<label>💱 판매처별 가격 비교</label><div class="pxHist pxOffers">${offersHtml}</div>`:''}
    ${checkedLine}
    ${hist?`<label>📈 가격 기록 (하루 1점, 최근 ${Math.min((rec.obs||[]).length,8)}회)</label><div class="pxHist">${hist}</div>`:''}
    ${(b.type==='car'&&b.track!==false&&!missing)?(()=>{
      const bu=safeUrl(b.url||'');
      const lastManual=(rec.obs||[]).filter(o=>o.manual).pop();
      const staleDays=lastManual? Math.floor((Date.now()-Date.parse(lastManual.at))/86400e3) : null;
      return `<label>현재 예약처 가격 다시 확인 <span class="hint" style="margin:0">— 자동 조회가 안 되는 예약처(직판 사이트 등)는 직접 확인해 기록</span></label>
      ${staleDays!=null&&staleDays>=7?`<div class="hint">⏰ ${esc(b.provider||'예약처')} 가격을 확인한 지 ${staleDays}일이 지났습니다</div>`:''}
      <div class="pxActions" style="align-items:center">${bu?`<a class="btn" href="${escAttr(bu)}" target="_blank" rel="noopener">예약 사이트 열기 ↗</a>`:''}
        <input type="text" id="bkManualPrice" inputmode="numeric" placeholder="확인한 총액" style="width:110px">
        <button type="button" class="btn" id="bkManualSave">가격 기록</button></div>`;
    })():''}
    ${(b.track!==false&&!missing)?`<button type="button" class="btn" id="bkCheckNow" style="margin-top:8px;font-size:11px;padding:3px 10px">🔄 ${b.type==='car'?'시장 가격 다시 검색':'현재 가격 다시 확인'}</button>`:''}
    <div class="hint" id="bkSourceLine"></div>`;
  loadPxHealth().then(h=>{ try{ const el=document.getElementById('bkSourceLine'); if(el) el.innerHTML=pxSourceLineHtml(h); }catch(e){} });
  const ms=document.getElementById('bkManualSave');
  if(ms) ms.onclick=()=>{
    const v=parseInt((document.getElementById('bkManualPrice').value||'').replace(/[^\d]/g,''));
    if(!(v>0)){ toast('확인한 가격을 입력하세요','#e63946'); return; }
    recordCarManualPrice(b.id, v);
    toast('가격을 기록했어요 — 예약가와 비교해 판단합니다');
    renderBookingStatusBox(bookingOf(b.id)); render();
  };
  const btn=document.getElementById('bkCheckNow');
  if(btn) btn.onclick=async()=>{
    btn.disabled=true; btn.textContent='확인 중…';
    const r=await checkBookingPrice(b.id,{force:true});
    if(r&&r.cooldown) toast(`조금 전에 이미 확인했어요 — ${CFG.cooldownMin}분에 한 번만 조회합니다 (저장된 최신 값 표시 중)`,'#8892b0');
    renderBookingStatusBox(bookingOf(b.id)); render();
  };
  const reb=document.getElementById('bkRebooked');
  if(reb&&st&&st.confirmed) reb.onclick=()=>{
    const o=st.confirmed.offer, eff=TC_PRICE.offerPrice(o);
    if(!confirm(`${o.seller}에서 ${costLabel(eff,b.cur)}(으)로 재예약을 완료하셨나요?\n예약가를 갱신하고 절약액을 기록합니다. (기존 예약 취소는 직접 확인하세요)`)) return;
    commit(()=>{ b.saved=(b.saved||0)+Math.max(0,b.price-eff); b.price=eff; b.provider=o.seller; b.updatedAt=new Date().toISOString(); });
    const rec2=recOf(b.id); delete rec2.alert; savePrices();
    renderBookingStatusBox(bookingOf(b.id));
    if(document.getElementById('bookingListBg').classList.contains('show')) renderBookingList();
    toast('재예약 기록됨 — 새 가격을 기준으로 계속 추적해요 🎉');
  };
  box.querySelectorAll('.pxPick').forEach(el=>el.onclick=async()=>{
    const c=(rec.candidates||[])[+el.dataset.i]; if(!c||!c.token) return;
    commit(()=>{ b.ptoken=c.token; });
    delete rec.err; delete rec.candidates; savePrices();
    el.disabled=true; el.textContent='확인 중…';
    await checkBookingPrice(b.id,{force:true});
    renderBookingStatusBox(bookingOf(b.id)); render();
  });
}
document.getElementById('bkType').onchange=toggleBkFields;
document.getElementById('bkFreeCancel').onchange=toggleBkFields;
// 숙소 연결 선택 → 새 예약이면 이름·기간·인원·통화 프리필 (기존 예약의 연결 변경은 값 유지)
document.getElementById('bkSpot').onchange=()=>{
  if(editingBooking) return;
  const o=bkStayOptions()[+document.getElementById('bkSpot').value];
  if(!o) return;
  const t=document.getElementById('bkTitle'); if(!t.value.trim()) t.value=o.s.name;
  const iso=isoDateOf(o.di);
  if(iso){
    const st=document.getElementById('bkStart'); if(!st.value) st.value=iso;
    const en=document.getElementById('bkEnd');
    if(!en.value){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+stayNights(o.s)); en.value=toISO(d); }
  }
  if(o.s.cur) document.getElementById('bkCur').value=o.s.cur;
  if(o.s.cost&&!document.getElementById('bkPrice').value) document.getElementById('bkPrice').value=fmtMoney(o.s.cost);
};
['bkPrice','bkFee'].forEach(id=>document.getElementById(id).addEventListener('input',function(){
  const d=this.value.replace(/[^\d]/g,''); this.value=d?(+d).toLocaleString('en-US'):'';
}));
document.getElementById('bkCancel').onclick=()=>document.getElementById('bookingModalBg').classList.remove('show');
document.getElementById('bkSave').onclick=()=>{
  const title=document.getElementById('bkTitle').value.trim();
  const price=parseInt(document.getElementById('bkPrice').value.replace(/[^\d]/g,''));
  if(!title){ toast('예약 이름을 입력하세요','#e63946'); return; }
  if(isNaN(price)||price<=0){ toast('예약 가격을 입력하세요','#e63946'); return; }
  const type=document.getElementById('bkType').value;
  const sv=document.getElementById('bkStart').value, ev=document.getElementById('bkEnd').value;
  if(type==='hotel'&&document.getElementById('bkTrack').checked&&(!sv||!ev)){ toast('가격 추적에는 체크인·체크아웃 날짜가 필요해요','#e63946'); return; }
  if(sv&&ev){
    if(type==='car'){
      // 당일 대여는 정상이다 — 같은 날이면 시각이 앞뒤를 가른다 (시세 조회도 pickupAt<returnAt만 본다)
      if(sv>ev){ toast('반납일이 픽업일보다 앞설 수 없어요','#e63946'); return; }
      if(sv===ev){
        const HM=/^([01]?\d|2[0-3]):[0-5]\d$/;
        const pt=document.getElementById('bkCarPickupTime').value.trim(), rt=document.getElementById('bkCarReturnTime').value.trim();
        if(!HM.test(pt)||!HM.test(rt)||parseHM(pt)>=parseHM(rt)){
          toast('당일 대여는 픽업 시각과 그보다 늦은 반납 시각이 필요해요','#e63946'); return; }
      }
    }
    else if(sv>=ev){ toast('체크아웃은 체크인보다 뒤여야 해요','#e63946'); return; }   // 역순·같은 날이면 시세 조회가 거부된다
  }
  const isNew=!editingBooking;
  const b=isNew? {id:uid(), createdAt:new Date().toISOString()} : bookingOf(editingBooking);
  if(!b) return;
  const fee=parseInt(document.getElementById('bkFee').value.replace(/[^\d]/g,''));
  const curV=document.getElementById('bkCur').value;
  const identityChanged = b.start!==(sv||undefined)||b.end!==(ev||undefined)||b.title!==title;
  commit(()=>{
    b.type=type;
    b.title=title;
    b.provider=document.getElementById('bkProvider').value.trim();
    b.url=document.getElementById('bkUrl').value.trim();
    b.price=price;
    if(curV&&curV!=='KRW') b.cur=curV; else delete b.cur;   // KRW는 기본값이라 생략 (스팟 cur와 동일 규칙)
    if(sv) b.start=sv; else delete b.start;
    if(ev) b.end=ev; else delete b.end;
    if(type==='hotel'){
      b.adults=Math.min(8,Math.max(1,parseInt(document.getElementById('bkAdults').value)||2));
      b.rooms=Math.min(4,Math.max(1,parseInt(document.getElementById('bkRooms').value)||1));
      const rn=document.getElementById('bkRoom').value.trim();
      if(rn) b.roomName=rn; else delete b.roomName;
      const bf=document.getElementById('bkBreakfast').value;
      if(bf==='1') b.breakfast=true; else if(bf==='0') b.breakfast=false; else delete b.breakfast;
    }
    if(type==='car'){
      const cv=(/**@type {string}*/id)=>document.getElementById(id).value.trim();
      const put=(/**@type {string}*/k,/**@type {string}*/v)=>{ if(v) (/**@type {any}*/(b))[k]=v; else delete (/**@type {any}*/(b))[k]; };
      put('carPickup',cv('bkCarPickup')); put('carPickupCode',cv('bkCarPickupCode').toUpperCase());
      put('carReturn',cv('bkCarReturn')); put('carReturnCode',cv('bkCarReturnCode').toUpperCase());
      put('carPickupTime',cv('bkCarPickupTime')); put('carReturnTime',cv('bkCarReturnTime'));
      put('carClass',document.getElementById('bkCarClass').value);
      put('transmission',document.getElementById('bkCarTrans').value);
      put('mileage',document.getElementById('bkCarMileage').value);
      put('insurance',document.getElementById('bkCarIns').value);
    }
    b.refundable=document.getElementById('bkFreeCancel').checked;   // 조건 매칭·수수료 계산의 기준
    const fu=b.refundable && document.getElementById('bkFreeUntil').value;
    if(fu) b.freeCancelUntil=fu; else delete b.freeCancelUntil;
    if(!isNaN(fee)&&fee>0) b.cancelFee=fee; else delete b.cancelFee;
    b.track=document.getElementById('bkTrack').checked;
    b.updatedAt=new Date().toISOString();
    if(identityChanged) delete b.ptoken;   // 이름·기간이 바뀌면 property 매핑을 다시 찾는다
    if(isNew) (trip().bookings=trip().bookings||[]).push(b);
    // 숙소 연결: 이 예약을 가리키던 이전 연결을 풀고 새로 연결 (호텔이 아니면 연결 없음)
    trip().days.forEach(d=>d.spots.forEach(s=>{ if(s.bookingId===b.id) delete s.bookingId;
      if(s.carPickupId===b.id) delete s.carPickupId; if(s.carReturnId===b.id) delete s.carReturnId; }));
    const o=bkStayOptions()[+document.getElementById('bkSpot').value];
    if(o&&b.type==='hotel') o.s.bookingId=b.id;
    // 렌터카 픽업·반납 지점 연결 — 연결된 장소 행에 붙여 도착 순서와 어긋나지 않게 한다
    if(b.type==='car'){
      const link=(/**@type {string}*/selId, /**@type {string}*/field)=>{
        const v=document.getElementById(selId).value; if(!v) return;
        const p=v.split('.'), sp=(trip().days[+p[0]]||{spots:[]}).spots[+p[1]];
        if(sp) sp[field]=b.id;
      };
      link('bkCarPickupSpot','carPickupId'); link('bkCarReturnSpot','carReturnId');
    }
  });
  document.getElementById('bookingModalBg').classList.remove('show');
  if(document.getElementById('bookingListBg').classList.contains('show')) renderBookingList();
  toast(b.track&&b.type==='hotel'?'예약 저장됨 — 가격 추적을 시작해요':'예약 저장됨');
  if(b.track) checkBookingPrice(b.id,{force:true}).then(r=>{
    if(!r||!r.ok) return;
    render();
    if(document.getElementById('bookingListBg').classList.contains('show')) renderBookingList();
  });
};
document.getElementById('bkDelBtn').onclick=()=>{
  const b=bookingOf(editingBooking); if(!b) return;
  if(!confirm(`"${b.title}" 예약 추적을 삭제할까요? (실제 예약이 취소되지는 않아요)`)) return;
  const snap=snapshot();
  commit(()=>{
    trip().bookings=tripBookings().filter(x=>x.id!==b.id);
    if(!trip().bookings.length) delete trip().bookings;
    trip().days.forEach(d=>d.spots.forEach(s=>{ if(s.bookingId===b.id) delete s.bookingId;
      if(s.carPickupId===b.id) delete s.carPickupId; if(s.carReturnId===b.id) delete s.carReturnId; }));
  });
  delete priceStore[b.id]; savePrices();
  document.getElementById('bookingModalBg').classList.remove('show');
  if(document.getElementById('bookingListBg').classList.contains('show')) renderBookingList();
  toast('예약 추적 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};

// ───────────────── 내보내기/가져오기/공유 ─────────────────
document.getElementById('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(trip(),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=trip().name.replace(/\s+/g,'_')+'.json'; a.click();
};
document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
let _importing=false;   // 가져오기 진행 중 — PWA 자동 새로고침이 이 사이에 끼어들어 유실되지 않게
document.getElementById('importFile').onchange=e=>{
  const f=e.target.files[0]; if(!f)return;
  if(f.size>TC_LIMITS.jsonBytes){ toast('파일이 너무 큽니다 (최대 2MB)','#e63946'); e.target.value=''; return; }
  const rd=new FileReader();
  _importing=true;
  rd.onload=()=>{
    try{
      const result=parseTripPayload(typeof rd.result==='string'?rd.result:'');
      if(!result.ok) throw new Error(result.error);
      const t=result.value;
      t.id=uid(); commit(()=>{ store.trips.push(t); store.activeId=t.id; activeDay=0; }, {fit:fitEntry}); toast('가져오기 완료');
    }catch(err){ reportOperationalError('import.invalid',err); toast('안전하게 읽을 수 없는 여행 파일입니다','#e63946'); }
    finally{ _importing=false; }
  };
  rd.onerror=()=>{ _importing=false; reportOperationalError('import.read',rd.error); toast('파일을 읽지 못했습니다','#e63946'); };
  rd.readAsText(f); e.target.value='';
};
// ── 일정 이미지 내보내기 (PNG, html2canvas 지연 로드) ──
let _h2cReady=null;
function loadH2C(){
  if(_h2cReady!==null) return _h2cReady;
  _h2cReady=new Promise(res=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.integrity='sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H'; s.crossOrigin='anonymous';
    s.onload=()=>res(true); s.onerror=()=>res(false);
    document.head.appendChild(s);
  });
  return _h2cReady;
}
function buildTripCard(){
  const t=trip(), colors=cityColors();
  const w=document.createElement('div');
  w.style.cssText="position:fixed;left:-10000px;top:0;width:520px;background:#141b33;color:#e8e8f0;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:24px";
  let html=`<div style="font-size:20px;font-weight:800;margin-bottom:2px">🗺 ${esc(t.name)}</div>`;
  if(t.start) html+=`<div style="font-size:12px;color:#9aa5c4;margin-bottom:14px">${esc(t.start)} 출발 · ${t.days.length}일</div>`;
  t.days.forEach((day,di)=>{
    const c=colorByMode()==='day'?dayColor(di):(day.spots.length?(colors[day.spots[0].city]||'#556'):'#556');
    const etas=dayEtas(day, startAnchorFor(di));   // 이미지 ETA도 anchor 기준(사이드바와 동일)
    html+=`<div style="border-left:4px solid ${c};background:#1f2b4d;border-radius:10px;padding:10px 14px;margin-bottom:10px">`;
    html+=`<div style="font-size:13.5px;font-weight:700">Day ${di+1} · ${esc(day.title)} <span style="color:#9aa5c4;font-weight:400;font-size:11px">${dateOf(di)}</span></div>`;
    if(day.drive) html+=`<div style="font-size:11px;color:#f6bd60;margin-top:3px">${esc(day.drive)}</div>`;
    const carEv=carEventsOn(t.bookings||[], isoDateOf(di));   // 렌터카 픽업·반납 (사이드바와 같은 기준)
    const carLine=(/**@type {any}*/e)=>`<div style="font-size:12px;margin-top:5px;color:#9aa5c4">🚗 ${esc(carEventPlaceLabel(e))} <span style="font-size:10.5px">(렌터카 ${e.kind==='pickup'?'픽업':'반납'}${e.time?` ${esc(e.time)}`:''})</span></div>`;
    html+=carEv.filter(e=>e.kind==='pickup').map(carLine).join('');
    day.spots.forEach((s,si)=>{
      html+=`<div style="font-size:12px;margin-top:5px"><span style="color:#f6bd60;font-weight:700;font-size:10.5px">${hm(etas[si])}</span> ${si+1}. ${catPrefix(s)}${esc(s.name)}${s.opt?' <span style="color:#8892b0;font-size:10.5px">(선택)</span>':''}</div>`;
    });
    html+=carEv.filter(e=>e.kind==='return').map(carLine).join('');
    const back=dayReturnStay(t.days,di);   // 하루의 끝 — 숙소 복귀 (화면과 같은 기준)
    if(back) html+=`<div style="font-size:12px;margin-top:5px;color:#9aa5c4">🏠 ${esc(back.name)} <span style="font-size:10.5px">(숙소 복귀)</span></div>`;
    if(day.note) html+=`<div style="font-size:10.5px;color:#9aa5c4;margin-top:6px;white-space:pre-wrap">📝 ${esc(day.note)}</div>`;
    html+='</div>';
  });
  html+='<div style="font-size:10px;color:#5a6690;text-align:right">made with Trip Canvas</div>';
  w.innerHTML=html;
  return w;
}
document.getElementById('imgBtn').onclick=async()=>{
  toast('이미지 생성 중…','#1d6fd6');
  if(!(await loadH2C())){ toast('이미지 모듈 로드 실패 — 네트워크 확인','#e63946'); return; }
  const card=buildTripCard();
  document.body.appendChild(card);
  try{
    const canvas=await html2canvas(card,{backgroundColor:'#141b33',scale:2});
    const a=document.createElement('a');
    a.href=canvas.toDataURL('image/png');
    a.download=trip().name.replace(/\s+/g,'_')+'.png';
    a.click();
    toast('이미지가 저장되었습니다');
  }catch(e){ toast('이미지 생성 실패','#e63946'); }
  finally{ card.remove(); }
};
document.getElementById('shareBtn').onclick=()=>{
  const data=LZString.compressToEncodedURIComponent(JSON.stringify(trip()));
  const url=location.origin+location.pathname+'#v='+data;   // 읽기전용 보기 링크
  if(url.length>8000){ toast('여행이 너무 커서 링크로 공유할 수 없습니다. "내보내기"로 파일을 전달하세요','#e63946'); return; }
  navigator.clipboard.writeText(url).then(()=>toast('읽기전용 공유 링크가 복사되었습니다 (받는 쪽에서 "내 여행으로 저장" 가능)'))
    .catch(()=>prompt('이 링크를 복사하세요',url));
};
function decodeSharedTrip(encoded){
  if(typeof encoded!=='string'||encoded.length>TC_LIMITS.shareChars) return {ok:false,error:'공유 링크가 허용 길이를 초과했습니다'};
  try{
    const text=LZString.decompressFromEncodedURIComponent(encoded);
    if(typeof text!=='string'||text.length>TC_LIMITS.jsonBytes) return {ok:false,error:'공유 데이터가 허용 크기를 초과했습니다'};
    return parseTripPayload(text);
  }catch(_){ return {ok:false,error:'공유 링크를 해석할 수 없습니다'}; }
}
// 읽기전용 보기에서 내 저장소로 복사
document.getElementById('roSave').onclick=()=>{
  if(!viewMode) return;
  const t=JSON.parse(JSON.stringify(viewMode));
  t.id=uid(); t.name=t.name||'공유된 여행';
  viewMode=null; document.body.classList.remove('readonly');
  document.getElementById('roBar').style.display='none';
  history.replaceState(null,'',location.pathname);
  commit(()=>{ store.trips.push(t); store.activeId=t.id; activeDay=0; }, {fit:fitEntry}); toast('내 여행으로 저장되었습니다');
};
// 공유 링크로 열었을 때 — #v= 읽기전용 보기 / #t= 구버전(즉시 저장) 호환
(function(){
  load(); loadCfg(); loadFx();
  const h=location.hash;
  if(h.startsWith('#v=')){
    try{
      const result=decodeSharedTrip(h.slice(3)), t=result.ok&&result.value;
      if(t){
        t.name=(t.name||'공유된 여행');
        viewMode=t;
        document.body.classList.add('readonly');
        document.getElementById('roBar').style.display='flex';
        setTimeout(()=>toast('읽기전용으로 보는 중입니다'),400);
      }else reportOperationalError('share.invalid',new Error('validation'));
    }catch(e){ reportOperationalError('share.decode',e); }
  }else if(h.startsWith('#t=')){
    try{
      const result=decodeSharedTrip(h.slice(3)), t=result.ok&&result.value;
      if(t){
        t.id=uid(); t.name=(t.name||'공유된 여행');
        store.trips.push(t); store.activeId=t.id; save();
        history.replaceState(null,'',location.pathname);
        setTimeout(()=>toast('공유된 여행을 불러왔습니다'),400);
      }else reportOperationalError('share.legacy.invalid',new Error('validation'));
    }catch(e){ reportOperationalError('share.legacy.decode',e); }
  }
})();

// ───────────────── 붙여넣기 초안 (AI on/off) ─────────────────
const CFG_KEY='tripcanvas_cfg';
let cfg={aiParse:false, apiKey:'', model:'claude-sonnet-5'};
function loadCfg(){ try{ Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY))||{}); }catch(e){} }
function saveCfg(){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const DIRECT_PLACEHOLDER=`여행이름: 다롄 2박3일
시작일: 2026-07-15

[Day 1] 다롄 도착
이동: ✈️ 인천 → 다롄
- @13:00 성해광장 | 다롄 | 점심 후 도착
- (선택) 러시아 거리 | 다롄 | 입장 ¥500

[Day 2] 시내
- 여순 감옥 | 다롄 | 25000원`;
const AI_PLACEHOLDER=`예) 다다음주 다롄 2박3일 갈 거야. 첫날 오후 인천서 출발해서 성해광장이랑 러시아거리 야경 보고, 둘째날은 여순감옥이랑 노호탄공원, 셋째날 오전에 시장 구경하고 귀국.`;

// ── 장소검색 라우터: 국내=카카오 로컬, 해외=Google Places ──
// 카카오 SDK 지연 로드 (services 라이브러리만 사용, 지도는 구글)
let _kakaoReady=null;
function loadKakao(){
  if(_kakaoReady!==null) return _kakaoReady;
  _kakaoReady=new Promise(res=>{
    const s=document.createElement('script');
    s.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services&autoload=false`;
    s.onload=()=>{ try{ kakao.maps.load(()=>res(true)); }catch(e){ res(false); } };
    s.onerror=()=>res(false);
    document.head.appendChild(s);
  });
  return _kakaoReady;
}
// 카카오 키워드 검색 → [{name,addr,lat,lng}] (실패/무결과 시 [])
// near가 있으면 20km 반경 우선, 비면 전국 재검색 (호출측 거리 가드가 오매칭 차단)
// ── 검색 오류 분류·안내 (인증/할당량/네트워크/무결과 구분) ──
// 운영자용 상세(코드·원문)는 콘솔에만 남기고, 사용자에겐 짧은 재시도 안내만 보여준다.
function classifySearchErr(e){
  const m=(((e&&(e.message||e.code))||e||'')+'').toLowerCase();
  if(/failed to fetch|networkerror|network error|load failed|timeout/.test(m)) return 'network';
  if(/quota|over_query|resource_exhausted|rate limit|too many/.test(m)) return 'quota';
  if(/denied|not authorized|unauthorized|forbidden|api ?key|permission|referer|referrer|invalid key/.test(m)) return 'auth';
  return 'error';
}
const SEARCH_ERR_MSG={
  auth:'검색 키 인증·권한 문제예요 — 관리자 확인이 필요합니다',
  quota:'검색 사용량 한도를 넘었어요 — 잠시 후 다시 시도해주세요',
  network:'네트워크 오류예요 — 연결을 확인하고 다시 시도해주세요',
  error:'검색에 실패했어요 — 다시 시도하거나 지도 클릭으로 지정해주세요'
};
// 동일 검색 단기 캐시(2분) — 같은 질의 반복·연타 시 재호출 방지(오류는 캐시 안 함 → 재시도 가능)
const _searchCache={}; const SEARCH_TTL=120000;
// 카카오 키워드 검색 → {list, err}. ZERO_RESULT(진짜 무결과)와 오류를 구분한다.
async function kakaoSearch(q, near, limit){
  if(!(await loadKakao())) return {list:[], err:'network'};   // SDK 로드 실패(네트워크/도메인 제한)
  const run=opts=>new Promise(res=>{
    try{
      new kakao.maps.services.Places().keywordSearch(q,(data,status)=>{
        const S=kakao.maps.services.Status;
        if(status===S.OK && data) return res({list:data.map(d=>({name:d.place_name, addr:d.road_address_name||d.address_name||'', city:cityFromKoreanAddr(d.address_name||d.road_address_name||''), lat:+d.y, lng:+d.x, cat:catFromKakao(d.category_group_code)||undefined})), err:null});
        if(status===S.ZERO_RESULT) return res({list:[], err:null});   // 진짜 결과 없음(오류 아님)
        console.warn('kakao 검색 오류 status:', status);
        res({list:[], err:'error'});
      },opts);
    }catch(e){ console.warn('kakao 검색 예외:', e); res({list:[], err:'error'}); }
  });
  const size=Math.min(limit||5,15);
  if(near){
    const r=await run({size, location:new kakao.maps.LatLng(near.lat,near.lng), radius:20000});
    if(r.list.length) return r;
  }
  return run({size});
}
// Google Places 텍스트 검색 (신 API) → [{name,addr,lat,lng}]
// 구글 Place 영업시간(regularOpeningHours.periods) → {d:요일0=일,o:분,c:분}[] 정규화 (24/7은 d:-1)
function normHours(oh){
  const ps=oh&&oh.periods; if(!ps||!ps.length) return null;
  const out=[];
  for(const p of ps){
    if(p.open && !p.close){ return [{d:-1,o:0,c:1440}]; }   // 상시영업
    if(!p.open||!p.close) continue;
    out.push({d:p.open.day, o:p.open.hour*60+p.open.minute, c:p.close.hour*60+p.close.minute});
  }
  return out.length?out:null;
}
// Google Places 텍스트 검색 → {list, err}. 오류는 분류해 코드로 반환(콘솔엔 원문).
async function googlePlaces(q, near, limit){
  if(!map) return {list:[], err:'network'};   // 지도 SDK 미로드
  try{
    const {Place}=await google.maps.importLibrary('places');
    const req={textQuery:q, fields:['id','displayName','formattedAddress','addressComponents','location','regularOpeningHours','primaryType','types'], maxResultCount:limit||5, language:'en'};   // 해외 장소는 영문명 · 타입은 카테고리 분류용
    if(near) req.locationBias={center:near, radius:30000};
    const {places}=await Place.searchByText(req);
    return {list:(places||[]).map(p=>({name:placeName(p), addr:p.formattedAddress||'', city:cityFromGoogle(p.addressComponents),
      lat:p.location.lat(), lng:p.location.lng(), hours:normHours(p.regularOpeningHours), placeId:p.id||undefined,
      cat:catFromGoogle(p.types, p.primaryType)||undefined})), err:null};   // placeId: 호텔 identity 매칭용(§3)
  }catch(e){ const code=classifySearchErr(e); console.warn('Places 검색 오류['+code+']:', (e&&e.message)||e); return {list:[], err:code}; }
}
// 도시명 → 앵커 좌표 (Google Geocoder, 전 세계) — 캐시
const _cityAnchor={};
function cityAnchorOf(city){
  if(!city) return Promise.resolve(null);
  if(city in _cityAnchor) return Promise.resolve(_cityAnchor[city]);
  return new Promise(res=>{
    if(!map) return res(null);
    new google.maps.Geocoder().geocode({address:city},(r,st)=>{
      const a=(st==='OK'&&r&&r[0])?{lat:r[0].geometry.location.lat(),lng:r[0].geometry.location.lng()}:null;
      _cityAnchor[city]=a; res(a);
    });
  });
}
// 질의 하나를 라우팅해 검색 (국내 앵커면 카카오 우선→구글 폴백, 해외면 구글)
// 결과 배열을 반환하되, 결과가 없을 땐 배열에 .err(오류코드)를 실어 '무결과'와 '오류'를 구분하게 한다.
async function routedSearch(q, near, limit){
  const korean = near? inKorea(near) : /[가-힣]/.test(q);
  let err=null;
  if(korean){
    const k=await kakaoSearch(q, near, limit);
    if(k.list.length) return k.list;
    err=k.err;
  }
  const g=await googlePlaces(q, near, limit);
  if(g.list.length) return g.list;
  const out=[]; out.err=g.err||err||null;   // 무결과면 err=null, 실패면 코드
  return out;
}
// 장소 하나의 좌표 탐색 — 도시 앵커에서 지나치게 먼 결과는 배제(오매칭 방지), 못 찾으면 null
async function geocodeSpot(s){
  const anchor=await cityAnchorOf(s.city);
  const cand=[`${s.name} ${s.city||''}`.trim(), s.name];
  const simp=simplifyName(s.name); if(simp && simp!==s.name) cand.push(simp);
  const seen=new Set();
  for(const q of cand){
    const qq=(q||'').trim(); if(!qq||seen.has(qq)) continue; seen.add(qq);
    const r=(await routedSearch(qq, anchor, 1))[0];
    if(r && (!anchor || haversine(anchor,r)<=150)) return {lat:r.lat, lng:r.lng};
  }
  return null;
}

// 직접 형식 → 구조화 (AI 불필요)

// 자연어 → 구조화 (Claude API, 브라우저 직접 호출)
async function parseAI(text){
  if(!cfg.apiKey) throw new Error('AI 파싱을 쓰려면 API 키를 입력해줘');
  const system=`너는 여행 일정 파서다. 사용자의 자유로운 여행 설명을 받아 JSON으로만 변환해라.
스키마: {"name":string,"start":"YYYY-MM-DD"|null,"days":[{"title":string,"mode":"car"|"taxi"|"transit"|"train"|"walk"|"bike"|"flight","startAt":"HH:MM"|null,"drive":string,"note":string,"spots":[{"name":string,"city":string,"desc":string,"opt":boolean,"stay":boolean,"legMode":"car"|"taxi"|"transit"|"train"|"walk"|"bike"|"flight"|null,"at":"HH:MM"|null,"stayMin":number|null,"cost":number|null,"cur":"KRW"|"USD"|"EUR"|"JPY"|"CNY","bookAt":"HH:MM"|null,"lat":number|null,"lng":number|null}]}]}
- stay는 숙소(호텔·에어비앤비 등)면 true.
- mode는 그날 주 이동수단: 렌터카/자차=car, 택시=taxi, 지하철·버스=transit, 기차·고속철(KTX·AVE·신칸센)=train, 비행기=flight, 걷기=walk, 자전거=bike. 언급 없으면 "car".
- legMode는 특정 구간만 수단이 다를 때 그 '도착 장소'에 지정(예: 공항→도심만 기차면 도심 장소에 "train"). 대개 null.
- startAt은 그날 시작 시각(예 "KTX 9시 출발"→"09:00"). 없으면 null.
- at은 '도착 시각 고정'(내가 정하는 계획): 그 시각에 도착하도록 못박고 싶을 때(예 "점심 12시"→"12:00", "3시에 도착"→"15:00"). 없으면 null.
- at과 bookAt 구분: at=내가 정한 도착 계획, bookAt=상대가 정한 약속(예매·공연·투어처럼 시각이 외부에서 정해진 것). 둘 다 24시간 표기 "HH:MM".
- stayMin은 장소 체류시간(분). "알함브라 3시간"→180, "1시간"→60. 언급 없으면 null.
- cost는 예상 비용 숫자만(통화는 cur). "입장료 2만원"→20000, "$50"→50, "5000엔"→5000. 없으면 null.
- cur는 cost의 통화: "달러/$"→"USD", "유로/€"→"EUR", "엔/¥"→"JPY", "위안/元"→"CNY", 그 외(원 포함)→"KRW".
- bookAt은 '예약·입장 시각'(상대가 정한 약속 — 예매·공연·투어·식당 예약). 예 "나스르궁 14시 입장"→"14:00". 없으면 null.
- 모든 텍스트 필드는 한국어.
- 각 장소의 실제 위도/경도를 네 지식으로 채워라. 확실하지 않으면 lat/lng를 null로 둬라.
- drive는 그날 이동 정보(예: "✈️ 인천 → 다롄"), note는 그날의 팁/메모. 없으면 빈 문자열.
- opt는 "가면 좋은" 선택 코스면 true, 필수면 false.
- JSON 외의 설명·인사·코드펜스를 절대 출력하지 마라.`;
  const r=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'content-type':'application/json','x-api-key':cfg.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({model:cfg.model,max_tokens:4000,system,messages:[{role:'user',content:text}]})
  });
  if(!r.ok){ const t=await r.text().catch(()=>''); throw new Error(`API 오류 ${r.status} · ${t.slice(0,120)}`); }
  const data=await r.json();
  let txt=(data.content?.[0]?.text||'').trim();
  const a=txt.indexOf('{'), b=txt.lastIndexOf('}');
  if(a>=0&&b>a) txt=txt.slice(a,b+1);
  return JSON.parse(txt);
}

function openPaste(){
  document.getElementById('aiToggle').checked=cfg.aiParse;
  document.getElementById('apiKey').value=cfg.apiKey||'';
  document.getElementById('apiModel').value=cfg.model||'claude-sonnet-5';
  document.getElementById('pasteText').value='';
  syncPasteMode();
  document.getElementById('pasteModalBg').classList.add('show');
}
function syncPasteMode(){
  const ai=document.getElementById('aiToggle').checked;
  document.getElementById('aiToggleLabel').textContent = ai?'AI 파싱 (자연어)':'직접 형식 (AI 없이)';
  document.getElementById('aiCfg').style.display = ai?'block':'none';
  document.getElementById('fmtHelp').style.display = ai?'none':'block';
  document.getElementById('pasteModeHint').textContent = ai
    ? '자연어로 자유롭게 붙여넣으면 AI가 날짜·도시·장소·좌표를 정리해줘.'
    : '아래 형식으로 붙여넣으면 AI 없이 즉시 만들어. 좌표는 자동으로 찾음(국내 카카오·해외 구글).';
  document.getElementById('pasteText').placeholder = ai?AI_PLACEHOLDER:DIRECT_PLACEHOLDER;
}
document.getElementById('pasteBtn').onclick=openPaste;
document.getElementById('pasteMenuBtn').onclick=()=>document.getElementById('pasteBtn').click();
document.getElementById('aiToggle').onchange=()=>{ cfg.aiParse=document.getElementById('aiToggle').checked; saveCfg(); syncPasteMode(); };
document.getElementById('apiKey').oninput=e=>{ cfg.apiKey=e.target.value.trim(); saveCfg(); };
document.getElementById('apiModel').onchange=e=>{ cfg.model=e.target.value; saveCfg(); };
document.getElementById('fmtCopy').onclick=()=>{ document.getElementById('pasteText').value=document.getElementById('fmtSpec').textContent.split('\n\n규칙:')[0].trim(); };
document.getElementById('pasteCancel').onclick=()=>document.getElementById('pasteModalBg').classList.remove('show');
document.getElementById('pasteRun').onclick=runPaste;

async function runPaste(){
  const text=document.getElementById('pasteText').value.trim();
  if(!text){ toast('내용을 붙여넣어줘','#e63946'); return; }
  const target=document.getElementById('pasteTarget').value;
  let parsed;
  try{
    if(cfg.aiParse){ toast('AI가 일정을 정리하는 중…','#1d6fd6'); parsed=await parseAI(text); }
    else parsed=parseDirect(text);
  }catch(e){ reportOperationalError('paste.parse',e); toast('일정을 해석하지 못했습니다. 입력 형식과 연결 상태를 확인해 주세요','#e63946'); return; }
  if(!parsed||!Array.isArray(parsed.days)||!parsed.days.length){ toast('일정을 못 읽었어 — 형식을 확인해줘','#e63946'); return; }
  // 정규화
  const MODES=['car','taxi','transit','train','walk','bike','flight'];
  const hhmm=v=>/^\d{1,2}:\d{2}$/.test(v||'')?v:'';
  const posInt=v=>{const n=parseInt(v); return (v==null||isNaN(n)||n<0)?null:n;};
  parsed.days=parsed.days.map(d=>({
    title:d.title||'', drive:d.drive||'', note:d.note||'',
    mode:MODES.includes(d.mode)?d.mode:'car', startAt:hhmm(d.startAt)||'09:00',
    spots:(d.spots||[]).map(s=>({name:(s.name||'').trim(), city:(s.city||'기타').trim(), desc:s.desc||'',
      opt:!!s.opt, stay:!!s.stay, legMode:(MODES.includes(s.legMode)?s.legMode:undefined), at:(hhmm(s.at)||undefined), stayMin:(s.stayMin==null?null:posInt(s.stayMin)),
      cost:(s.cost==null?null:posInt(s.cost)), cur:(['USD','EUR','JPY','CNY'].includes(s.cur)?s.cur:undefined), bookAt:hhmm(s.bookAt),
      lat:(s.lat==null?null:+s.lat), lng:(s.lng==null?null:+s.lng)})).filter(s=>s.name)
  }));
  const checked=validateTripPayload({name:parsed.name||'붙여넣은 여행',start:parsed.start||'',days:parsed.days});
  if(!checked.ok){ reportOperationalError('paste.invalid',new Error('validation')); toast(checked.error,'#e63946'); return; }
  parsed=checked.value;
  // 좌표 없는 장소 지오코딩
  const need=[]; parsed.days.forEach(d=>d.spots.forEach(s=>{ if(s.lat==null||isNaN(s.lat)||s.lng==null||isNaN(s.lng)) need.push(s); }));
  for(let i=0;i<need.length;i++){
    const s=need[i];
    toast(`좌표 찾는 중… (${i+1}/${need.length}) ${s.name}`,'#1d6fd6');
    const g=await geocodeSpot(s);   // 국내=카카오/해외=구글 라우팅, 도시 앵커 150km 밖 결과는 배제
    if(g){ s.lat=g.lat; s.lng=g.lng; }
  }
  // 좌표 못 찾은 장소는 버리지 않고 유지 (카드에 남고, '위치 지정'으로 표시)
  let noloc=0; parsed.days.forEach(d=>d.spots.forEach(s=>{ if(!hasLoc(s)) noloc++; }));
  // 기존 여행과 결합한 최종 문서도 다시 검증해 append가 전체 한도를 넘는 경우 부분 적용을 막는다.
  let nextTrip;
  if(target==='append'){
    nextTrip=Object.assign({},trip(),{days:[...trip().days,...parsed.days],start:trip().start||parsed.start||''});
  }else if(target==='overwrite' && !viewMode && trip()){
    nextTrip=Object.assign({},trip(),{days:parsed.days,name:parsed.name||trip().name,start:parsed.start||trip().start});
  }else{
    nextTrip=Object.assign({},parsed,{id:uid(),name:parsed.name||'붙여넣은 여행',start:parsed.start||new Date().toISOString().slice(0,10)});
  }
  const finalResult=validateTripPayload(nextTrip);
  if(!finalResult.ok){ reportOperationalError('paste.combined.invalid',new Error('validation')); toast(finalResult.error,'#e63946'); return; }
  const finalTrip=finalResult.value, existing=store.trips.findIndex(t=>t.id===finalTrip.id);
  if(existing>=0) store.trips[existing]=finalTrip; else store.trips.push(finalTrip);
  store.activeId=finalTrip.id;
  document.getElementById('pasteModalBg').classList.remove('show');
  commit(()=>{ activeDay=0; }, {fit:fitEntry});
  toast(`초안 생성 완료${noloc?` · ${noloc}곳은 위치 미지정 (카드에서 📍 지정)`:''}`, noloc?'#f4862c':'#2a9d3f');
}

// ───────────────── 여행 모드 ─────────────────
document.getElementById('travelBtn').onclick=()=>{
  const t=trip(); let di=0;
  if(t.start){
    const diff=Math.floor((new Date().setHours(0,0,0,0)-new Date(t.start+'T00:00:00'))/86400000);
    di=Math.min(Math.max(diff,0),t.days.length-1);
  }
  const sel=document.getElementById('travelDay');
  sel.innerHTML=t.days.map((d,i)=>`<option value="${i}" ${i===di?'selected':''}>Day ${i+1} · ${dateOf(i)} · ${esc(d.title)}</option>`).join('');
  sel.onchange=()=>renderTravel(parseInt(sel.value));
  renderTravel(di);
  document.getElementById('travel').classList.add('show');
};
document.getElementById('travelClose').onclick=()=>document.getElementById('travel').classList.remove('show');
function renderTravel(di){
  const t=trip(), d=t.days[di], colors=cityColors();
  document.getElementById('travelTitle').textContent=`Day ${di+1} · ${d.title||''}`;
  document.getElementById('travelSub').textContent=[dateOf(di),d.drive,d.note].filter(Boolean).join('  ·  ');
  const list=document.getElementById('travelList'); list.innerHTML='';
  const currentBox=document.getElementById('travelCurrent'),nextBox=document.getElementById('travelNext');
  currentBox.innerHTML=''; nextBox.innerHTML='';
  if(!d.spots.length){ currentBox.innerHTML='<div class="travelKicker">현재 장소</div><div class="travelPlace">자유 일정</div>'; nextBox.hidden=true; list.innerHTML='<div class="hint" style="padding:20px 4px">등록된 장소가 없습니다 — 이동일이거나 자유 일정입니다.</div>'; return; }
  // 전날 숙소 이월: Day 2+에서 전날 숙소가 있으면 상단에 가상 항목으로 표시(오늘 데이터엔 복제 안 함).
  // 타임라인·첫 장소 구간이 숙소에서 출발하도록 prevLoc/etas를 숙소로 시드 (사이드바·재생과 동일 기준).
  const ctx=dayContext(di), carry=ctx.carry, tl=ctx.timeline, iso=isoDateOf(di);
  const etas=tl.map(x=>x.eta), dm=ctx.mode;   // ETA는 anchor 기준(사이드바·이미지와 동일)
  const now=new Date(),today=iso===toISO(now),nowMin=now.getHours()*60+now.getMinutes();
  let currentIndex=0;
  if(today){ for(let i=0;i<etas.length;i++) if(etas[i]<=nowMin) currentIndex=i; }
  const current=d.spots[currentIndex], currentLink=hasLoc(current)?extMapLink(current):null;
  const currentFacts=[`${hm(etas[currentIndex])} 도착 예상`,current.bookAt?`예약 ${current.bookAt}`:'예약 없음',current.stayMin!=null?`체류 ${current.stayMin}분`:null].filter(Boolean);
  currentBox.innerHTML=`<div class="travelKicker">${today?'현재 장소':'선택한 날의 시작 장소'}</div><div class="travelPlace">${catPrefix(current)}${esc(current.name)}</div><div class="travelFacts">${currentFacts.map(esc).join(' · ')}${current.desc?`<br>${esc(current.desc)}`:''}</div><div class="travelActions">${currentLink?`<a href="${escAttr(currentLink.href)}" target="_blank" rel="noopener">길찾기</a>`:''}${safeUrl(current.bookUrl)?`<a href="${escAttr(safeUrl(current.bookUrl))}" target="_blank" rel="noopener">예약 정보</a>`:''}</div>`;
  const next=d.spots[currentIndex+1]; nextBox.hidden=false;
  if(next){
    const mode=legModeOf(d,next),route=(hasLoc(current)&&hasLoc(next))?requestLeg(current,next,mode,mode==='transit'?planDepartISO(iso,legDepartMinute(d,tl,currentIndex+1),ctx.timeZone):null,ctx.timeZone):null;
    nextBox.innerHTML=`<div><div class="travelKicker">다음 장소</div><strong>${esc(next.name)}</strong><div class="travelFacts">${route?`${MODE_ICON[mode]} ${fmtDur(route.sec)} 후`:'이동 정보 계산 중'} · ${hm(etas[currentIndex+1])} 도착 예상</div></div><span aria-hidden="true">→</span>`;
  }else if(ctx.backLeg){
    const bl=ctx.backLeg, r=requestLeg(bl.from,bl.to,bl.mode,bl.when,bl.timeZone);
    nextBox.innerHTML=`<div><div class="travelKicker">다음 장소</div><strong>🏠 ${esc(bl.to.name)}</strong><div class="travelFacts">숙소 복귀 · ${r?`${MODE_ICON[bl.mode]} ${fmtDur(r.sec)} 후`:'이동 정보 계산 중'}</div></div><span aria-hidden="true">→</span>`;
  }else nextBox.innerHTML='<div><div class="travelKicker">다음 장소</div><strong>오늘 일정 완료</strong></div><span aria-hidden="true">✓</span>';
  let prevLoc=carry;
  if(carry){
    const el=extMapLink(carry);
    const cd=document.createElement('div'); cd.className='tSpot carry'; cd.style.setProperty('--c','#7a86ad');
    cd.innerHTML=`<div class="n"><span class="eta">🏠</span> ${esc(carry.name)} <span style="font-size:11px;color:#8892b0">전날 숙소 · ${hm(parseHM(d.startAt))} 출발</span></div>`+
      `<a href="${escAttr(el.href)}" target="_blank" rel="noopener">🧭 ${el.label}</a>`;
    list.appendChild(cd);
  }
  d.spots.forEach((s,si)=>{
    // 구간 이동 정보 (이전 장소 → 이 장소)
    if(hasLoc(s)&&prevLoc){
      const mode=legModeOf(d,s), when=mode==='transit'?planDepartISO(iso,legDepartMinute(d,tl,si),ctx.timeZone):null;
      const c=requestLeg(prevLoc,s,mode,when,ctx.timeZone);   // 구간별 출발시각·시간대
      const lg=document.createElement('div'); lg.className='tLeg';
      lg.textContent = c
        ? ((dm==='car'&&c.m<2000)? `🚶 ${Math.max(1,Math.round(c.m/75))}분 · ${(c.m/1000).toFixed(1)}km`
                   : `${MODE_ICON[dm]} ${fmtDur(c.sec)} · ${(c.m/1000).toFixed(1)}km${((dm==='car'||dm==='taxi')&&c.taxi)?` · 🚕약 ${c.taxi.toLocaleString()}원`:''}`)
        : `↘ 직선 ${haversine(prevLoc,s).toFixed(1)}km`;
      list.appendChild(lg);
    }
    if(hasLoc(s)) prevLoc=s;
    const div=document.createElement('div'); div.className='tSpot'; div.style.setProperty('--c',spotColor(s,di,colors));
    const tmeta=[];
    if(s.bookAt) tmeta.push(`🎫 예약 ${esc(s.bookAt)}`);
    if(s.cost) tmeta.push(`💳 ${costLabel(s.cost,s.cur)}`);
    div.innerHTML=`<div class="n"><span class="eta">${hm(etas[si])}</span>${si+1}. ${catPrefix(s)}${esc(s.name)}${s.opt?' <span style="font-size:11px;color:#8892b0">(선택)</span>':''}</div>`+
      (tmeta.length?`<div class="d" style="color:#c9b6e8">${tmeta.join(' · ')}</div>`:'')+
      `<div class="d">${esc(s.desc).replace(/\n/g,'<br>')}</div>`+
      ((bu=>bu?`<a href="${escAttr(bu)}" target="_blank" rel="noopener" style="background:#7c5cff;margin-right:6px">🎫 예약 열기</a>`:'')(safeUrl(s.bookUrl)))+
      (hasLoc(s)
        ? (inKorea({lat:+s.lat,lng:+s.lng})
            ? `<a href="https://map.kakao.com/link/to/${encodeURIComponent(s.name)},${s.lat},${s.lng}" target="_blank" rel="noopener">🧭 카카오맵 길찾기</a>`
            : `<a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking" target="_blank" rel="noopener">🧭 여기로 길찾기</a>`)
        : `<span style="font-size:12px;color:#f6bd60">📍 위치 미지정</span>`);
    list.appendChild(div);
  });
  // 하루의 끝 — 숙소로 돌아가는 구간 (사이드바·지도와 같은 기준)
  if(ctx.backLeg){
    const bl=ctx.backLeg, c=requestLeg(bl.from,bl.to,bl.mode,bl.when,bl.timeZone);
    const lg=document.createElement('div'); lg.className='tLeg';
    lg.textContent = c? `${MODE_ICON[bl.mode]} ${fmtDur(c.sec)} · ${(c.m/1000).toFixed(1)}km` : `↘ 직선 ${haversine(bl.from,bl.to).toFixed(1)}km`;
    list.appendChild(lg);
    const el=extMapLink(bl.to);
    const bd=document.createElement('div'); bd.className='tSpot carry'; bd.style.setProperty('--c','#7a86ad');
    bd.innerHTML=`<div class="n"><span class="eta">🏠</span> ${esc(bl.to.name)} <span style="font-size:11px;color:#8892b0">숙소 복귀 · 자동</span></div>`+
      `<a href="${escAttr(el.href)}" target="_blank" rel="noopener">🧭 ${el.label}</a>`;
    list.appendChild(bd);
  }
}

// ───────────────── 로그인 · 클라우드 동기화 (Supabase) ─────────────────
const SUPA_URL='https://gdnhrwtfidjimtabgovh.supabase.co';
const SUPA_KEY='sb_publishable_2C-n1YFvE9Cw9B7L7B6Trw_XO3Val5q';
if(window.supabase){
  sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  sb.auth.onAuthStateChange((_e, session)=>{
    const next = session?.user || null;
    // 로그인 병합은 "계정이 바뀐 순간"에만 돈다. 토큰 자동 갱신(TOKEN_REFRESHED)에도 병합을 돌리면
    // 오래 열어둔 탭이 몇 시간 뒤 제 로컬본을 다시 올려 다른 기기의 최신 편집을 덮어썼다.
    const switched = (next&&next.id) !== (user&&user.id);
    user = next;
    updateAuthUI();
    if(user && switched) syncOnLogin();
  });
}
function updateAuthUI(){
  const b=document.getElementById('authBtn'); if(!b) return;
  if(user){ b.textContent='👤 '+(user.email||'').split('@')[0]; b.title='클릭하면 로그아웃'; b.classList.add('primary'); }
  else { b.textContent='로그인'; b.title='로그인하면 여행이 내 계정에 저장돼 어느 기기서든 열려요'; b.classList.remove('primary'); }
}
// revision 비교 후에만 쓰는 낙관적 동시성 제어(CAS). 실패해도 로컬 편집은 유지한다.
let cloudRetryT=null, syncConflicts=[], currentSyncConflict=null;
async function rpcRow(name,args){
  const {data,error}=await sb.rpc(name,args);
  if(error) throw error;
  return Array.isArray(data)?data[0]:data;
}
function cloudSyncActive(delay){
  if(suppressCloudOnce){ suppressCloudOnce=false; return; }
  if(!sb||!user) return;
  clearTimeout(cloudRetryT); clearTimeout(syncTimer);
  syncTimer=setTimeout(syncStaleTrips,delay!=null?delay:800);
}
// 활성 여행만 올리면 안 된다: 편집 직후 다른 여행으로 전환하면 디바운스가 취소돼 그 편집이 영영 안 올라가고,
// 로컬만 앞선 채 revision은 그대로라 다음 병합이 그걸 "깨끗한 상태"로 착각한다. 지문이 밀린 여행을 모두 올린다.
function syncStaleTrips(){
  for(const t of store.trips){
    const entry=syncMeta[t.id];
    if(!entry || entry.hash!==TC_SYNC.hashTrip(t)) syncTripCloud(t);
  }
}
async function syncTripCloud(t,opts){
  if(!sb||!user||!t) return;
  if(t.id==='spain2026'&&!(syncMeta[t.id]&&syncMeta[t.id].revision)) return;
  const entry=syncEntry(t.id), force=!!(opts&&opts.force);
  if(entry.status==='conflict'&&!force) return;
  entry.status='syncing'; persistSyncMeta();
  syncInFlight++;
  try{
    const row=await rpcRow('sync_trip',{p_client_id:t.id,p_data:t,p_expected_revision:entry.revision,p_force:force});
    if(!row) throw new Error('empty sync response');
    if(row.conflict){
      // entry.revision(로컬이 파생된 base)은 그대로 둔다 — 서버 revision을 stamp하면 미해결 충돌이
      // 다음 병합에서 "안전한 업로드"로 둔갑해 원격본을 조용히 날린다.
      entry.status='conflict'; persistSyncMeta();
      enqueueSyncConflict({kind:row.deleted_at?'remote-deleted':'changed-both',local:t,remote:row.data||null,revision:Number(row.revision)||entry.revision,deleted_at:row.deleted_at||null});
      return;
    }
    entry.revision=Number(row.revision)||1; entry.status='clean'; entry.op=''; entry.hash=TC_SYNC.hashTrip(t); persistSyncMeta();
    cloudSnapshot(t,entry.revision);
  }catch(e){
    entry.status='error'; persistSyncMeta();
    reportOperationalError('cloud.sync',e);
    clearTimeout(cloudRetryT);
    cloudRetryT=setTimeout(syncStaleTrips,15000);   // 여러 여행이 함께 실패해도 재시도에서 빠지지 않게 밀린 것 전부
    toast('클라우드 저장 실패 — 로컬 편집은 보존됨','#e63946',{label:'재시도',fn:()=>syncTripCloud(t)});
  }finally{ syncInFlight--; if(!syncInFlight&&syncMetaStale) refreshSyncMetaFromStorage(); }
}
async function flushPendingSync(){
  if(!sb||!user) return;
  for(const [id,entry] of Object.entries(syncMeta)){
    if(entry.status==='delete-pending'||entry.status==='delete-error') await performCloudDelete(id,entry.op);
  }
}
window.addEventListener('online',async()=>{ if(sb&&user){ await flushPendingSync(); cloudSyncActive(0); } });

// 버전 히스토리: 여행별 10분에 1회 스냅샷, 최근 15개 유지
const _snapAt={};
async function cloudSnapshot(t,revision){
  if(!sb||!user) return;
  const now=Date.now();
  if(_snapAt[t.id]&&now-_snapAt[t.id]<10*60*1000) return;
  _snapAt[t.id]=now;
  try{
    const {error}=await sb.from('trip_snapshots').insert({user_id:user.id,client_id:t.id,name:t.name,data:t,source_revision:revision});
    if(error) throw error;
    const {data:rows,error:listError}=await sb.from('trip_snapshots').select('id').eq('client_id',t.id).order('created_at',{ascending:false}).range(15,100);
    if(listError) throw listError;
    if(rows&&rows.length){ const {error:deleteError}=await sb.from('trip_snapshots').delete().in('id',rows.map(r=>r.id)); if(deleteError) throw deleteError; }
  }catch(e){ reportOperationalError('cloud.snapshot',e); }
}
// 버전 기록 목록 (여행 설정 모달)
async function loadSnapList(){
  const box=document.getElementById('snapList');
  if(!sb || !user){ box.innerHTML='<div class="hint">로그인하면 자동으로 버전이 기록됩니다 (10분 간격)</div>'; return; }
  box.innerHTML='<div class="hint">불러오는 중…</div>';
  const {data,error}=await sb.from('trip_snapshots').select('id,created_at')
    .eq('client_id',store.activeId).order('created_at',{ascending:false}).limit(15);
  if(error||!data||!data.length){ box.innerHTML='<div class="hint">저장된 버전이 없습니다 (10분 간격 자동 기록)</div>'; return; }
  box.innerHTML='';
  data.forEach(r=>{
    const d=new Date(r.created_at);
    const row=document.createElement('div'); row.className='snapRow';
    row.innerHTML=`<span>${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</span>`;
    const btn=document.createElement('button'); btn.className='btn'; btn.textContent='복원'; btn.style.cssText='font-size:11px;padding:2px 10px';
    btn.onclick=async()=>{
      if(!confirm('이 시점으로 복원할까요? (현재 상태는 ↩️ 실행취소로 되돌릴 수 있습니다)'))return;
      const {data:full,error:fe}=await sb.from('trip_snapshots').select('data').eq('id',r.id).single();
      const restoredResult=full&&validateTripPayload(full.data);
      const restored=restoredResult&&restoredResult.ok&&restoredResult.value;
      if(fe||!restored){ toast('손상된 버전이라 복원하지 않았습니다','#e63946'); return; }
      const idx=store.trips.findIndex(t=>t.id===store.activeId);
      document.getElementById('tripModalBg').classList.remove('show');
      commit(()=>{ if(idx>=0) store.trips[idx]=restored; activeDay=0; }, {fit:fitEntry}); toast('복원되었습니다 (↩️로 되돌리기 가능)');
    };
    row.appendChild(btn); box.appendChild(row);
  });
}
function cloudDelete(clientId,deletedTrip){
  const op=uid()+Date.now();
  TC_SYNC.beginDelete(syncMeta,clientId,op); persistSyncMeta();
  if(sb&&user) performCloudDelete(clientId,op,deletedTrip);
}
async function performCloudDelete(clientId,op,deletedTrip){
  const entry=syncEntry(clientId);
  try{
    const row=await rpcRow('tombstone_trip',{p_client_id:clientId,p_expected_revision:entry.revision,p_force:false});
    if(row&&row.conflict){
      entry.status='conflict'; persistSyncMeta();   // base revision 유지 (위 syncTripCloud와 같은 이유)
      enqueueSyncConflict({kind:row.deleted_at?'remote-deleted':'changed-both',local:deletedTrip||null,remote:row.data||null,revision:Number(row.revision)||entry.revision,deleted_at:row.deleted_at||null});
      return;
    }
    const result=TC_SYNC.finishDelete(syncMeta,clientId,op,Number(row&&row.revision)||entry.revision||1); persistSyncMeta();
    if(result.resync){ const restored=store.trips.find(t=>t.id===clientId); if(restored) syncTripCloud(restored); }
  }catch(e){ reportOperationalError('cloud.delete',e); entry.status='delete-error'; entry.op=op; persistSyncMeta(); toast('삭제 동기화 실패 — 재시도가 필요합니다','#e63946',{label:'재시도',fn:()=>performCloudDelete(clientId,op,deletedTrip)}); }
}
function reconcileUndoDeletes(){
  for(const t of store.trips){
    const entry=syncMeta[t.id];
    if(entry&&['delete-pending','delete-error','tombstoned'].includes(entry.status)){
      TC_SYNC.undoDelete(syncMeta,t.id);
      if(sb&&user) syncTripCloud(t);
    }
  }
  persistSyncMeta();
}

function enqueueSyncConflict(conflict){ syncConflicts.push(conflict); if(!currentSyncConflict) showNextSyncConflict(); }
function showNextSyncConflict(){
  currentSyncConflict=syncConflicts.shift()||null;
  if(!currentSyncConflict){ document.getElementById('syncConflictBg').classList.remove('show'); return; }
  const c=currentSyncConflict, name=(c.local&&c.local.name)||(c.remote&&c.remote.name)||'여행';
  document.getElementById('syncConflictText').textContent=`“${name}”이 다른 기기에서도 변경되었습니다. 어느 버전을 보존할지 선택하세요.`;
  document.getElementById('syncConflictBg').classList.add('show');
}
function replaceWithRemote(c){
  const idx=store.trips.findIndex(t=>t.id===(c.local&&c.local.id));
  const remoteResult=c.remote&&validateTripPayload(c.remote);
  const remote=remoteResult&&remoteResult.ok&&remoteResult.value;
  if(c.remote&&!remote){ reportOperationalError('cloud.conflict.invalid',new Error('validation')); toast('클라우드 데이터가 손상되어 적용하지 않았습니다','#e63946'); return false; }
  if(idx>=0){ if(remote&&!c.deleted_at) store.trips[idx]=remote; else store.trips.splice(idx,1); }
  if(remote&&idx<0&&!c.deleted_at) store.trips.push(remote);
  if(!store.trips.length) store.trips=[{id:uid(),name:'새 여행',start:'',days:[{title:'',drive:'',note:'',spots:[]}]}];
  if(!store.trips.find(t=>t.id===store.activeId)) store.activeId=store.trips[0].id;
  if(c.local) syncMeta[c.local.id]={revision:c.revision,status:c.deleted_at?'tombstoned':'clean',op:'',hash:remote?TC_SYNC.hashTrip(remote):''};
  persistSyncMeta(); suppressCloudOnce=true; activeDay=0; render(); return true;
}
document.getElementById('syncUseCloud').onclick=()=>{ if(!replaceWithRemote(currentSyncConflict)) return; currentSyncConflict=null; showNextSyncConflict(); };
document.getElementById('syncUseDevice').onclick=()=>{ const c=currentSyncConflict; currentSyncConflict=null; document.getElementById('syncConflictBg').classList.remove('show'); if(c&&c.local) syncTripCloud(c.local,{force:true}); showNextSyncConflict(); };
document.getElementById('syncKeepCopy').onclick=()=>{
  const c=currentSyncConflict; if(!c||!c.local) return;
  const copy=JSON.parse(JSON.stringify(c.local)); copy.id=uid(); copy.name=(copy.name||'여행')+' (충돌 복사본)';
  if(!replaceWithRemote(c)) return; store.trips.push(copy); store.activeId=copy.id; suppressCloudOnce=true; render(); syncTripCloud(copy);
  currentSyncConflict=null; showNextSyncConflict();
};

// 로그인 직후: 서버 revision과 로컬이 읽은 revision을 비교해 안전한 변경만 자동 병합한다.
async function syncOnLogin(){
  try{
    const {data:rows,error}=await sb.from('trips').select('client_id,data,revision,deleted_at,updated_at');
    if(error) throw error;
    const local=store.trips.filter(t=>t.id!=='spain2026'||(rows||[]).some(r=>r.client_id===t.id));
    const merged=TC_SYNC.mergeForLogin(local,rows||[],syncMeta);
    syncMeta=merged.meta; persistSyncMeta();
    const checked=merged.trips.map(t=>validateTripPayload(t));
    if(checked.some(result=>!result.ok)) throw new Error('invalid cloud payload');
    const trips=checked.map(result=>result.ok&&result.value);
    if(trips.length){
      store.trips=trips;
      if(!trips.find(t=>t.id===store.activeId)) store.activeId=trips[0].id;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    activeDay=0; render(); fitAll();
    pullPriceSnapshots();   // cron·다른 기기가 남긴 가격 관측 기록을 로컬과 병합
    for(const c of merged.conflicts) enqueueSyncConflict(c);
    for(const action of merged.actions) if(action.trip.id!=='spain2026') await syncTripCloud(action.trip,{force:action.force});
    await flushPendingSync();
    toast(merged.conflicts.length?`동기화 충돌 ${merged.conflicts.length}건 — 버전을 선택해 주세요`:`클라우드 동기화 완료 · 여행 ${trips.length}개`,merged.conflicts.length?'#e09b20':undefined);
  }catch(e){ reportOperationalError('cloud.login-sync',e); toast('클라우드 동기화 실패 — 로컬로 계속 사용','#e63946'); }
}
// 로그인 모달 (이메일 + 비밀번호)
document.getElementById('authBtn').onclick=()=>{
  if(!sb){ toast('온라인 상태에서 다시 시도해줘','#e63946'); return; }
  if(user){ if(confirm(`${user.email} — 로그아웃할까?`)){ sb.auth.signOut(); toast('로그아웃됨','#8892b0'); } return; }
  document.getElementById('authEmail').value='';
  document.getElementById('authPass').value='';
  document.getElementById('authModalBg').classList.add('show');
  document.getElementById('authEmail').focus();
};
document.getElementById('authCancel').onclick=()=>document.getElementById('authModalBg').classList.remove('show');
function authCreds(){
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPass').value;
  if(!/.+@.+\..+/.test(email)){ toast('이메일을 확인해줘','#e63946'); return null; }
  if((password||'').length<6){ toast('비밀번호는 6자 이상','#e63946'); return null; }
  return {email, password};
}
document.getElementById('authLogin').onclick=async()=>{
  const c=authCreds(); if(!c) return;
  const btn=document.getElementById('authLogin'); btn.textContent='로그인 중…'; btn.disabled=true;
  const {error}=await sb.auth.signInWithPassword(c);
  btn.textContent='로그인'; btn.disabled=false;
  if(error){ toast(/invalid/i.test(error.message)?'이메일 또는 비밀번호가 틀렸어 (처음이면 가입)':'로그인 실패: '+error.message,'#e63946'); return; }
  document.getElementById('authModalBg').classList.remove('show'); toast('로그인 완료!');
};
document.getElementById('authSignup').onclick=async()=>{
  const c=authCreds(); if(!c) return;
  const btn=document.getElementById('authSignup'); btn.textContent='가입 중…'; btn.disabled=true;
  const {data,error}=await sb.auth.signUp(c);
  btn.textContent='가입'; btn.disabled=false;
  if(error){ toast('가입 실패: '+error.message,'#e63946'); return; }
  if(data && data.session){ document.getElementById('authModalBg').classList.remove('show'); toast('가입 완료 — 로그인됨!'); }
  else { document.getElementById('authModalBg').classList.remove('show'); toast('확인 메일을 보냈어! 메일의 링크를 누르면 인증되고 자동 로그인돼 (스팸함도 확인)','#1d6fd6'); }
};
document.getElementById('authPass').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('authLogin').click();});
updateAuthUI();

document.getElementById('tripPickerBtn').onclick=()=>document.getElementById('tripListBtn').click();
function dismissOnboarding(){ document.getElementById('onboarding').hidden=true; try{localStorage.setItem(ONBOARD_KEY,'1');}catch(_){} }
document.getElementById('onboardSample').onclick=()=>{ dismissOnboarding(); fitEntry(); };
document.getElementById('onboardNew').onclick=()=>{ dismissOnboarding(); createNewTrip(false); };
document.getElementById('onboardPaste').onclick=()=>{ dismissOnboarding(); document.getElementById('pasteBtn').click(); document.getElementById('pasteTarget').value='new'; };
document.getElementById('onboardLogin').onclick=()=>{ dismissOnboarding(); document.getElementById('authBtn').click(); };

// ───────────────── 키보드·보조기술 접근성 ─────────────────
function initAccessibility(){
  const returnFocus=new WeakMap();
  const focusable='button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function enhance(root){
    const nodes=[];
    if(root.nodeType===1) nodes.push(root);
    if(root.querySelectorAll) nodes.push(...root.querySelectorAll('.modalBg,[onclick],button[title],.iconb,.legModeBtn,.arrowBtn'));
    nodes.forEach(el=>{
      if(el.classList&&el.classList.contains('modalBg')){
        const modal=el.querySelector('.modal'); if(!modal) return;
        modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
        const title=modal.querySelector('h1,h2,h3');
        if(title){ if(!title.id) title.id=el.id+'Title'; modal.setAttribute('aria-labelledby',title.id); }
        el.setAttribute('aria-hidden',el.classList.contains('show')?'false':'true');
      }else if(el.matches&&el.matches('button')&&el.title&&!el.getAttribute('aria-label')){
        el.setAttribute('aria-label',el.title);
      }else if(el.hasAttribute&&el.hasAttribute('onclick')&&!el.matches('button,a,input,select,textarea')){
        el.setAttribute('role','button'); if(!el.hasAttribute('tabindex')) el.tabIndex=0;
        if(!el.getAttribute('aria-label')&&el.title) el.setAttribute('aria-label',el.title);
      }
    });
  }
  enhance(document);
  document.getElementById('toast').setAttribute('role','status');
  document.getElementById('toast').setAttribute('aria-live','polite');
  new MutationObserver(changes=>changes.forEach(change=>{
    if(change.type==='childList') change.addedNodes.forEach(enhance);
    if(change.type==='attributes'){
      const bg=change.target; enhance(bg);
      if(bg.classList.contains('show')){
        if(!returnFocus.has(bg)){
          const active=document.activeElement;
          returnFocus.set(bg,active&&active.closest&&active.closest('#hdrMenu')?document.getElementById('moreBtn'):active);
        }
        setTimeout(()=>{ const target=bg.querySelector('[autofocus],input:not([type="hidden"]),textarea,select,button:not([disabled]),[href]'); if(target) target.focus(); },0);
      }else{
        const previous=returnFocus.get(bg); returnFocus.delete(bg);
        if(previous&&previous.isConnected) setTimeout(()=>previous.focus(),0);
      }
    }
  })).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('keydown',e=>{
    const target=e.target;
    if((e.key==='Enter'||e.key===' ')&&target.matches('[role="button"]:not(button)')){ e.preventDefault(); target.click(); return; }
    const bg=document.querySelector('.modalBg.show'); if(!bg) return;
    if(e.key==='Escape'&&bg.id!=='syncConflictBg'){
      e.preventDefault(); const close=bg.querySelector('[id$="Cancel"],[id$="Close"]'); if(close) close.click(); else bg.classList.remove('show'); return;
    }
    if(e.key!=='Tab') return;
    const items=Array.from(bg.querySelectorAll(focusable)); if(!items.length){ e.preventDefault(); return; }
    const first=items[0],last=items[items.length-1];
    if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
  });
}
initAccessibility();

// ───────────────── PWA ─────────────────
// 오프라인 지도 캐시는 Google Maps 약관상 불가 — SW는 앱 셸 캐시만 담당
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(reg=>{
    let noticed=false;
    // 새 버전 설치 감지 → 자동 새로고침. 단, 편집 중(모달 열림)이면 입력 유실 방지로 수동 안내만.
    const applyUpdate=()=>{ if(noticed) return; noticed=true;
      // 편집/입력 중이면 자동 새로고침 대신 수동 안내(입력 유실 방지). 모달뿐 아니라
      // 지도 위치 지정(pickMode·모달 닫힘)·검색·가져오기 진행 중도 '작업 중'으로 본다.
      if(isBusyEditing()){ toast('새 버전이 있어요 — 탭해서 새로고침', '#1d6fd6', {label:'새로고침', fn:()=>location.reload()}); }
      else { toast('새 버전 적용 중…', '#1d6fd6'); setTimeout(()=>location.reload(), 900); }
    };
    if(reg.waiting && navigator.serviceWorker.controller) applyUpdate();   // 앱 열 때 이미 대기 중인 새 버전
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing; if(!nw) return;
      nw.addEventListener('statechange',()=>{
        if(nw.state==='installed' && navigator.serviceWorker.controller) applyUpdate();
      });
    });
    // PWA는 홈화면서 재개해도 페이지를 새로 안 열어 새 버전 확인을 안 함 → 포그라운드 복귀·주기적으로 직접 확인
    let lastChk=Date.now();
    const checkUpdate=()=>{ const now=Date.now(); if(now-lastChk<15000) return; lastChk=now; reg.update().catch(()=>{}); };
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') checkUpdate(); });
    window.addEventListener('focus', checkUpdate);
    setInterval(checkUpdate, 20*60*1000);
  }).catch(()=>{});
}

// 시작 — 사이드바 등 DOM 먼저 렌더, 지도·초기 포커싱은 __gmapsReady에서
prunePrices();   // 삭제된 여행·예약의 가격 기록 정리
render();
setTimeout(()=>{ checkTripPrices().catch(()=>{}); }, 2500);   // 예약 시세 자동 확인 (신선하면 조회 생략)
if(firstVisit){ document.getElementById('onboarding').hidden=false; requestAnimationFrame(()=>document.getElementById('onboardPaste').focus()); }
