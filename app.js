// ───────────────── 저장소 ─────────────────
const LS_KEY = 'tripcanvas_v1';
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
function persistSyncMeta(){ try{ localStorage.setItem(SYNC_META_KEY,JSON.stringify(syncMeta)); }catch(e){} }
function syncEntry(id){ return syncMeta[id]||(syncMeta[id]={revision:null,status:'new',op:''}); }

function seedSpain(){
  return {
    id:'spain2026', name:'🇪🇸 스페인 신혼여행', start:'2026-10-25',
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
let activeDay = 0, markers = [], lines = [], pickMode = false, sortables = [];

function onMapPick(lat,lng){
  if(!pickMode)return;
  pickMode=false; document.getElementById('pickBanner').style.display='none';
  document.getElementById('spotLat').value=lat; document.getElementById('spotLng').value=lng;
  document.getElementById('coordHint').textContent=`좌표: ${lat.toFixed(4)}, ${lng.toFixed(4)} ✓`;
  fillSpotFromCoords(lat,lng,false);   // 이름·도시 비어있으면 자동 채움
  document.getElementById('spotModalBg').classList.add('show');
}
// 지도 우클릭/롱프레스 → 그 좌표로 새 장소 추가 모달 (현재 활성 일자, 없으면 1일차)
function addSpotAt(lat,lng){
  if(viewMode) return;
  const di=activeDay? activeDay-1 : 0;
  openSpotModal(di,-1);
  document.getElementById('spotLat').value=lat; document.getElementById('spotLng').value=lng;
  document.getElementById('coordHint').textContent=`좌표: ${(+lat).toFixed(4)}, ${(+lng).toFixed(4)} ✓ (지도에서 지정)`;
  document.getElementById('spotName').value=''; _namePrefill='';
  fillSpotFromCoords(lat,lng,true);    // 지정 지점의 장소명·도시 자동 채움
  setTimeout(()=>document.getElementById('spotName').focus(),50);
}
// 좌표 → {name, city} 한 번의 조회. 국내=카카오 coord2Address(한국어), 해외=구글 Places 인근검색(영어명).
function reverseSpot(lat,lng){
  return new Promise(resolve=>{
    if(inKorea({lat:+lat,lng:+lng})){
      loadKakao().then(ok=>{
        if(!ok||!window.kakao||!kakao.maps.services){ resolve({}); return; }
        new kakao.maps.services.Geocoder().coord2Address(+lng,+lat,(res,status)=>{
          if(status!==kakao.maps.services.Status.OK||!res||!res.length){ resolve({}); return; }
          const r=res[0], a=r.address||{};
          const name=(r.road_address&&r.road_address.building_name)||'';   // 건물/장소명
          const one=a.region_1depth_name||'', two=a.region_2depth_name||'';
          const metro=/(특별시|광역시|특별자치시|특별자치도)$/.test(one);
          const city= metro? one.replace(/(특별시|광역시|특별자치시|특별자치도)$/,'') : (two.replace(/(시|군)$/,'')||one);
          resolve({ name:name||null, city:city||null });
        });
      });
    }else{
      if(!window.google||!google.maps){ resolve({}); return; }
      google.maps.importLibrary('places').then(({Place})=>{
        // 기본 랭크(POPULARITY): 반경 내 대표 장소 → 영문 이름 + 그 장소의 도시(도쿄 특별구는 '도쿄')
        Place.searchNearby({ fields:['displayName','formattedAddress','addressComponents'], locationRestriction:{center:{lat:+lat,lng:+lng}, radius:100}, maxResultCount:1, language:'en' })
          .then(({places})=>{ const p=places&&places[0]; resolve(p? { name:placeName(p)||null, city:cityFromGoogle(p.addressComponents)||null } : {}); })
          .catch(()=>resolve({}));
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
function fillSpotFromCoords(lat,lng,forceCity){
  const cityEl=document.getElementById('spotCity'), nameEl=document.getElementById('spotName');
  const cityAt=cityEl.value, nameAt=nameEl.value;
  const cityOK = forceCity || !cityAt.trim() || cityAt.trim()===(_cityPrefill||'').trim();
  const nameOK = !nameAt.trim() || nameAt.trim()===(_namePrefill||'').trim();
  if(!cityOK && !nameOK) return;
  reverseSpot(lat,lng).then(({name,city})=>{
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
    disableDefaultUI:true, zoomControl:true, clickableIcons:false, gestureHandling:'greedy'
  });
  iw=new google.maps.InfoWindow();
  map.addListener('click',e=>onMapPick(e.latLng.lat(), e.latLng.lng()));
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
  kakao.maps.event.addListener(kmap,'click',me=>onMapPick(me.latLng.getLat(), me.latLng.getLng()));
  kakao.maps.event.addListener(kmap,'rightclick',me=>{ if(!pickMode) addSpotAt(me.latLng.getLat(), me.latLng.getLng()); });
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
function mkPin(color,label,opt){
  const size = opt?22:27;
  const el=document.createElement('div');
  el.className='num-icon';
  el.style.cssText=`width:${size}px;height:${size}px;background:${color};${opt?'opacity:.75;':''}`;
  el.textContent=label??'';
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
      clearTimeout(_wxT); _wxT=setTimeout(()=>renderSidebar(),300);
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
function dayDistance(day){
  const loc=day.spots.filter(hasLoc); let sum=0;
  for(let i=1;i<loc.length;i++) sum+=haversine(loc[i-1],loc[i]);
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
      legRefreshT=setTimeout(()=>render(),450);   // 하루 합계 + 지도 경로선 갱신
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
      render();   // 환산액 갱신
    }
  }).catch(()=>{});   // 실패 시 폴백/캐시 유지
}
function dayCost(day){ return day.spots.reduce((a,s)=>a+(s.cost? toKRW(s.cost,s.cur):0),0); }
// 여행 전체 비용(장소+자차일 택시) 합계
function tripCost(){
  return trip().days.reduce((a,d)=>{ const m=dayModeOf(d); const tx=(m==='car'||m==='taxi')?((dayRoute(d)||{}).taxi||0):0; return a+dayCost(d)+tx; },0);
}
// 일정 예상 종료 시각(분) — 마지막 장소 (예약 대기 반영한) 활동 시작 + 체류
function dayEndMin(day, startAnchor){
  if(!day.spots.length) return null;
  const etas=dayEtas(day, startAnchor), last=day.spots.length-1, s=day.spots[last];
  const base = s.bookAt ? Math.max(etas[last], parseHM(s.bookAt)) : etas[last];
  return base + (s.stayMin!=null? +s.stayMin : 60);
}
// 하루 전체 실도로 합계 (모든 구간이 캐시됐을 때만)
function dayRoute(day){
  const loc=day.spots.filter(hasLoc);
  if(loc.length<2) return null;
  let sec=0,m=0,taxi=0;
  for(let i=1;i<loc.length;i++){
    const c=legCache[legKey(loc[i-1],loc[i],legModeOf(day,loc[i]))];
    if(!c||!c.sec) return null;
    sec+=c.sec; m+=c.m; taxi+=(c.taxi||0);
  }
  return {sec,m,taxi};
}

// 마커 하나 추가 (엔진 공용) — markers에 {spot, open} 인터페이스로 저장. 숙소는 🏠 핀
function addPin(s,di,si,c){
  const label=s.stay?'🏠':(si+1);
  const html=`<h3>${esc(s.name)}</h3><span class="badge" style="background:${c}">Day ${di+1} · ${dateOf(di)}</span>`+
    `<div>${esc(s.desc).replace(/\n/g,'<br>')}</div>`+
    `<div style="margin-top:6px"><a href="${escAttr(extMapLink(s).href)}" target="_blank" rel="noopener">${extMapLink(s).label}</a> &nbsp; `+
    `<a href="#" onclick="openSpotModal(${di},${si});return false;">✎ 편집</a></div>`;
  const pin=mkPin(c,label,s.opt); pin.title=s.name;
  const h=ME().marker(+s.lat,+s.lng,pin,()=>open());
  const open=()=>ME().openPopup(html, +s.lat, +s.lng, h);
  markers.push({spot:s, open, h});
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
    day.spots.forEach((s,si)=>{ if(hasLoc(s)) p.push(si,s.lat,s.lng,s.stay?1:0,s.opt?1:0,(s.legMode||''),spotColor(s,di,colors),esc(s.name),esc(s.desc||'')); });
    const loc=day.spots.filter(hasLoc);
    for(let i=1;i<loc.length;i++){ const c=legCache[legKey(loc[i-1],loc[i],legModeOf(day,loc[i]))]; p.push(c? (c.sec?(c.path?'p':'s'):'f') : 'n'); }
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
// 시각적 🏠 '전날 숙소' 이월 항목용 — 시작 앵커가 숙소(stay)일 때만.
function carryStayFor(di){ const a=startAnchorFor(di); return (a&&a.stay)?a:null; }
// 일자 컨텍스트(한 번에 계산) — 사이드바·여행모드·이미지·재생이 공유해 anchor/carry 혼동 방지.
// ETA·종료·이미지·여행모드 타임라인은 anchor(전날 숙소 또는 마지막 장소, 정책 반영)를 쓰고,
// 화면의 🏠 '전날 숙소' 항목 표시에만 carry(숙소일 때만)를 쓴다.
function dayContext(di){
  const day=trip().days[di], anchor=startAnchorFor(di);
  return { day, anchor, carry:(anchor&&anchor.stay)?anchor:null, timeline:dayTimeline(day,anchor,di), mode:dayModeOf(day), timeZone:dayTimeZone(day) };
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
  // 색상 기준 토글 (도시별 ↔ 일자별)
  const cmode=document.createElement('button'); cmode.className='chip';
  cmode.textContent = colorByMode()==='day' ? '🎨 일자별' : '🎨 도시별';
  cmode.title='핀·카드 색상 기준 전환';
  cmode.onclick=()=>commit(()=>{ trip().colorBy = colorByMode()==='day'?'city':'day'; });
  bar.appendChild(cmode);
  // 여행 재생 — 경로를 따라 이동수단 아이콘이 달림 (재미)
  const playB=document.createElement('button'); playB.className='chip'; playB.id='playBtn';
  playB.textContent = play ? '⏹ 정지' : '▶️ 재생';
  playB.title='경로를 따라 이동 애니메이션';
  playB.onclick=playTrip;
  bar.appendChild(playB);
  const sep0=document.createElement('span'); sep0.style.cssText='width:1px;height:18px;background:#2a3457;margin:0 4px'; bar.appendChild(sep0);
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
  trip().days.forEach((d,i)=>{
    const b=document.createElement('button'); b.className='chip'+(activeDay===i+1?' active':''); b.title=d.title;
    b.innerHTML = colorByMode()==='day'
      ? `<span class="dot" style="background:${dayColor(i)};width:7px;height:7px;margin-right:4px"></span>D${i+1}`
      : 'D'+(i+1);
    b.onclick=()=>setScope(i+1, ()=>fitTo(d.spots.filter(hasLoc).map(s=>[s.lat,s.lng]),64,15));
    bar.appendChild(b);
  });
  const colors = cityColors();
  const sep=document.createElement('span'); sep.style.cssText='width:1px;height:18px;background:#2a3457;margin:0 4px'; bar.appendChild(sep);
  Object.entries(colors).forEach(([city,c])=>{
    const b=document.createElement('button'); b.className='chip citychip'; b.style.setProperty('--c',c); b.textContent=city;
    b.onclick=()=>{
      const pts=[]; trip().days.forEach(d=>d.spots.forEach(s=>{if(s.city===city&&hasLoc(s))pts.push([s.lat,s.lng])}));
      fitTo(pts,80,15);
    };
    bar.appendChild(b);
  });
  // 여행 전체 예상 비용
  const tc=tripCost();
  if(tc){ const sep2=document.createElement('span'); sep2.style.cssText='width:1px;height:18px;background:#2a3457;margin:0 4px'; bar.appendChild(sep2);
    const cb=document.createElement('span'); cb.className='chip'; cb.style.cssText='background:#2a2033;color:#e0b0ff;cursor:default';
    cb.textContent=`💳 여행 약 ₩${tc.toLocaleString()}`; cb.title='장소 예상비용 + 자차일 택시요금 합계'; bar.appendChild(cb); }
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
      const meta=[];
      if(s.cost){ const cu=CUR[s.cur], nk=cu&&s.cur!=='KRW'; meta.push(`<span class="cost"${nk?` title="${costLabel(s.cost,s.cur)}"`:''}>💳 ${nk?`${cu.sym}${fmtMoney(s.cost)} (₩${fmtMoney(toKRW(s.cost,s.cur))})`:`₩${fmtMoney(s.cost)}`}</span>`); }
      if(s.bookAt){
        const late=bookWarn? Math.round(etas[si]-bookMin) : 0;
        const bt=bookWarn
          ? `예약·입장 ${s.bookAt} · 도착 예상 ${hm(etas[si])} — 약 ${late}분 늦어요. 앞 일정을 줄이거나 예약을 옮기세요`
          : `예약·입장 ${s.bookAt} (상대가 정한 약속) — 도착 예상 ${hm(etas[si])}`;
        meta.push(`<span class="book${bookWarn?' bookwarn':''}" title="${escAttr(bt)}">🎫 ${esc(s.bookAt)}${bookWarn?' ⚠️':''}</span>`);
        // 예약 시각까지 기다리는 시간(타임라인에 반영됨) — 숨은 동작을 눈에 보이게
        const w=Math.round(tl[si].wait||0);
        if(w>0) meta.push(`<span class="book" title="${escAttr(`도착 예상 ${hm(etas[si])} → 예약 ${s.bookAt}까지 대기. 다음 장소 도착 예상에 이 대기가 반영됩니다`)}">⏳ ${w}분 대기</span>`);
      }
      { const bu=safeUrl(s.bookUrl); if(bu) meta.push(`<a class="book" href="${escAttr(bu)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="예약 링크 열기">🔗</a>`); }
      // 영업시간 경고: 그 날 요일·도착 예상시각에 문 닫혀 있으면 ⚠️
      if(s.hours && iso){
        const wd=new Date(iso+'T00:00:00').getDay();
        const open=isOpenAt(s.hours, wd, Math.round(etas[si]));
        if(open===false) meta.push(`<span class="closed" title="${'일월화수목금토'[wd]}요일 도착 예상 ${hm(etas[si])}에 영업 종료/휴무 — 시간을 확인하세요">🚫 영업시간 확인</span>`);
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
        <span class="nm" onclick="focusSpot(${di},${si})"><span class="eta${tl[si].fixed?' fixed':''}" title="${escAttr(etaTip)}">${tl[si].fixed?'📌':''}${hm(etas[si])}${showConflict?'⚠️':''}</span>${si+1}. ${s.stay?'🏠 ':''}${esc(s.name)}${(s.stay&&stayNights(s)>1)?` <span class="opt">${stayNights(s)}박</span>`:''}${s.opt?' <span class=opt>(선택)</span>':''}${hasLoc(s)?'':`<span class="noloc" onclick="event.stopPropagation();openSpotModal(${di},${si})">📍 위치 지정</span>`}${metaHtml}</span>${legHtml}
        <span class="tools">
          <button class="iconb mvup" onclick="moveSpot(${di},${si},-1)" title="위로">▲</button>
          <button class="iconb mvdown" onclick="moveSpot(${di},${si},1)" title="아래로">▼</button>
          <button class="iconb" onclick="openSpotModal(${di},${si})" title="편집">✎</button>
        </span></div>`;
    });
    card.innerHTML=`<div class="dayHead">
        <span><span class="dragHandle" title="드래그로 일자 순서 변경">⠿</span> Day ${di+1} · ${esc(day.title)}</span>
        <span style="display:flex;align-items:center;gap:6px">${dayWeatherHtml(day,di)}<button class="iconb modeBtn" onclick="event.stopPropagation();cycleMode(${di})" title="이동 수단: ${MODE_NAME[dm]} — 클릭해서 변경">${MODE_ICON[dm]}</button><span class="date" onclick="event.stopPropagation();openDayModal(${di})" style="cursor:pointer" title="클릭해서 날짜·시간대 지정/수정">${dateOf(di)||'📅 날짜 지정'} · ${timeZone?`🌐 ${esc(timeZone)}`:'⚠️ 시간대 확인'}</span>
        <span class="tools"><button class="iconb" onclick="event.stopPropagation();openDayModal(${di})">✎</button></span></span>
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
        ${(()=>{const rt=dayRoute(day); if(rt) return `<div class="dist">📏 하루 동선 약 ${(rt.m/1000).toFixed(1)}km · ${MODE_ICON[dm]}${fmtDur(rt.sec)}${((dm==='car'||dm==='taxi')&&rt.taxi)?` · 🚕약 ${rt.taxi.toLocaleString()}원`:''} <span style="opacity:.55">(${dm==='flight'?'직선':'도로 기준'})</span></div>`;
          return dayDistance(day)>0?`<div class="dist">📏 하루 동선 약 ${dayDistance(day).toFixed(1)}km <span style="opacity:.55">(직선)</span></div>`:'';})()}
        ${(()=>{const e=dayEndMin(day, ctx.anchor); return (e!=null&&e>22*60)?`<div class="overload" title="시작시각+체류+이동 기준 예상 종료">⚠️ 일정 과밀 — 예상 종료 ${hm(e)}${e>=24*60?' (익일)':''}</div>`:'';})()}
        ${(()=>{const dc=dayCost(day); const tx=(dayRoute(day)||{}).taxi||0; const road=(dm==='car'||dm==='taxi'); const tot=dc+(road?tx:0);
          return tot?`<div class="dist">💳 하루 비용 약 ₩${tot.toLocaleString()}${(dc&&road&&tx)?` <span style="opacity:.55">(장소 ₩${dc.toLocaleString()} + 택시 ₩${tx.toLocaleString()})</span>`:''}</div>`:'';})()}
        ${carry?`<div class="spot carry" style="--c:#7a86ad" title="전날 숙소 — 오늘 첫 일정으로 자동 이월 (탭하면 지도에서 보기 · 장소 편집의 🏠 숙소 체크로 관리)"><span class="nm" onclick="focusLatLng(${+carry.lat},${+carry.lng})"><span class="eta">🏠</span> ${esc(carry.name)} <span class="opt">전날 숙소</span></span></div>`:''}
        <div class="spotList" data-di="${di}">${spotsHtml}</div>
        <button class="addSpot" onclick="openSpotModal(${di},-1)">＋ 장소 추가</button>${day.spots.filter(hasLoc).length>=3?`<button class="addSpot optBtn" onclick="optimizeDay(${di})" title="이 날의 방문 순서를 이동거리 최소로 재배열">🧭 동선 최적화</button>`:''}
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
window.focusSpot=(di,si)=>{
  const s=trip().days[di].spots[si];
  if(!hasLoc(s)){ openSpotModal(di,si); return; }   // 위치 미지정이면 지정 모달 열기
  if(activeDay && activeDay!==di+1){ activeDay=0; render(); }
  if(!ME().ready()) return;
  ME().panTo(+s.lat, +s.lng, 13);
  setTimeout(()=>{ const m=markers.find(m=>m.spot===s); if(m) m.open(); },400);
};
// 좌표로 지도 포커스 (전날 숙소 이월 항목 탭 등 — 특정 spot 인덱스가 없을 때)
window.focusLatLng=(lat,lng)=>{
  if(activeDay){ activeDay=0; render(); }             // 필터 걸려 해당 핀이 숨겨져 있을 수 있어 전체로
  if(!ME().ready()) return;
  ME().panTo(+lat, +lng, 13);
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

// ───────────────── 장소 모달 ─────────────────
let editing = null; // {di, si} si=-1이면 추가
let _pickedHours = null;   // 검색 결과에서 선택한 영업시간 (저장 시 반영)
// 모달을 열 때 자동으로 채운 도시값(일자 첫 장소 기준 등). 사용자가 손대지 않은 '자동 프리필'인 동안엔
// 지도 클릭·검색 지정으로 실제 도시를 덮어써도 되지만, 직접 입력한 값은 보존한다.
let _cityPrefill = '';
let _namePrefill = '';   // 자동 채운 이름(검색/역지오코딩) — 사용자 입력과 구분
window.openSpotModal=(di,si)=>{
  if(viewMode){ toast('읽기전용 보기입니다 — "내 여행으로 저장" 후 편집하세요','#8892b0'); return; }
  editing={di,si};
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
  document.getElementById('spotLat').value=s.lat; document.getElementById('spotLng').value=s.lng;
  document.getElementById('coordHint').textContent = s.lat?`좌표: ${(+s.lat).toFixed(4)}, ${(+s.lng).toFixed(4)}`:'좌표: 미지정 (검색 또는 지도 클릭)';
  document.getElementById('spotSearch').value=''; document.getElementById('searchRes').innerHTML='';
  const daySel=document.getElementById('spotDay');
  daySel.innerHTML=trip().days.map((d,i)=>`<option value="${i}" ${i===di?'selected':''}>Day ${i+1} · ${esc(d.title||dateOf(i))}</option>`).join('');
  document.getElementById('spotModalBg').classList.add('show');
};
document.getElementById('spotCancel').onclick=()=>document.getElementById('spotModalBg').classList.remove('show');
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
    hours:_pickedHours||undefined,lat,lng};
  const targetDay=parseInt(document.getElementById('spotDay').value);
  const isEdit=editing.si>=0;
  if(isEdit && targetDay===editing.di){
    trip().days[targetDay].spots[editing.si]=s;         // 같은 날 편집은 제자리 교체 (맨 뒤로 밀지 않음)
  }else{
    if(isEdit) trip().days[editing.di].spots.splice(editing.si,1);   // 다른 날로 옮길 때만 이동
    trip().days[targetDay].spots.push(s);
  }
  // 고정 시각이 있으면 그날을 시간순으로 자동 정렬 (제자리 편집이라 시각이 그대로면 순서 안 바뀜)
  const sorted = trip().days[targetDay].spots.some(x=>x.at) && sortDayByTime(trip().days[targetDay]);
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
        fillNameValue(it.name, true);   // 검색 결과 선택은 명시적 → 기존 이름도 그 장소 이름으로 갱신
        document.getElementById('coordHint').textContent=`좌표: ${(+it.lat).toFixed(4)}, ${(+it.lng).toFixed(4)} ✓`+(it.hours?' · 영업시간 반영됨':'');
        if(it.city) fillCityValue(it.city);              // 결과가 아는 도시로 즉시 채움(신뢰성↑)
        else fillCityFromCoords(it.lat, it.lng, false);  // 없으면 역지오코딩 폴백
        _pickedHours = it.hours||null;   // 저장 시 spot.hours로 반영
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
  if(trip().days[editingDay].spots.length && !confirm('이 일자의 장소도 함께 삭제됩니다. 계속할까요?'))return;
  const snap=snapshot();
  trip().days.splice(editingDay,1); activeDay=0;
  document.getElementById('dayModalBg').classList.remove('show'); commit(); toast('일자 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};

// ───────────────── 여행 관리 ─────────────────
document.getElementById('tripSel').onchange=e=>{ commit(()=>{ store.activeId=e.target.value; activeDay=0; }, {fit:fitEntry}); };
document.getElementById('newTripBtn').onclick=()=>{
  const name=prompt('새 여행 이름은?','새 여행'); if(name===null)return;
  const t={id:uid(),name:name||'새 여행',start:new Date().toISOString().slice(0,10),days:[{title:'',drive:'',note:'',spots:[]}]};
  commit(()=>{ store.trips.push(t); store.activeId=t.id; activeDay=0; });
  document.getElementById('tripModalBg').classList.add('show');
  document.getElementById('tripName').value=t.name; document.getElementById('tripStart').value=t.start;
  document.getElementById('tripTimeZone').value='';
};
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
    day.spots.forEach((s,si)=>{
      html+=`<div style="font-size:12px;margin-top:5px"><span style="color:#f6bd60;font-weight:700;font-size:10.5px">${hm(etas[si])}</span> ${si+1}. ${s.stay?'🏠 ':''}${esc(s.name)}${s.opt?' <span style="color:#8892b0;font-size:10.5px">(선택)</span>':''}</div>`;
    });
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
        if(status===S.OK && data) return res({list:data.map(d=>({name:d.place_name, addr:d.road_address_name||d.address_name||'', city:cityFromKoreanAddr(d.address_name||d.road_address_name||''), lat:+d.y, lng:+d.x})), err:null});
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
    const req={textQuery:q, fields:['displayName','formattedAddress','addressComponents','location','regularOpeningHours'], maxResultCount:limit||5, language:'en'};   // 해외 장소는 영문명
    if(near) req.locationBias={center:near, radius:30000};
    const {places}=await Place.searchByText(req);
    return {list:(places||[]).map(p=>({name:placeName(p), addr:p.formattedAddress||'', city:cityFromGoogle(p.addressComponents),
      lat:p.location.lat(), lng:p.location.lng(), hours:normHours(p.regularOpeningHours)})), err:null};
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
  if(!d.spots.length){ list.innerHTML='<div style="color:#9aa5c4;font-size:13px;padding:20px 4px">이 날은 등록된 장소가 없습니다 — 이동일이거나 자유 일정</div>'; return; }
  // 전날 숙소 이월: Day 2+에서 전날 숙소가 있으면 상단에 가상 항목으로 표시(오늘 데이터엔 복제 안 함).
  // 타임라인·첫 장소 구간이 숙소에서 출발하도록 prevLoc/etas를 숙소로 시드 (사이드바·재생과 동일 기준).
  const ctx=dayContext(di), carry=ctx.carry, tl=ctx.timeline, iso=isoDateOf(di);
  const etas=tl.map(x=>x.eta), dm=ctx.mode;   // ETA는 anchor 기준(사이드바·이미지와 동일)
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
    div.innerHTML=`<div class="n"><span class="eta">${hm(etas[si])}</span>${si+1}. ${s.stay?'🏠 ':''}${esc(s.name)}${s.opt?' <span style="font-size:11px;color:#8892b0">(선택)</span>':''}</div>`+
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
}

// ───────────────── 로그인 · 클라우드 동기화 (Supabase) ─────────────────
const SUPA_URL='https://gdnhrwtfidjimtabgovh.supabase.co';
const SUPA_KEY='sb_publishable_2C-n1YFvE9Cw9B7L7B6Trw_XO3Val5q';
if(window.supabase){
  sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  sb.auth.onAuthStateChange((_e, session)=>{
    user = session?.user || null;
    updateAuthUI();
    if(user) syncOnLogin();
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
  syncTimer=setTimeout(()=>{ const t=trip(); if(t) syncTripCloud(t); },delay!=null?delay:800);
}
async function syncTripCloud(t,opts){
  if(!sb||!user||!t) return;
  if(t.id==='spain2026'&&!(syncMeta[t.id]&&syncMeta[t.id].revision)) return;
  const entry=syncEntry(t.id), force=!!(opts&&opts.force);
  if(entry.status==='conflict'&&!force) return;
  entry.status='syncing'; persistSyncMeta();
  try{
    const row=await rpcRow('sync_trip',{p_client_id:t.id,p_data:t,p_expected_revision:entry.revision,p_force:force});
    if(!row) throw new Error('empty sync response');
    if(row.conflict){
      entry.revision=Number(row.revision)||entry.revision; entry.status='conflict'; persistSyncMeta();
      enqueueSyncConflict({kind:row.deleted_at?'remote-deleted':'changed-both',local:t,remote:row.data||null,revision:entry.revision,deleted_at:row.deleted_at||null});
      return;
    }
    entry.revision=Number(row.revision)||1; entry.status='clean'; entry.op=''; persistSyncMeta();
    cloudSnapshot(t,entry.revision);
  }catch(e){
    entry.status='error'; persistSyncMeta();
    reportOperationalError('cloud.sync',e);
    clearTimeout(cloudRetryT);
    cloudRetryT=setTimeout(()=>syncTripCloud(t),15000);
    toast('클라우드 저장 실패 — 로컬 편집은 보존됨','#e63946',{label:'재시도',fn:()=>syncTripCloud(t)});
  }
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
      entry.revision=Number(row.revision)||entry.revision; entry.status='conflict'; persistSyncMeta();
      enqueueSyncConflict({kind:row.deleted_at?'remote-deleted':'changed-both',local:deletedTrip||null,remote:row.data||null,revision:entry.revision,deleted_at:row.deleted_at||null});
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
  if(c.local) syncMeta[c.local.id]={revision:c.revision,status:c.deleted_at?'tombstoned':'clean',op:''};
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
        if(!returnFocus.has(bg)) returnFocus.set(bg,document.activeElement);
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
      const busy = pickMode || searching || _importing
        || !!document.querySelector('.modalBg.show') || document.getElementById('travel').classList.contains('show');
      if(busy){ toast('새 버전이 있어요 — 탭해서 새로고침', '#1d6fd6', {label:'새로고침', fn:()=>location.reload()}); }
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
render();
