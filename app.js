// ───────────────── 저장소 ─────────────────
const LS_KEY = 'tripcanvas_v1';
const PALETTE = ['#e63946','#f6b93b','#1e88e5','#2ecc71','#9b59b6','#ff7f50','#14b8a6','#ec4899','#8d6e63','#a3e635'];   // 빨강·노랑·파랑·초록·보라·코랄·청록·핑크·브라운·라임
let store = null;
let sb = null, user = null, syncTimer = null;   // Supabase 클라이언트/로그인 사용자/동기화 디바운스

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
  try{ store = JSON.parse(localStorage.getItem(LS_KEY)); }catch(e){}
  if(!store || !store.trips || !store.trips.length){
    store = {trips:[seedSpain()], activeId:'spain2026'};
    save();
  }
}
let viewMode=null;   // #v= 읽기전용으로 보는 여행 (저장소에 저장 안 함)
// 다단계 실행취소: save 시점마다 직전 상태를 스택에 보관 (최대 30)
let histStack=[], histLast=null, histLock=false;
function save(){
  if(viewMode) return;   // 읽기전용 보기에선 아무것도 저장하지 않음
  const ser=JSON.stringify(store);
  if(!histLock && histLast!==null && histLast!==ser){
    histStack.push(histLast);
    if(histStack.length>30) histStack.shift();
    updateUndoBtn();
  }
  histLast=ser;
  try{ localStorage.setItem(LS_KEY, ser); }
  catch(e){ toast('저장 공간이 부족합니다. 오래된 여행을 내보내고 삭제해 주세요','#e63946'); }
  cloudSyncActive();
}
function updateUndoBtn(){ const b=document.getElementById('undoBtn'); if(b) b.disabled=!histStack.length; }
function undo(){
  if(viewMode) return;
  if(!histStack.length){ toast('되돌릴 작업이 없습니다','#8892b0'); return; }
  histLock=true;
  store=JSON.parse(histStack.pop());
  histLast=JSON.stringify(store);
  if(!store.trips.find(t=>t.id===store.activeId)) store.activeId=store.trips[0]&&store.trips[0].id;
  activeDay=0; render(); fitAll();
  histLock=false;
  updateUndoBtn();
  toast('실행취소됨','#8892b0');
}
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){
    if(e.target.matches('input,textarea,select'))return;   // 입력 중엔 브라우저 기본 동작
    e.preventDefault(); undo();
  }
});
function trip(){ return viewMode || store.trips.find(t=>t.id===store.activeId) || store.trips[0]; }
function uid(){ return Math.random().toString(36).slice(2,9); }
// 공유 링크/가져오기/AI 파싱으로 외부 데이터가 유입될 수 있으므로 출력 시 항상 이스케이프 (XSS 방어)
function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(v){ return esc(v); }
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
function undoWith(snap){ store=snap; activeDay=0; render(); fitAll(); }

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
  document.getElementById('spotModalBg').classList.add('show');
}
window.__gmapsReady=function(){
  map=new google.maps.Map(document.getElementById('map'),{
    center:{lat:40,lng:-3.7}, zoom:6, mapId:'DEMO_MAP_ID',
    disableDefaultUI:true, zoomControl:true, clickableIcons:false, gestureHandling:'greedy'
  });
  iw=new google.maps.InfoWindow();
  map.addListener('click',e=>onMapPick(e.latLng.lat(), e.latLng.lng()));
  render();
  google.maps.event.addListenerOnce(map,'idle',()=>{ if(engine==='google') fitEntry(); });   // 레이아웃 확정 후 초기 포커싱
};
(function(){
  const s=document.createElement('script');
  s.src=`https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&v=weekly&libraries=places,marker,geometry&loading=async&callback=__gmapsReady`;
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
  return true;
}
// 좌표 있는 스팟 과반이 한국이면 카카오 엔진
function desiredEngine(){
  let kr=0,n=0;
  trip().days.forEach(d=>d.spots.forEach(s=>{ if(hasLoc(s)){ n++; if(inKorea({lat:+s.lat,lng:+s.lng})) kr++; } }));
  return (n>0 && kr/n>=0.5) ? 'kakao' : 'google';
}
function setEngine(e){
  if(engine===e) return;
  engine=e;
  document.getElementById('map').style.display = e==='google'?'block':'none';
  document.getElementById('kmap').style.display = e==='kakao'?'block':'none';
  if(e==='kakao'&&kmap){ kmap.relayout(); }
  setTimeout(()=>fitEntry(),60);   // 전환 직후 새 엔진 기준으로 포커싱
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
function toISO(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
// di번째 날의 ISO 날짜 (시작일 미설정 시 빈 문자열)
function isoDateOf(di){ if(!trip().start) return ''; const d=new Date(trip().start+'T00:00:00'); d.setDate(d.getDate()+di); return toISO(d); }
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
function haversine(a,b){
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function dayDistance(day){
  const loc=day.spots.filter(hasLoc); let sum=0;
  for(let i=1;i<loc.length;i++) sum+=haversine(loc[i-1],loc[i]);
  return sum;
}

// ── 구간 소요시간 (자동차) — 국내 카카오내비 · 해외 Google Routes, localStorage 캐시 ──
const KAKAO_REST_KEY='48e05420d9dcc072915ff99412669995';   // 카카오내비 REST (CORS 허용 확인됨)
const LEG_KEY='tripcanvas_legs_v3';   // v3: 이동수단(mode)별 캐시 + 도로 스냅
let legCache={};
try{ legCache=JSON.parse(localStorage.getItem(LEG_KEY))||{}; }catch(e){}
// 이동 수단 (일자별): car 자차 · transit 대중교통 · walk 도보 · bike 자전거
const MODE_ICON={car:'🚗',transit:'🚌',walk:'🚶',bike:'🚴'};
const MODE_NAME={car:'자차',transit:'대중교통',walk:'도보',bike:'자전거'};
const MODE_SPEED={car:40,transit:25,walk:4.5,bike:15};   // km/h — 미캐시 구간 추정용
function dayModeOf(day){ return MODE_ICON[day.mode]? day.mode : 'car'; }
function legId(a,b){ return `${(+a.lat).toFixed(4)},${(+a.lng).toFixed(4)}>${(+b.lat).toFixed(4)},${(+b.lng).toFixed(4)}`; }
function legKey(a,b,mode){ return legId(a,b)+'#'+(mode||'car'); }
function saveLegCache(){ try{ localStorage.setItem(LEG_KEY, JSON.stringify(legCache)); }catch(e){} }
function fmtDur(sec){ const m=Math.round(sec/60); return m<60? `${m}분` : `${Math.floor(m/60)}시간${m%60? ' '+(m%60)+'분':''}`; }
// 좌표 배열 → 구글 인코딩 폴리라인 (캐시 용량 절약). geometry 라이브러리 필요
function encodePts(pts){
  if(!window.google||!google.maps.geometry||!pts.length) return null;
  const step=Math.max(1, Math.floor(pts.length/300));   // 최대 ~300점으로 다운샘플
  const sampled=pts.filter((_,i)=>i%step===0); if(sampled[sampled.length-1]!==pts[pts.length-1]) sampled.push(pts[pts.length-1]);
  return google.maps.geometry.encoding.encodePath(sampled.map(p=>new google.maps.LatLng(p.lat,p.lng)));
}
function decodePts(enc){
  if(!window.google||!google.maps.geometry||!enc) return null;
  try{ return google.maps.geometry.encoding.decodePath(enc).map(ll=>({lat:ll.lat(),lng:ll.lng()})); }catch(e){ return null; }
}
// 카카오내비 1회 호출 — 성공 시 {rt}, 실패 시 {code} (102 출발지·103 도착지 주변 도로 없음)
async function kakaoTry(a,b){
  try{
    const u=`https://apis-navi.kakaomobility.com/v1/directions?origin=${a.lng},${a.lat}&destination=${b.lng},${b.lat}`;
    const r=await fetch(u,{headers:{Authorization:'KakaoAK '+KAKAO_REST_KEY}});
    if(!r.ok) return {code:-1};
    const js=await r.json();
    const rt=js.routes&&js.routes[0];
    if(!rt) return {code:-1};
    if(rt.result_code!==0||!rt.summary) return {code:rt.result_code};
    return {rt};
  }catch(e){ return {code:-1}; }
}
// p 주변 반경 r(m)의 8방위 후보점 — 도로 없는 좌표(바다·산)를 인근 도로로 스냅할 때 사용
function ringPts(p,r){
  const dLat=r/111320, dLng=r/(111320*Math.cos(p.lat*Math.PI/180));
  const out=[];
  for(let k=0;k<8;k++){ const th=k*Math.PI/4; out.push({lat:p.lat+dLat*Math.sin(th), lng:p.lng+dLng*Math.cos(th)}); }
  return out;
}
function buildKakaoResult(rt, orig, snapped){
  const pts=[];
  (rt.sections||[]).forEach(sec=>(sec.roads||[]).forEach(rd=>{
    const v=rd.vertexes||[];
    for(let i=0;i+1<v.length;i+=2) pts.push({lat:v[i+1],lng:v[i]});
  }));
  if(snapped && pts.length){ pts.unshift({lat:+orig.a.lat,lng:+orig.a.lng}); pts.push({lat:+orig.b.lat,lng:+orig.b.lng}); }
  return {sec:rt.summary.duration, m:rt.summary.distance, path:encodePts(pts),
    taxi:(rt.summary.fare&&rt.summary.fare.taxi)||0, snapped:snapped?1:0};
}
// 카카오내비 경로 — 도로 없는 끝점(102/103)은 링 프로브로 인근 도로에 스냅해 재시도
async function kakaoRoute(a,b){
  const orig={a,b};
  let A={lat:+a.lat,lng:+a.lng}, B={lat:+b.lat,lng:+b.lng}, snapped=false;
  for(let attempt=0; attempt<3; attempt++){
    const {rt,code}=await kakaoTry(A,B);
    if(rt) return buildKakaoResult(rt, orig, snapped);
    const fixA=code===102, fixB=code===103;
    if(!fixA&&!fixB) return null;
    const base=fixA?A:B;
    let hit=null;
    outer:
    for(const r of [500,1000,1600,2400]){
      for(const cand of ringPts(base,r)){
        const t=await kakaoTry(fixA?cand:A, fixA?B:cand);
        if(t.rt) return buildKakaoResult(t.rt, orig, true);
        // 반대쪽 끝점 오류로 바뀌었으면 이 후보는 도로 위 — 채택하고 반대쪽을 다음 루프에서 스냅
        if(fixA? t.code===103 : t.code===102){ hit=cand; break outer; }
      }
    }
    if(!hit) return null;
    if(fixA) A=hit; else B=hit;
    snapped=true;
  }
  return null;
}
// 구간 라벨 — 수단 아이콘 + 시간 (자차는 2km 미만이면 도보 대안 시간 표기)
function legLabel(c){
  const km=(c.m/1000).toFixed(1), mode=c.mode||'car';
  if(mode==='car' && c.m<2000){ const wm=Math.max(1,Math.round(c.m/75)); return `↳${km}km · 🚶${wm}분`; }
  return `↳${km}km · ${MODE_ICON[mode]}${fmtDur(c.sec)}`;
}
function legTitle(c){
  let t=(c.est?'자동차 경로 거리 기반 추정':'실제 도로 기준');
  if(c.snapped) t+=' · 인근 도로에서 출발/도착 (원 지점은 도로에서 멂)';
  if((c.mode||'car')==='car'&&c.taxi) t+=` · 택시 약 ${c.taxi.toLocaleString()}원`;
  return t;
}
const GMODE={car:'DRIVE',transit:'TRANSIT',walk:'WALK',bike:'BICYCLE'};
async function googleRoute(a,b,mode){
  const r=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':GMAPS_KEY,'X-Goog-FieldMask':'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'},
    body:JSON.stringify({origin:{location:{latLng:{latitude:+a.lat,longitude:+a.lng}}},
      destination:{location:{latLng:{latitude:+b.lat,longitude:+b.lng}}}, travelMode:GMODE[mode]||'DRIVE'})
  });
  if(!r.ok) return null;
  const js=await r.json();
  const rt=js.routes&&js.routes[0];
  if(!rt||!rt.duration) return null;
  return {sec:parseInt(rt.duration), m:rt.distanceMeters||0, path:(rt.polyline&&rt.polyline.encodedPolyline)||null};
}
// 수단·지역별 라우팅: 국내 car=카카오내비 / transit=구글 / walk·bike=카카오 자동차 경로 거리 기반 추정
//                     해외 4개 모드 모두 구글 Routes
async function fetchLeg(a,b,mode){
  const kr=inKorea(a)&&inKorea(b);
  if(kr){
    if(mode==='car'){ const k=await kakaoRoute(a,b); return k&&{...k,mode}; }
    if(mode==='transit'){ const g=await googleRoute(a,b,'transit'); return g&&{...g,mode}; }
    const k=await kakaoRoute(a,b);                       // walk/bike: 도로 거리 기반 추정
    if(!k) return null;
    const mps=mode==='walk'?1.25:4.17;                   // 4.5km/h · 15km/h
    return {sec:Math.round(k.m/mps), m:k.m, path:k.path, snapped:k.snapped, est:1, mode};
  }
  const g=await googleRoute(a,b,mode);
  return g&&{...g,mode};
}
// 캐시에 있으면 즉시 반환, 없으면 큐에 넣고 null (완료 시 DOM 패치 + 사이드바 갱신)
let legQueue=[], legBusy=false, legRefreshT=null;
function requestLeg(a,b,mode){
  mode=MODE_ICON[mode]?mode:'car';
  const key=legKey(a,b,mode);
  const c=legCache[key];
  if(c && c.sec && !c.path){ delete legCache[key]; }   // 경로 없이 캐시된 항목(과거 레이스 오염) 자가 치유 → 재조회
  else if(c) return c.sec? c : null;                   // 실패 기록이면 재시도 안 함 (세션 캐시)
  if(!legQueue.find(q=>q.key===key)){ legQueue.push({key,mode,a:{lat:+a.lat,lng:+a.lng},b:{lat:+b.lat,lng:+b.lng}}); pumpLegs(); }
  return c&&c.sec? c : null;   // 재조회 중에도 기존 시간·거리는 계속 표시
}
async function pumpLegs(){
  if(legBusy) return; legBusy=true;
  // 경로 인코딩(encodePts)에 구글 geometry가 필요 — SDK 로드 전에 조회하면
  // 경로 없는 결과가 영구 캐시되므로, 준비될 때까지 대기 (최대 ~21초)
  for(let i=0;i<70 && !(window.google&&google.maps&&google.maps.geometry);i++) await sleep(300);
  while(legQueue.length){
    const {key,mode,a,b}=legQueue.shift();
    if(legCache[key]) continue;
    let r=null;
    try{ r=await fetchLeg(a,b,mode); }catch(e){}
    legCache[key] = r || {fail:Date.now()};
    if(r){
      saveLegCache();
      document.querySelectorAll(`[data-leg="${key}"]`).forEach(el=>{
        el.textContent=legLabel(r);
        el.title=legTitle(r);
      });
      document.querySelectorAll(`[data-ileg="${key}"]`).forEach(el=>{
        el.textContent=`${MODE_ICON[r.mode||'car']} 이전 일정에서 ${(r.m/1000).toFixed(1)}km · ${fmtDur(r.sec)}`;
      });
      clearTimeout(legRefreshT);
      legRefreshT=setTimeout(()=>render(),450);   // 하루 합계 + 지도 경로선 갱신
    }
  }
  legBusy=false;
}
// ── 타임라인 (도착 예상시각) ──
function parseHM(t){ const m=/^(\d{1,2}):(\d{2})$/.exec(t||''); return m? (+m[1])*60+(+m[2]) : 9*60; }
function hm(min){ min=((Math.round(min)%1440)+1440)%1440; return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }
// 구간 이동시간(분): 캐시된 경로 우선(자차 2km 미만은 도보 대안), 없으면 수단별 속도로 직선 추정
function legMinutes(a,b,mode){
  mode=MODE_ICON[mode]?mode:'car';
  const c=legCache[legKey(a,b,mode)];
  if(c&&c.sec) return (mode==='car'&&c.m<2000)? c.m/75 : c.sec/60;
  return haversine(a,b)/MODE_SPEED[mode]*60;
}
// 일자 시작시각(startAt, 기본 09:00)부터 체류시간(stayMin, 기본 60분)+이동시간 누적
function dayEtas(day){
  let t=parseHM(day.startAt), prev=null;
  const dm=dayModeOf(day);
  return day.spots.map(s=>{
    if(hasLoc(s)&&prev) t+=legMinutes(prev,s,dm);
    const eta=t;
    t+=(s.stayMin!=null? +s.stayMin : 60);
    if(hasLoc(s)) prev=s;
    return eta;
  });
}
// 하루 전체 실도로 합계 (모든 구간이 캐시됐을 때만)
function dayRoute(day){
  const loc=day.spots.filter(hasLoc), dm=dayModeOf(day);
  if(loc.length<2) return null;
  let sec=0,m=0,taxi=0;
  for(let i=1;i<loc.length;i++){
    const c=legCache[legKey(loc[i-1],loc[i],dm)];
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
  if(engine==='kakao'){
    const ov=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(+s.lat,+s.lng), content:pin, xAnchor:.5, yAnchor:.5, clickable:true});
    ov.setMap(kmap);
    pin.style.cursor='pointer';
    const open=()=>openKPopup(html, +s.lat, +s.lng);
    pin.onclick=open;
    markers.push({spot:s, open, km:ov});
  }else{
    const m=new google.maps.marker.AdvancedMarkerElement({map, position:{lat:+s.lat,lng:+s.lng}, content:pin});
    const open=()=>{ iw.setContent(`<div class="popupC">${html}</div>`); iw.open({map, anchor:m}); };
    m.addEventListener('gmp-click',open);
    markers.push({spot:s, open, gm:m});
  }
}
// 동선 라인 추가 (엔진 공용). dashed=일자 간 연결선
function addLine(pts,color,opacity,dashed){
  if(engine==='kakao'){
    const l=new kakao.maps.Polyline({path:pts.map(p=>new kakao.maps.LatLng(p.lat,p.lng)),
      strokeColor:color, strokeWeight:dashed?2:3, strokeOpacity:opacity, strokeStyle:dashed?'dash':'solid'});
    l.setMap(kmap); lines.push({km:l});
  }else{
    const opt={map, path:pts, geodesic:true};
    if(dashed){ Object.assign(opt,{strokeOpacity:0, icons:[{icon:{path:'M 0,-1 0,1', strokeOpacity:opacity, strokeColor:color, scale:2}, offset:'0', repeat:'14px'}]}); }
    else Object.assign(opt,{strokeColor:color, strokeWeight:3, strokeOpacity:opacity});
    lines.push({gm:new google.maps.Polyline(opt)});
  }
}
// 경로 중간의 소요시간 칩 (Day 보기 전용)
let legChips=[];
function addLegChip(pos,text){
  const el=document.createElement('div'); el.className='legChip'; el.textContent=text;
  if(engine==='kakao'){
    const ov=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(pos.lat,pos.lng), content:el, yAnchor:.5, clickable:false});
    ov.setMap(kmap); legChips.push({km:ov});
  }else{
    const m=new google.maps.marker.AdvancedMarkerElement({map, position:pos, content:el});
    legChips.push({gm:m});
  }
}
function clearOverlays(){
  markers.forEach(m=>{ if(m.gm) m.gm.map=null; if(m.km) m.km.setMap(null); }); markers=[];
  lines.forEach(l=>{ if(l.gm) l.gm.setMap(null); if(l.km) l.km.setMap(null); }); lines=[];
  legChips.forEach(c=>{ if(c.gm) c.gm.map=null; if(c.km) c.km.setMap(null); }); legChips=[];
  if(iw) iw.close(); closeKPopup();
}
// 오버레이 입력 시그니처 — 같으면 마커/라인 재생성 생략 (텍스트 편집 등에서 깜빡임·비용 제거)
let _ovSig='';
function overlaySig(t,colors){
  const p=[engine, activeDay, colorByMode()];
  t.days.forEach((day,di)=>{
    if(activeDay && di+1!==activeDay) return;
    p.push(dayModeOf(day));
    day.spots.forEach((s,si)=>{ if(hasLoc(s)) p.push(si,s.lat,s.lng,s.stay?1:0,s.opt?1:0,spotColor(s,di,colors),esc(s.name),esc(s.desc||'')); });
    const loc=day.spots.filter(hasLoc), dm=dayModeOf(day);
    for(let i=1;i<loc.length;i++){ const c=legCache[legKey(loc[i-1],loc[i],dm)]; p.push(c? (c.sec?(c.path?'p':'s'):'f') : 'n'); }
  });
  if(!activeDay){
    let prev=null;
    t.days.forEach(day=>{ const loc=day.spots.filter(hasLoc); if(!loc.length)return;
      if(prev){ const c=legCache[legKey(prev,loc[0],dayModeOf(day))]; p.push('I', c? (c.sec?(c.path?'p':'s'):'f') : 'n'); } prev=loc[loc.length-1]; });
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
  const mapReady = engine==='kakao'? !!kmap : !!map;
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
      const locSpots = day.spots.filter(hasLoc), dm=dayModeOf(day);
      const lc=spotColor(locSpots[0]||{},di,colors), lop=activeDay?0.9:0.45;
      for(let i=1;i<locSpots.length;i++){
        const A=locSpots[i-1], B=locSpots[i];
        const cch=legCache[legKey(A,B,dm)];
        if(!cch) continue;   // 조회 중 — 선 없이 대기 (완료 시 디바운스 재렌더로 채워짐)
        const path=(cch.sec&&cch.path)?decodePts(cch.path):null;
        addLine(path||[{lat:+A.lat,lng:+A.lng},{lat:+B.lat,lng:+B.lng}], lc, lop, false);
        // Day 보기에선 경로 중간에 소요시간 칩
        if(activeDay && cch.sec){
          const mid = path? path[Math.floor(path.length/2)]
                          : {lat:(+A.lat + +B.lat)/2, lng:(+A.lng + +B.lng)/2};
          addLegChip(mid, (dm==='car'&&cch.m<2000)? `🚶${Math.max(1,Math.round(cch.m/75))}분` : `${MODE_ICON[dm]}${fmtDur(cch.sec)}`);
        }
      }
    });
    // 일자 간 연결 (전체 보기) — 점선. 동일하게 조회 중엔 미표시
    if(!activeDay){
      let prev = null;
      t.days.forEach(day=>{
        const loc = day.spots.filter(hasLoc);
        if(!loc.length) return;
        if(prev){
          const cch=legCache[legKey(prev,loc[0],dayModeOf(day))];
          if(cch){
            const path=(cch.sec&&cch.path)?decodePts(cch.path):null;
            addLine(path||[{lat:+prev.lat,lng:+prev.lng},{lat:+loc[0].lat,lng:+loc[0].lng}], '#f6bd60', .8, true);
          }
        }
        prev = loc[loc.length-1];
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
  if(!pts.length) return;
  if(engine==='kakao' && kmap){
    const b=new kakao.maps.LatLngBounds();
    pts.forEach(p=>b.extend(new kakao.maps.LatLng(+p[0],+p[1])));
    kmap.relayout();
    kmap.setBounds(b, pad==null?48:pad);
    // 구글 zoom ≈ 19 - 카카오 level 근사로 과줌 방지
    if(maxZoom){ const minLv=Math.max(1,19-maxZoom); if(kmap.getLevel()<minLv) kmap.setLevel(minLv); }
    return;
  }
  if(!map) return;
  const b=new google.maps.LatLngBounds();
  pts.forEach(p=>b.extend({lat:+p[0],lng:+p[1]}));
  map.fitBounds(b, pad==null?48:pad);
  if(maxZoom) google.maps.event.addListenerOnce(map,'idle',()=>{ if(map.getZoom()>maxZoom) map.setZoom(maxZoom); });
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
function renderFilter(){
  const bar = document.getElementById('filterbar'); bar.innerHTML='';
  // 색상 기준 토글 (도시별 ↔ 일자별)
  const cmode=document.createElement('button'); cmode.className='chip';
  cmode.textContent = colorByMode()==='day' ? '🎨 일자별' : '🎨 도시별';
  cmode.title='핀·카드 색상 기준 전환';
  cmode.onclick=()=>{ trip().colorBy = colorByMode()==='day'?'city':'day'; render(); };
  bar.appendChild(cmode);
  const sep0=document.createElement('span'); sep0.style.cssText='width:1px;height:18px;background:#2a3457;margin:0 4px'; bar.appendChild(sep0);
  const all = document.createElement('button'); all.className='chip'+(activeDay?'':' active'); all.textContent='전체';
  all.onclick=()=>{activeDay=0;render();fitAll();}; bar.appendChild(all);
  trip().days.forEach((d,i)=>{
    const b=document.createElement('button'); b.className='chip'+(activeDay===i+1?' active':''); b.title=d.title;
    b.innerHTML = colorByMode()==='day'
      ? `<span class="dot" style="background:${dayColor(i)};width:7px;height:7px;margin-right:4px"></span>D${i+1}`
      : 'D'+(i+1);
    b.onclick=()=>{activeDay=i+1;render();
      const pts=d.spots.filter(hasLoc).map(s=>[s.lat,s.lng]);
      fitTo(pts,64,15);};
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
  let prevDayAnchor=null;   // 이전 일자의 마지막 위치 (일자 간 이동시간 계산)
  trip().days.forEach((day,di)=>{
    const headC = colorByMode()==='day' ? dayColor(di) : (day.spots.length?(colors[day.spots[0].city]||'#556'):'#556');
    const card=document.createElement('div'); card.className='dayCard'+(activeDay&&activeDay!==di+1?' dim':''); card.style.setProperty('--c',headC);
    let spotsHtml='', prevLoc=null;
    const etas=dayEtas(day), dm=dayModeOf(day);
    day.spots.forEach((s,si)=>{
      const dotC = hasLoc(s)?spotColor(s,di,colors):'#4a5170';
      // 구간: 캐시된 경로가 있으면 그걸, 아니면 직선거리 + 백그라운드 조회
      let legHtml='';
      if(hasLoc(s)&&prevLoc){
        const lid=legKey(prevLoc,s,dm), lc=requestLeg(prevLoc,s,dm);
        const failed=!lc && legCache[lid] && legCache[lid].fail;   // 인근 도로 스냅까지 실패
        legHtml = lc
          ? `<span class="leg" data-leg="${lid}" title="${legTitle(lc)}">${legLabel(lc)}</span>`
          : `<span class="leg${failed?' legfail':''}" data-leg="${lid}"${failed?' title="경로를 찾을 수 없어 직선거리로 표시 — 인근 도로 탐색(최대 2.4km)까지 실패했습니다. 장소 편집에서 검색으로 위치를 다시 잡아 보세요"':''}>↳${haversine(prevLoc,s).toFixed(1)}km${failed?' ⚠️':''}</span>`;
      }
      if(hasLoc(s)) prevLoc=s;
      spotsHtml+=`<div class="spot" data-di="${di}" data-si="${si}" style="--c:${dotC}">
        <span class="nm" onclick="focusSpot(${di},${si})"><span class="eta" title="도착 예상시각 (시작시각+체류+이동 기준)">${hm(etas[si])}</span>${si+1}. ${s.stay?'🏠 ':''}${esc(s.name)}${s.opt?' <span class=opt>(선택)</span>':''}${hasLoc(s)?'':`<span class="noloc" onclick="event.stopPropagation();openSpotModal(${di},${si})">📍 위치 지정</span>`}</span>${legHtml}
        <span class="tools">
          <button class="iconb mvup" onclick="moveSpot(${di},${si},-1)" title="위로">▲</button>
          <button class="iconb mvdown" onclick="moveSpot(${di},${si},1)" title="아래로">▼</button>
          <button class="iconb" onclick="openSpotModal(${di},${si})" title="편집">✎</button>
        </span></div>`;
    });
    card.innerHTML=`<div class="dayHead">
        <span><span class="dragHandle" title="드래그로 일자 순서 변경">⠿</span> Day ${di+1} · ${esc(day.title)}</span>
        <span style="display:flex;align-items:center;gap:6px"><button class="iconb modeBtn" onclick="event.stopPropagation();cycleMode(${di})" title="이동 수단: ${MODE_NAME[dm]} — 클릭해서 변경">${MODE_ICON[dm]}</button><span class="date" onclick="event.stopPropagation();openDayModal(${di})" style="cursor:pointer" title="클릭해서 날짜 지정/수정">${dateOf(di)||'📅 날짜 지정'}</span>
        <span class="tools"><button class="iconb" onclick="event.stopPropagation();openDayModal(${di})">✎</button></span></span>
      </div><div class="dayBody">
        ${day.drive?`<div class="drive">${esc(day.drive)}</div>`:''}
        ${(()=>{   // 일자 간 자동 이동시간: 이전 일자 마지막 → 오늘 첫 장소
          const first=day.spots.find(hasLoc);
          if(!prevDayAnchor||!first) return '';
          const iid=legKey(prevDayAnchor,first,dm), ic=requestLeg(prevDayAnchor,first,dm);
          return ic
            ? `<div class="drive" style="color:#9fb8e8" title="이전 일자 마지막 장소 기준 · ${legTitle(ic)}"><span data-ileg="${iid}">${MODE_ICON[dm]} 이전 일정에서 ${(ic.m/1000).toFixed(1)}km · ${fmtDur(ic.sec)}</span></div>`
            : `<div class="drive" style="color:#9fb8e8"><span data-ileg="${iid}">${MODE_ICON[dm]} 이전 일정에서 직선 ${haversine(prevDayAnchor,first).toFixed(1)}km</span></div>`;
        })()}
        ${(()=>{const rt=dayRoute(day); if(rt) return `<div class="dist">📏 하루 동선 약 ${(rt.m/1000).toFixed(1)}km · ${MODE_ICON[dm]}${fmtDur(rt.sec)}${(dm==='car'&&rt.taxi)?` · 🚕약 ${rt.taxi.toLocaleString()}원`:''} <span style="opacity:.55">(도로 기준)</span></div>`;
          return dayDistance(day)>0?`<div class="dist">📏 하루 동선 약 ${dayDistance(day).toFixed(1)}km <span style="opacity:.55">(직선)</span></div>`:'';})()}
        <div class="spotList" data-di="${di}">${spotsHtml}</div>
        <button class="addSpot" onclick="openSpotModal(${di},-1)">＋ 장소 추가</button>
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
    // 일자 간 기준점: 숙소(🏠)가 있으면 숙소, 없으면 마지막 위치
    const locAll=day.spots.filter(hasLoc);
    const stay=locAll.filter(s=>s.stay).pop();
    if(stay) prevDayAnchor=stay;
    else if(locAll.length) prevDayAnchor=locAll[locAll.length-1];
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
  add.onclick=()=>{ trip().days.push({title:'',drive:'',note:'',spots:[]}); render(); openDayModal(trip().days.length-1); };
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
  setTimeout(()=>{ render(); toast('일자 순서 변경됨'); },0);
}
// 장소 순서/일자 이동 핸들러 (Sortable)
function onSpotDrop(evt){
  const fromDi=+evt.from.dataset.di, toDi=+evt.to.dataset.di;
  if(fromDi===toDi && evt.oldIndex===evt.newIndex) return;
  const fromSpots=trip().days[fromDi].spots, toSpots=trip().days[toDi].spots;
  const [moved]=fromSpots.splice(evt.oldIndex,1);
  toSpots.splice(evt.newIndex,0,moved);
  setTimeout(()=>{ render(); if(fromDi!==toDi) toast(`Day ${toDi+1}(으)로 이동`); },0);
}
window.focusSpot=(di,si)=>{
  const s=trip().days[di].spots[si];
  if(!hasLoc(s)){ openSpotModal(di,si); return; }   // 위치 미지정이면 지정 모달 열기
  if(activeDay && activeDay!==di+1){ activeDay=0; render(); }
  if(engine==='kakao' && kmap){
    kmap.panTo(new kakao.maps.LatLng(+s.lat,+s.lng));
    if(kmap.getLevel()>6) kmap.setLevel(6);   // ≈ 구글 z13
  }else if(map){
    map.panTo({lat:+s.lat,lng:+s.lng});
    if(map.getZoom()<13) map.setZoom(13);
  }else return;
  setTimeout(()=>{ const m=markers.find(m=>m.spot===s); if(m) m.open(); },400);
};
// 화살표 이동: 도구 항상 노출 + 옮긴 장소를 커서 아래에 고정(스크롤 보정)해 연속 클릭 가능
// 일자 카드의 수단 아이콘 탭 → 자차→대중교통→도보→자전거 순환 (상세 설정은 일자 편집 모달)
window.cycleMode=(di)=>{
  if(viewMode) return;
  const order=['car','transit','walk','bike'];
  const d=trip().days[di];
  d.mode=order[(order.indexOf(dayModeOf(d))+1)%order.length];
  render();
  toast(`Day ${di+1} 이동 수단: ${MODE_ICON[d.mode]} ${MODE_NAME[d.mode]}`);
};
window.moveSpot=(di,si,dir)=>{
  if(viewMode) return;
  const arr=trip().days[di].spots, ni=si+dir;
  if(ni<0||ni>=arr.length)return;
  const sb=document.getElementById('sidebar');
  const btnCls = dir<0?'mvup':'mvdown';
  const before=document.querySelector(`.spot[data-di="${di}"][data-si="${si}"] .${btnCls}`)?.getBoundingClientRect().top;
  [arr[si],arr[ni]]=[arr[ni],arr[si]]; render();
  const afterBtn=document.querySelector(`.spot[data-di="${di}"][data-si="${ni}"] .${btnCls}`);
  const after=afterBtn?.getBoundingClientRect().top;
  if(before!=null && after!=null) sb.scrollTop += (after-before); // 같은 버튼이 커서 자리에 오도록
};

// ───────────────── 장소 모달 ─────────────────
let editing = null; // {di, si} si=-1이면 추가
window.openSpotModal=(di,si)=>{
  if(viewMode){ toast('읽기전용 보기입니다 — "내 여행으로 저장" 후 편집하세요','#8892b0'); return; }
  editing={di,si};
  const isNew = si<0;
  document.getElementById('spotModalTitle').textContent = isNew?'장소 추가':'장소 편집';
  document.getElementById('spotDelBtn').style.display = isNew?'none':'block';
  const s = isNew? {name:'',city:trip().days[di].spots[0]?.city||'',desc:'',opt:false,lat:'',lng:''} : trip().days[di].spots[si];
  document.getElementById('spotName').value=s.name;
  document.getElementById('spotCity').value=s.city;
  document.getElementById('spotDesc').value=s.desc||'';
  document.getElementById('spotOpt').checked=!!s.opt;
  document.getElementById('spotStay').checked=!!s.stay;
  document.getElementById('spotStayMin').value=(s.stayMin!=null? s.stayMin : 60);
  document.getElementById('spotLat').value=s.lat; document.getElementById('spotLng').value=s.lng;
  document.getElementById('coordHint').textContent = s.lat?`좌표: ${(+s.lat).toFixed(4)}, ${(+s.lng).toFixed(4)}`:'좌표: 미지정 (검색 또는 지도 클릭)';
  document.getElementById('spotSearch').value=''; document.getElementById('searchRes').innerHTML='';
  const daySel=document.getElementById('spotDay');
  daySel.innerHTML=trip().days.map((d,i)=>`<option value="${i}" ${i===di?'selected':''}>Day ${i+1} · ${esc(d.title||dateOf(i))}</option>`).join('');
  document.getElementById('spotModalBg').classList.add('show');
};
document.getElementById('spotCancel').onclick=()=>document.getElementById('spotModalBg').classList.remove('show');
document.getElementById('spotSave').onclick=()=>{
  const name=document.getElementById('spotName').value.trim();
  const lat=parseFloat(document.getElementById('spotLat').value), lng=parseFloat(document.getElementById('spotLng').value);
  if(!name){toast('이름을 입력하세요','#e63946');return;}
  if(isNaN(lat)||isNaN(lng)){toast('위치를 지정하세요 (검색 또는 지도 클릭)','#e63946');return;}
  const s={name,city:document.getElementById('spotCity').value.trim()||'기타',desc:document.getElementById('spotDesc').value.trim(),
    opt:document.getElementById('spotOpt').checked,stay:document.getElementById('spotStay').checked,
    stayMin:Math.max(0,parseInt(document.getElementById('spotStayMin').value)||60),lat,lng};
  const targetDay=parseInt(document.getElementById('spotDay').value);
  if(editing.si>=0){ trip().days[editing.di].spots.splice(editing.si,1); }
  trip().days[targetDay].spots.push(s);
  document.getElementById('spotModalBg').classList.remove('show');
  render(); toast('저장됨');
};
document.getElementById('spotDelBtn').onclick=()=>{
  const snap=snapshot();
  trip().days[editing.di].spots.splice(editing.si,1);
  document.getElementById('spotModalBg').classList.remove('show');
  render(); toast('장소 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};
// 장소 검색 — 국내(한글)는 카카오 우선, 그 외 Google Places (routedSearch)
let searching=false;
async function doSearch(){
  const q=document.getElementById('spotSearch').value.trim(); if(!q)return;
  if(searching) return;
  const res=document.getElementById('searchRes');
  searching=true;
  res.innerHTML='<div>검색 중…</div>';
  try{
    // 편집 중인 일자의 기존 도시를 앵커로 활용 (있으면 주변 우선)
    const city=document.getElementById('spotCity').value.trim();
    const anchor=city? await cityAnchorOf(city) : null;
    const list=await routedSearch(q, anchor, 5);
    res.innerHTML = list.length? '' : '<div>결과 없음 — 다른 키워드나 지도 클릭으로 지정해주세요</div>';
    list.forEach(it=>{
      const d=document.createElement('div');
      d.textContent=it.name+(it.addr?` — ${it.addr}`:'');
      d.onclick=()=>{
        document.getElementById('spotLat').value=it.lat; document.getElementById('spotLng').value=it.lng;
        if(!document.getElementById('spotName').value) document.getElementById('spotName').value=it.name;
        document.getElementById('coordHint').textContent=`좌표: ${(+it.lat).toFixed(4)}, ${(+it.lng).toFixed(4)} ✓`;
        res.innerHTML='';
      };
      res.appendChild(d);
    });
  }catch(e){ res.innerHTML='<div>검색 실패 — 지도 클릭으로 지정해주세요</div>'; }
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
  document.getElementById('dayMode').value=dayModeOf(d);
  document.getElementById('dayTitle').value=d.title||'';
  document.getElementById('dayDrive').value=d.drive||'';
  document.getElementById('dayNote').value=d.note||'';
  document.getElementById('dayModalBg').classList.add('show');
};
document.getElementById('dayCancel').onclick=()=>document.getElementById('dayModalBg').classList.remove('show');
document.getElementById('daySave').onclick=()=>{
  const d=trip().days[editingDay];
  d.title=document.getElementById('dayTitle').value.trim();
  d.startAt=document.getElementById('dayStart').value||'09:00';
  d.mode=document.getElementById('dayMode').value;
  d.drive=document.getElementById('dayDrive').value.trim();
  d.note=document.getElementById('dayNote').value.trim();
  // 이 날짜에 맞춰 여행 시작일 역산 (Day들은 시작일 기준 연속) — 빈 값이면 시작일 해제
  const dv=document.getElementById('dayDate').value;
  if(dv){ const nd=new Date(dv+'T00:00:00'); nd.setDate(nd.getDate()-editingDay); trip().start=toISO(nd); }
  else { trip().start=''; }
  document.getElementById('dayModalBg').classList.remove('show'); render(); toast('저장됨');
};
document.getElementById('dayDelBtn').onclick=()=>{
  if(trip().days[editingDay].spots.length && !confirm('이 일자의 장소도 함께 삭제됩니다. 계속할까요?'))return;
  const snap=snapshot();
  trip().days.splice(editingDay,1); activeDay=0;
  document.getElementById('dayModalBg').classList.remove('show'); render(); toast('일자 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};

// ───────────────── 여행 관리 ─────────────────
document.getElementById('tripSel').onchange=e=>{ store.activeId=e.target.value; activeDay=0; render(); fitEntry(); };
document.getElementById('newTripBtn').onclick=()=>{
  const name=prompt('새 여행 이름은?','새 여행'); if(name===null)return;
  const t={id:uid(),name:name||'새 여행',start:new Date().toISOString().slice(0,10),days:[{title:'',drive:'',note:'',spots:[]}]};
  store.trips.push(t); store.activeId=t.id; activeDay=0; render();
  document.getElementById('tripModalBg').classList.add('show');
  document.getElementById('tripName').value=t.name; document.getElementById('tripStart').value=t.start;
};
document.getElementById('tripEditBtn').onclick=()=>{
  document.getElementById('tripName').value=trip().name;
  document.getElementById('tripStart').value=trip().start||'';
  document.getElementById('tripModalBg').classList.add('show');
  loadSnapList();
};
document.getElementById('tripCancel').onclick=()=>document.getElementById('tripModalBg').classList.remove('show');
document.getElementById('tripSave').onclick=()=>{
  trip().name=document.getElementById('tripName').value.trim()||'이름 없는 여행';
  trip().start=document.getElementById('tripStart').value;
  document.getElementById('tripModalBg').classList.remove('show'); render(); toast('저장됨');
};
document.getElementById('tripDelBtn').onclick=()=>{
  if(!confirm(`"${trip().name}" 여행을 삭제할까요?`))return;
  const snap=snapshot();
  cloudDelete(store.activeId);   // 로그인 상태면 클라우드에서도 삭제
  store.trips=store.trips.filter(t=>t.id!==store.activeId);
  if(!store.trips.length){ store.trips=[{id:uid(),name:'새 여행',start:new Date().toISOString().slice(0,10),days:[{title:'',drive:'',note:'',spots:[]}]}]; }
  store.activeId=store.trips[0].id; activeDay=0;
  document.getElementById('tripModalBg').classList.remove('show'); render(); fitEntry();
  // undo 시 삭제된 여행이 다시 활성화되어 render→save로 클라우드에도 재업로드됨
  toast('여행 삭제됨','#8892b0',{fn:()=>undoWith(snap)});
};

// ───────────────── 내보내기/가져오기/공유 ─────────────────
document.getElementById('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(trip(),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=trip().name.replace(/\s+/g,'_')+'.json'; a.click();
};
document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
document.getElementById('importFile').onchange=e=>{
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const t=JSON.parse(rd.result);
      if(!t.days) throw 0;
      t.id=uid(); store.trips.push(t); store.activeId=t.id; activeDay=0; render(); fitEntry(); toast('가져오기 완료');
    }catch(err){ toast('잘못된 파일입니다','#e63946'); }
  };
  rd.readAsText(f); e.target.value='';
};
// ── 일정 이미지 내보내기 (PNG, html2canvas 지연 로드) ──
let _h2cReady=null;
function loadH2C(){
  if(_h2cReady!==null) return _h2cReady;
  _h2cReady=new Promise(res=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
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
    const etas=dayEtas(day);
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
// 읽기전용 보기에서 내 저장소로 복사
document.getElementById('roSave').onclick=()=>{
  if(!viewMode) return;
  const t=JSON.parse(JSON.stringify(viewMode));
  t.id=uid(); t.name=t.name||'공유된 여행';
  viewMode=null; document.body.classList.remove('readonly');
  document.getElementById('roBar').style.display='none';
  history.replaceState(null,'',location.pathname);
  store.trips.push(t); store.activeId=t.id; activeDay=0;
  save(); render(); fitEntry(); toast('내 여행으로 저장되었습니다');
};
// 공유 링크로 열었을 때 — #v= 읽기전용 보기 / #t= 구버전(즉시 저장) 호환
(function(){
  load(); loadCfg();
  const h=location.hash;
  if(h.startsWith('#v=')){
    try{
      const t=JSON.parse(LZString.decompressFromEncodedURIComponent(h.slice(3)));
      if(t&&t.days){
        t.name=(t.name||'공유된 여행');
        viewMode=t;
        document.body.classList.add('readonly');
        document.getElementById('roBar').style.display='flex';
        setTimeout(()=>toast('읽기전용으로 보는 중입니다'),400);
      }
    }catch(e){}
  }else if(h.startsWith('#t=')){
    try{
      const t=JSON.parse(LZString.decompressFromEncodedURIComponent(h.slice(3)));
      if(t&&t.days){
        t.id=uid(); t.name=(t.name||'공유된 여행');
        store.trips.push(t); store.activeId=t.id; save();
        history.replaceState(null,'',location.pathname);
        setTimeout(()=>toast('공유된 여행을 불러왔습니다'),400);
      }
    }catch(e){}
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
- 성해광장 | 다롄 | 세계 최대 도심 광장
- (선택) 러시아 거리 | 다롄

[Day 2] 시내
- 여순 감옥 | 다롄`;
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
async function kakaoSearch(q, near, limit){
  if(!(await loadKakao())) return [];
  const run=opts=>new Promise(res=>{
    try{
      new kakao.maps.services.Places().keywordSearch(q,(data,status)=>{
        if(status!==kakao.maps.services.Status.OK||!data) return res([]);
        res(data.map(d=>({name:d.place_name, addr:d.road_address_name||d.address_name||'', lat:+d.y, lng:+d.x})));
      },opts);
    }catch(e){ res([]); }
  });
  const size=Math.min(limit||5,15);
  if(near){
    const r=await run({size, location:new kakao.maps.LatLng(near.lat,near.lng), radius:20000});
    if(r.length) return r;
  }
  return run({size});
}
// Google Places 텍스트 검색 (신 API) → [{name,addr,lat,lng}]
async function googlePlaces(q, near, limit){
  if(!map) return [];
  try{
    const {Place}=await google.maps.importLibrary('places');
    const req={textQuery:q, fields:['displayName','formattedAddress','location'], maxResultCount:limit||5, language:'ko'};
    if(near) req.locationBias={center:near, radius:30000};
    const {places}=await Place.searchByText(req);
    return (places||[]).map(p=>({name:p.displayName, addr:p.formattedAddress||'',
      lat:p.location.lat(), lng:p.location.lng()}));
  }catch(e){ return []; }
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
function inKorea(p){ return p && p.lat>=33 && p.lat<=39 && p.lng>=124.5 && p.lng<=132; }
// 서술형 꼬리말 제거 ("감포 바다"→"감포", 괄호 표기 제거)
function simplifyName(n){
  return String(n||'').replace(/\([^)]*\)/g,'')
    .replace(/\s*(앞바다|바다|해변|해수욕장|일대|근처|주변|전경|야경|거리|풍경)\s*$/,'').trim();
}
// 질의 하나를 라우팅해 검색 (국내 앵커면 카카오 우선→구글 폴백, 해외면 구글)
async function routedSearch(q, near, limit){
  const korean = near? inKorea(near) : /[가-힣]/.test(q);
  if(korean){
    const k=await kakaoSearch(q, near, limit);
    if(k.length) return k;
  }
  return googlePlaces(q, near, limit);
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
function parseDirect(text){
  const out={name:'',start:'',days:[]};
  let cur=null, lastCity='';
  text.split(/\r?\n/).forEach(raw=>{
    const line=raw.trim(); if(!line) return; let m;
    if(m=line.match(/^여행\s*이름\s*[:：]\s*(.+)$/)){ out.name=m[1].trim(); return; }
    if(m=line.match(/^시작일\s*[:：]\s*(.+)$/)){ out.start=m[1].trim(); return; }
    if(m=line.match(/^\[?\s*day\s*\d+\s*\]?\s*(.*)$/i)){ cur={title:m[1].trim(),drive:'',note:'',spots:[]}; out.days.push(cur); return; }
    if(line.startsWith('#')){ cur={title:line.slice(1).trim(),drive:'',note:'',spots:[]}; out.days.push(cur); return; }
    if(!cur){ cur={title:'',drive:'',note:'',spots:[]}; out.days.push(cur); }
    if(m=line.match(/^이동\s*[:：]\s*(.+)$/)){ cur.drive=m[1].trim(); return; }
    if(m=line.match(/^메모\s*[:：]\s*(.+)$/)){ cur.note=(cur.note?cur.note+'\n':'')+m[1].trim(); return; }
    if(m=line.match(/^[-•*·]\s*(.+)$/)){
      let body=m[1].trim(), opt=false, stay=false;
      if(/^\(선택\)/.test(body)){ opt=true; body=body.replace(/^\(선택\)\s*/,''); }
      if(/^\(숙소\)/.test(body)){ stay=true; body=body.replace(/^\(숙소\)\s*/,''); }
      const p=body.split('|').map(x=>x.trim());
      if(p[1]) lastCity=p[1];
      let lat=null,lng=null;
      if(p[3]){ const mm=p[3].match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/); if(mm){ lat=+mm[1]; lng=+mm[2]; } }
      cur.spots.push({name:p[0]||'',city:p[1]||lastCity||out.name||'기타',desc:p[2]||'',opt,stay,lat,lng});
      return;
    }
    cur.note=(cur.note?cur.note+'\n':'')+line;
  });
  return out;
}

// 자연어 → 구조화 (Claude API, 브라우저 직접 호출)
async function parseAI(text){
  if(!cfg.apiKey) throw new Error('AI 파싱을 쓰려면 API 키를 입력해줘');
  const system=`너는 여행 일정 파서다. 사용자의 자유로운 여행 설명을 받아 JSON으로만 변환해라.
스키마: {"name":string,"start":"YYYY-MM-DD"|null,"days":[{"title":string,"drive":string,"note":string,"spots":[{"name":string,"city":string,"desc":string,"opt":boolean,"stay":boolean,"lat":number|null,"lng":number|null}]}]}
- stay는 숙소(호텔·에어비앤비 등)면 true.
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
  }catch(e){ toast(e.message||'파싱 실패','#e63946'); return; }
  if(!parsed||!Array.isArray(parsed.days)||!parsed.days.length){ toast('일정을 못 읽었어 — 형식을 확인해줘','#e63946'); return; }
  // 정규화
  parsed.days=parsed.days.map(d=>({
    title:d.title||'', drive:d.drive||'', note:d.note||'',
    spots:(d.spots||[]).map(s=>({name:(s.name||'').trim(), city:(s.city||'기타').trim(), desc:s.desc||'',
      opt:!!s.opt, stay:!!s.stay, lat:(s.lat==null?null:+s.lat), lng:(s.lng==null?null:+s.lng)})).filter(s=>s.name)
  }));
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
  // 적용
  if(target==='append'){
    trip().days.push(...parsed.days);
    if(parsed.start&&!trip().start) trip().start=parsed.start;
  }else{
    const t={id:uid(), name:parsed.name||'붙여넣은 여행', start:parsed.start||new Date().toISOString().slice(0,10), days:parsed.days};
    store.trips.push(t); store.activeId=t.id;
  }
  activeDay=0;
  document.getElementById('pasteModalBg').classList.remove('show');
  render(); fitEntry();
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
  const etas=dayEtas(d), dm=dayModeOf(d);
  let prevLoc=null;
  d.spots.forEach((s,si)=>{
    // 구간 이동 정보 (이전 장소 → 이 장소)
    if(hasLoc(s)&&prevLoc){
      const c=requestLeg(prevLoc,s,dm);
      const lg=document.createElement('div'); lg.className='tLeg';
      lg.textContent = c
        ? ((dm==='car'&&c.m<2000)? `🚶 ${Math.max(1,Math.round(c.m/75))}분 · ${(c.m/1000).toFixed(1)}km`
                   : `${MODE_ICON[dm]} ${fmtDur(c.sec)} · ${(c.m/1000).toFixed(1)}km${(dm==='car'&&c.taxi)?` · 🚕약 ${c.taxi.toLocaleString()}원`:''}`)
        : `↘ 직선 ${haversine(prevLoc,s).toFixed(1)}km`;
      list.appendChild(lg);
    }
    if(hasLoc(s)) prevLoc=s;
    const div=document.createElement('div'); div.className='tSpot'; div.style.setProperty('--c',spotColor(s,di,colors));
    div.innerHTML=`<div class="n"><span class="eta">${hm(etas[si])}</span>${si+1}. ${s.stay?'🏠 ':''}${esc(s.name)}${s.opt?' <span style="font-size:11px;color:#8892b0">(선택)</span>':''}</div>`+
      `<div class="d">${esc(s.desc).replace(/\n/g,'<br>')}</div>`+
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
// 활성 여행을 클라우드에 저장(디바운스 800ms)
function cloudSyncActive(){
  if(!sb || !user) return;
  clearTimeout(syncTimer);
  syncTimer=setTimeout(async()=>{
    const t=trip(); if(!t) return;
    const {error}=await sb.from('trips').upsert(
      {user_id:user.id, client_id:t.id, data:t, updated_at:new Date().toISOString()},
      {onConflict:'user_id,client_id'});
    if(error) console.warn('cloud sync:', error.message);
    else cloudSnapshot(t);
  }, 800);
}
// 버전 히스토리: 여행별 10분에 1회 스냅샷, 최근 15개 유지
const _snapAt={};
async function cloudSnapshot(t){
  if(!sb || !user) return;
  const now=Date.now();
  if(_snapAt[t.id] && now-_snapAt[t.id]<10*60*1000) return;
  _snapAt[t.id]=now;
  try{
    await sb.from('trip_snapshots').insert({client_id:t.id, name:t.name, data:t});
    // 오래된 스냅샷 정리 (최근 15개만 유지)
    const {data:rows}=await sb.from('trip_snapshots').select('id')
      .eq('client_id',t.id).order('created_at',{ascending:false}).range(15,100);
    if(rows&&rows.length) await sb.from('trip_snapshots').delete().in('id',rows.map(r=>r.id));
  }catch(e){}
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
      if(fe||!full||!full.data){ toast('복원 실패','#e63946'); return; }
      const idx=store.trips.findIndex(t=>t.id===store.activeId);
      if(idx>=0) store.trips[idx]=full.data;
      document.getElementById('tripModalBg').classList.remove('show');
      activeDay=0; render(); fitEntry(); toast('복원되었습니다 (↩️로 되돌리기 가능)');
    };
    row.appendChild(btn); box.appendChild(row);
  });
}
async function cloudDelete(clientId){
  if(!sb || !user) return;
  try{ await sb.from('trips').delete().eq('client_id', clientId); }catch(e){}
}
// 로그인 직후: 클라우드를 당겨오고, 로컬에만 있던 여행은 업로드해 보존
async function syncOnLogin(){
  try{
    const {data:rows,error}=await sb.from('trips').select('client_id,data');
    if(error) throw error;
    const cloud=new Map((rows||[]).map(r=>[r.client_id, r.data]));
    for(const t of store.trips){
      if(!cloud.has(t.id)){
        await sb.from('trips').upsert({user_id:user.id, client_id:t.id, data:t, updated_at:new Date().toISOString()},{onConflict:'user_id,client_id'});
        cloud.set(t.id, t);
      }
    }
    const trips=[...cloud.values()].filter(t=>t && Array.isArray(t.days));
    if(trips.length){
      store.trips=trips;
      if(!trips.find(t=>t.id===store.activeId)) store.activeId=trips[0].id;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    activeDay=0; render(); fitAll();
    toast(`클라우드 동기화 완료 · 여행 ${trips.length}개`);
  }catch(e){ toast('클라우드 동기화 실패 — 로컬로 계속 사용','#e63946'); }
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

// ───────────────── PWA ─────────────────
// 오프라인 지도 캐시는 Google Maps 약관상 불가 — SW는 앱 셸 캐시만 담당
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

// 시작 — 사이드바 등 DOM 먼저 렌더, 지도·초기 포커싱은 __gmapsReady에서
render();
