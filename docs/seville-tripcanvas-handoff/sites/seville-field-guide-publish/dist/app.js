/* All tour progress and imported audio stay in this browser. */
(() => {
'use strict';
const DATA = window.GUIDE_DATA;
const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
 play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/></svg>',
 arrow:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>'
};
const defaults = {id:'01',view:'guide',mode:'summary',rate:0.92,voice:'',large:false,preset:'all',progress:{}};
let saved = {};
try { saved = JSON.parse(localStorage.getItem('our-seville-v1') || '{}'); } catch {}
const state = {...defaults,...saved,progress:saved.progress || {}};
if (!DATA.stops.some(s=>s.id===state.id)) state.id='01';
if (!['guide','map','route','find'].includes(state.view)) state.view='guide';
let photos = {}, audioRecords = new Map(), dbPromise, fileTarget, mapZoom=1, offlineReady=false;
let toastTimer, speechQueue=[], speechIndex=0, speechPaused=false, playbackMode=null, playingId=null, runToken=0;
const audio = new Audio();
let objectUrl = null;
const current = () => DATA.stops.find(s=>s.id===state.id);
const mainStops = () => DATA.stops.filter(s=>!s.optional);
const routeIds = () => state.preset==='short' ? ['01','02','03','04','05','06','10','12'] : mainStops().map(s=>s.id);
const nextStop = () => {
 const ids=routeIds(); let i=ids.indexOf(state.id);
 if(i<0) { if(state.id==='13') return DATA.stops.find(s=>s.id==='09'); if(state.id==='14') return DATA.stops.find(s=>s.id==='11'); return null; }
 return ids.slice(i+1).map(id=>DATA.stops.find(s=>s.id===id)).find(s=>state.progress[s.id]!=='skipped') || null;
};
function persist(){try{localStorage.setItem('our-seville-v1',JSON.stringify(state));}catch{}}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3600);}
function photoFor(stop){return photos[stop.photoKey] || null;}
function photoSource(p){return p ? (p.src || p.path || p.file || p.filename || '') : '';}
function photoCredit(p){return p ? `${p.author || p.artist || 'Wikimedia Commons'} · ${p.license || p.licenseName || '라이선스 정보'}` : '';}
function paragraphs(stop){return (state.mode==='summary'?stop.summary:stop.full).split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);}
function voiceOptions(){return ('speechSynthesis' in window) ? speechSynthesis.getVoices().filter(v=>/^ko([-_]|$)/i.test(v.lang)) : [];}
function selectedVoice(){const voices=voiceOptions();return voices.find(v=>v.voiceURI===state.voice)||voices.find(v=>v.localService)||voices[0];}
function numberLabel(s){return s.optional ? '선택 '+s.id : s.id;}
function statusText(s){return state.progress[s.id]==='done'?'관람 완료':state.progress[s.id]==='skipped'?'건너뜀':'';}

function renderSidebar(){
 const done=mainStops().filter(s=>state.progress[s.id]==='done').length;
 $('#sidebar').innerHTML=`<div class="sidebar-tabs"><button class="soft-button" data-view="map">위치 지도</button><button class="outline-button" data-view="find">사진으로 찾기</button><button class="outline-button" data-view="route">전체 코스</button></div><div class="sidebar-heading"><span>기본 관람 코스</span><span>12곳</span></div>${mainStops().map(s=>`<button class="sidebar-stop ${s.id===state.id?'active':''}" data-stop="${s.id}"><span class="num">${s.id}</span><span>${esc(s.name)}<small>${esc(s.zone)}</small></span><span class="status" aria-label="${statusText(s)}">${state.progress[s.id]==='done'?'✓':state.progress[s.id]==='skipped'?'—':''}</span></button>`).join('')}<div class="sidebar-heading" style="margin-top:24px"><span>선택해서 더 보기</span><span>2곳</span></div>${DATA.stops.filter(s=>s.optional).map(s=>`<button class="sidebar-stop ${s.id===state.id?'active':''}" data-stop="${s.id}"><span class="num">${s.id}</span><span>${esc(s.name)}<small>${esc(s.spanish)}</small></span></button>`).join('')}<div class="sidebar-foot"><strong>${done} / 12곳 관람</strong><div class="progress-track"><span style="width:${done/12*100}%"></span></div><p>잠시 멈추고, 마음껏 둘러보세요.</p><span class="offline-badge ${offlineReady?'ready':''}">${offlineReady?'사진·원고 오프라인 준비됨':'여행 전 오프라인 저장 권장'}</span></div>`;
}

function renderGuide(){
 const s=current(),p=photoFor(s),record=audioRecords.get(s.id),next=nextStop();
 const optional=s.id==='08'?DATA.stops.find(x=>x.id==='13'):s.id==='10'?DATA.stops.find(x=>x.id==='14'):null;
 $('#guideView').innerHTML=`<div class="stop-top"><span class="breadcrumbs">${s.optional?'선택 관람':s.zone+' · 기본 코스'}</span><span class="step-label">${s.optional?'추가 이야기':s.id+' / 12'}</span></div><div class="stop-title-line"><span class="large-num">${s.id}</span><h1>${esc(s.name)}</h1></div><p class="spanish" lang="es">${esc(s.spanish)}</p><figure class="hero-photo ${['murillo','goya','antigua','clemencia'].includes(s.photoKey)?'artwork':''}">${p?`<img src="${esc(photoSource(p))}" alt="${esc(p.caption || s.name+'의 실제 모습')}" loading="eager"><span class="photo-caption">${s.id==='01'?'대표 전경 · 입장문은 입장권 확인':'장소 확인용 실제 사진'}</span><button data-action="photo">사진 크게 보기 ↗</button>`:`<div class="photo-placeholder"><div><strong>${esc(s.name)}</strong><p>아래 표지와 세 가지 특징으로 장소를 확인하세요.</p></div></div>`}</figure><div class="hero-caption">${p?esc(photoCredit(p)):'현장 표지와 직원의 안내를 우선하세요.'}</div><div class="info-grid"><section class="arrival-card"><div class="section-kicker">먼저, 이곳이 맞는지</div><ul class="feature-list">${s.find.map(v=>`<li>${esc(v)}</li>`).join('')}</ul><div class="arrival-tools"><button class="soft-button" data-view="map">지도에서 위치 보기</button><button class="outline-button" data-action="ask">직원에게 보여주기</button></div></section><section class="audio-card"><div class="section-kicker">여기에서 잠깐 듣기</div><h3>${record?'연결한 음성':state.mode==='summary'?'핵심 이야기':'전체 역사 해설'}</h3><p>${record?'연결한 파일은 핵심·전체 선택과 관계없이 원래 길이로 재생합니다.':`사진과 표지가 맞으면 재생하세요.<br>기기에 설치된 한국어 음성으로 읽습니다.`}</p><button data-action="play">${icons.play} ${record?'내 음성 파일 재생':'기기 음성으로 듣기'}</button><button class="secondary-audio" data-action="import">${record?'음성 파일 바꾸기':'준비한 음성 파일 연결'}</button><span class="audio-tag">${record?esc(record.name):'전문 AI 음성 파일은 아직 연결되지 않았습니다.'}</span></section></div><section class="story-card"><div class="story-heading"><h2>알고 보면 더 보이는 것</h2><div class="segment" aria-label="해설 길이"><button data-mode="summary" class="${state.mode==='summary'?'active':''}" aria-pressed="${state.mode==='summary'}">핵심</button><button data-mode="full" class="${state.mode==='full'?'active':''}" aria-pressed="${state.mode==='full'}">전체 해설</button></div></div><div class="story-body ${state.large?'large':''}">${paragraphs(s).map((v,i)=>`<p data-paragraph="${i}">${esc(v)}</p>`).join('')}</div><div class="story-footer"><button class="text-button" data-action="copy">이 장소 원고 복사</button><button class="text-button" data-action="sources">출처·사진 정보</button><small>공식 지도 ${esc(s.official)}</small></div></section>${optional?`<div class="optional-link"><span>같은 방이 아닌 별도의 선택 장소<br><strong>${esc(optional.name)}</strong></span><button data-stop="${optional.id}">위치 확인 →</button></div>`:''}<div class="completion-actions"><button class="outline-button visited-button ${state.progress[s.id]==='done'?'done':''}" data-action="done">${state.progress[s.id]==='done'?'✓ 관람 완료 표시됨':'✓ 이곳 관람 완료'}</button><button class="outline-button" data-action="skip">닫혀 있거나 건너뛰기</button></div><section class="next-card"><div class="next-copy"><div class="section-kicker">다음에 갈 곳</div><h3>${next?next.id+' '+esc(next.name):'오늘의 관람 마무리'}</h3><p>${esc(s.next)}</p></div>${next?`<button class="primary-button" data-stop="${next.id}">다음 장소 확인 ${icons.arrow}</button>`:`<button class="outline-button" data-view="route">관람 기록 보기</button>`}</section>`;
}

function pin(s){if(!s.point)return '';const[x,y]=s.point;return `<g class="map-pin ${s.optional?'optional':''} ${s.id===state.id?'current':''}" transform="translate(${x} ${y})" role="button" tabindex="0" data-map-stop="${s.id}" aria-label="${s.id} ${esc(s.name)}"><rect x="-55" y="-55" width="110" height="110" fill="transparent" stroke="none"/><circle r="28"/><text y="1">${s.id}</text></g>`;}
function mapSvg(){return `<svg class="cathedral-map" viewBox="0 0 1000 910" aria-label="세비야 대성당 장소 위치 관계도"><text x="500" y="37" class="map-label">북쪽 · Calle Alemanes</text><rect x="275" y="65" width="430" height="220" rx="8" fill="#e0e8d9" stroke="#c3ceb9" stroke-width="2"/><g fill="#b5c79c">${[330,420,510,600,665].flatMap(x=>[105,185,245].map(y=>`<circle cx="${x}" cy="${y}" r="10"/>`)).join('')}</g><circle cx="500" cy="170" r="38" fill="#f3f1e4" stroke="#b7c8aa" stroke-width="2"/><text x="500" y="260" class="map-label">오렌지 정원</text><rect x="80" y="65" width="170" height="220" class="map-chapel"/><text x="165" y="220" class="map-label">사그라리오</text><rect x="805" y="110" width="122" height="180" rx="4" class="map-room"/><text x="865" y="297" class="map-label">히랄다</text><path d="M80 310H800Q930 460 800 615H80Z" class="map-structure"/><path d="M520 285H650V645H520Z" fill="#e6e6d9" stroke="#c4c8b8" stroke-width="2"/><g>${[100,190,280,370,460,690,780].map(x=>`<rect x="${x}" y="315" width="69" height="65" class="map-chapel"/><rect x="${x}" y="550" width="69" height="60" class="map-chapel"/>`).join('')}</g><g fill="#c5cabb">${[190,300,410,530,650,760].flatMap(x=>[405,510].map(y=>`<circle cx="${x}" cy="${y}" r="9"/>`)).join('')}</g><rect x="290" y="415" width="165" height="96" rx="4" class="map-room"/><path d="M310 433h125M310 493h125" stroke="#b1b9a4" stroke-width="12"/><rect x="610" y="415" width="110" height="96" rx="4" fill="#eee0b9" stroke="#c5ad72" stroke-width="2"/><text x="370" y="538" class="map-label">성가대석</text><text x="665" y="538" class="map-label">중앙 제단</text><text x="555" y="650" class="map-label">콜럼버스 기념묘</text><path d="M727 647H925V778H727Z" class="map-room"/><circle cx="827" cy="712" r="50" fill="#eee9dc" stroke="#c7c4b3"/><text x="827" y="800" class="map-label">대성물실</text><ellipse cx="705" cy="830" rx="80" ry="55" class="map-room"/><text x="705" y="903" class="map-label">참사회실</text><text x="183" y="710" class="map-label">남쪽 · Plaza del Triunfo</text>${DATA.stops.map(pin).join('')}</svg>`;}
function renderMap(){
 const s=current();
 $('#mapView').innerHTML=`<div class="page-intro"><div class="eyebrow">FIND YOUR PLACE</div><h1>지금 어디쯤일까요?</h1><p>숫자를 누르면 장소 이름과 확인할 특징이 나타납니다. 지도 숫자는 이 가이드의 오디오 번호입니다.</p></div><div class="map-legend"><span><i class="legend-dot"></i>기본 12곳</span><span><i class="legend-dot gold"></i>선택 장소 / 선택한 곳</span></div><div class="map-panel"><div class="map-toolbar"><button data-action="zoom-out" aria-label="지도 축소">−</button><button data-action="zoom-in" aria-label="지도 확대">＋</button></div><div class="map-scroll">${mapSvg()}</div><p class="map-note">방과 작품의 위치 관계를 단순화한 그림입니다. 실제 벽·출입문·보행 경로를 뜻하지 않습니다. 01은 입장 전 설명이며 특정 입장문을 지정하지 않습니다. 고야 그림(13)은 현장 표지와 직원에게 위치를 확인하세요.</p></div><section class="panel map-selected"><div><div class="eyebrow">${numberLabel(s)} · 공식 지도 ${esc(s.official)}</div><h3>${esc(s.name)}</h3><p lang="es">${esc(s.spanish)}</p><p>${esc(s.find[0])}</p></div><button class="primary-button" data-stop="${s.id}">사진으로 확인 ${icons.arrow}</button></section><button class="text-button" data-action="official-map">대성당 공식 원본 지도 보기 ↗</button>`;
 const svg=$('.cathedral-map');if(svg)svg.style.width=(mapZoom*100)+'%';
}
function renderRoute(){
 const done=mainStops().filter(s=>state.progress[s.id]==='done').length;
 const ids=routeIds();
 $('#routeView').innerHTML=`<div class="page-intro"><div class="eyebrow">OUR WALK</div><h1>우리 둘의 관람 코스</h1><p>모든 장소를 꼭 채울 필요는 없습니다. 한곳씩 보고, 듣고, 쉬어 가세요.</p></div><div class="panel" style="margin-bottom:22px"><div style="display:flex;justify-content:space-between"><strong>${done} / 12곳 관람 완료</strong><span class="muted" style="font-size:12px">이 기기에 기록</span></div><div class="progress-track"><span style="width:${done/12*100}%"></span></div></div><div class="preset-row" aria-label="관람 코스 선택"><button data-preset="all" class="${state.preset==='all'?'active':''}" aria-pressed="${state.preset==='all'}">기본 12곳</button><button data-preset="short" class="${state.preset==='short'?'active':''}" aria-pressed="${state.preset==='short'}">핵심 8곳</button></div><p class="muted" style="font-size:12px;margin-bottom:19px">추천 순서입니다. 입장 후 히랄다부터 시작하고, 이후에는 현장 통로와 개방 여부에 맞춰 조정하세요.</p><div class="route-list">${ids.map(id=>routeItem(DATA.stops.find(s=>s.id===id))).join('')}</div><h2 class="optional-heading">조금 더 보고 싶다면</h2><p class="muted" style="font-size:13px;margin-bottom:17px">다른 공간에 있는 두 작품을 별도의 선택 장소로 나누었습니다.</p><div class="route-list">${DATA.stops.filter(s=>s.optional).map(routeItem).join('')}</div><button class="text-button" style="margin-top:26px" data-action="reset">관람 기록 초기화</button>`;
}
function routeItem(s){const st=state.progress[s.id];return `<article class="route-item ${st==='done'?'done':st==='skipped'?'skipped':''}"><span class="route-num">${s.id}</span><div><h3>${esc(s.name)}<span class="route-badge">${st==='done'?'✓ 완료':st==='skipped'?'건너뜀':''}</span></h3><p>${esc(s.spanish)}</p><span class="pill">${s.optional?'선택 관람':'기본 장소'} · 공식 지도 ${esc(s.official)}</span></div><button class="route-open" data-stop="${s.id}" aria-label="${s.id} ${esc(s.name)} 열기">보기 →</button></article>`;}
function renderFind(){
 $('#findView').innerHTML=`<div class="page-intro"><div class="eyebrow">LOOK AROUND</div><h1>눈앞의 장소를 찾아보세요</h1><p>지금 보이는 모습과 닮은 사진을 고르세요. 표지 이름과 세 가지 특징으로 한 번 더 확인할 수 있습니다.</p></div><div class="help-banner">입구를 지나왔다면 <strong>큰 금빛 제단</strong>, <strong>네 인물이 메는 관</strong>, <strong>목제 성가대석</strong>이 찾기 쉬운 기준점입니다.</div><div class="photo-grid">${DATA.stops.filter(s=>s.n!==3).map(s=>{const p=photoFor(s);return `<button class="photo-tile" data-stop="${s.id}">${p?`<img src="${esc(photoSource(p))}" alt="${esc(p.caption||s.name)}" loading="lazy">`:`<div class="tile-placeholder">${esc(s.spanish)}</div>`}<div class="tile-copy"><span class="tile-number">${s.optional?'선택':'오디오'} ${s.id}</span><h3>${esc(s.name)}</h3><p>${esc(s.find[0])}</p></div></button>`;}).join('')}</div>`;
}
function render(){renderSidebar();renderGuide();renderMap();renderRoute();renderFind();showView(state.view,false);persist();}
function showView(view,scroll=true){state.view=view;for(const v of ['guide','map','route','find'])$('#'+v+'View').hidden=v!==view;$$('.bottom-nav button').forEach(b=>b.setAttribute('aria-current',b.dataset.view===view?'page':'false'));if(scroll)window.scrollTo({top:0,behavior:'auto'});persist();updateHash();}
function goTo(id){if(!DATA.stops.some(s=>s.id===id))return;stopPlayback();state.id=id;state.view='guide';render();window.scrollTo({top:0,behavior:'auto'});$('#main').focus({preventScroll:true});}
function updateHash(){try{history.replaceState(null,'',`#${state.view}/${state.id}`);}catch{}}
function readHash(){const m=location.hash.match(/^#(guide|map|route|find)\/(\d{2})$/);if(m&&DATA.stops.some(s=>s.id===m[2])){state.view=m[1];state.id=m[2];}}
function openSheet(title,html){$('#sheetTitle').textContent=title;$('#sheetContent').innerHTML=html;if(!$('#sheet').open)$('#sheet').showModal();}
function showAsk(){const s=current();openSheet('이 화면을 직원에게 보여 주세요',`<div class="eyebrow">${s.id} · ${esc(s.name)}</div><p class="big-spanish" lang="es">${esc(s.question)}</p><p class="muted">${esc(s.spanish)}의 위치를 찾고 있습니다.</p><div class="status-message">지도에서 찾기 어려우면 이 스페인어 문장을 보여 주세요.</div>`);}
function showPhoto(){const p=photoFor(current());if(!p)return;$('#largePhoto').src=photoSource(p);$('#largePhoto').alt=p.caption||current().name;$('#largePhotoCredit').innerHTML=`${esc(photoCredit(p))} · <a href="${esc(p.sourceUrl||p.source_url||'#')}" target="_blank" rel="noopener">사진 원본</a>`;$('#photoDialog').showModal();}
function showSources(){
 const s=current(),p=photoFor(s);
 const list=s.sources.map(id=>DATA.sources.find(x=>x.id===id)).filter(Boolean);
 openSheet('해설 출처와 사진 정보',`<p style="font-size:13px;margin-bottom:20px">역사 기록과 미술관·대성당 자료를 바탕으로 작성한 개인 여행용 해설입니다. 확인일: 2026년 10월 21일.</p><ul class="source-list">${list.map(v=>`<li><strong>${esc(v.title)}</strong><br><a href="${esc(v.url)}" target="_blank" rel="noopener">자료 열기 ↗</a></li>`).join('')}</ul>${p?`<div class="credit-block"><strong>장소 확인용 사진</strong><p>${esc(p.caption||s.name)}</p><p>${esc(photoCredit(p))}</p><p><a href="${esc(p.sourceUrl||p.source_url||'#')}" target="_blank" rel="noopener">Wikimedia Commons 원본</a> · <a href="${esc(p.licenseUrl||p.license_url||'#')}" target="_blank" rel="noopener">이용 허락</a></p><small>표시 크기에 맞춰 리사이즈·크롭했습니다.</small></div>`:''}`);
}
function showSettings(){
 const voices=voiceOptions(),voice=selectedVoice();
 openSheet('목소리와 여행 준비',`<div class="setting-row"><label for="voiceSelect">한국어 읽기 목소리</label><select id="voiceSelect">${voices.length?voices.map(v=>`<option value="${esc(v.voiceURI)}" ${voice&&v.voiceURI===voice.voiceURI?'selected':''}>${esc(v.name)}${v.localService?' · 기기 음성':''}</option>`).join(''):'<option>이 브라우저에서 한국어 음성을 찾지 못했습니다</option>'}</select><small>기기·브라우저의 읽기 기능입니다. 여행 전에 실제 발음과 속도를 시험하세요. 선택한 음성에 따라 인터넷 연결이 필요할 수 있습니다.</small></div><div class="setting-row"><label for="rateInput">읽는 속도 <span id="rateValue">${state.rate.toFixed(2)}배</span></label><input id="rateInput" type="range" min="0.7" max="1.2" step="0.05" value="${state.rate}"></div><div class="settings-actions"><button class="soft-button" data-action="voice-test">짧게 시험 듣기</button><button class="outline-button" data-action="large-text">${state.large?'본문 기본 글씨':'본문 큰 글씨'}</button></div><hr class="setting-divider"><h3>준비한 음성 파일 연결</h3><p class="muted" style="font-size:12px;margin:10px 0 15px">01_도입.mp3처럼 번호로 시작하는 파일을 한꺼번에 고를 수 있습니다. 파일은 이 브라우저에 저장하며 다른 기기로 자동 공유되지 않습니다.</p><button class="primary-button" data-action="import-all">여러 음성 파일 연결</button><div class="audio-file-list" style="margin-top:14px">${audioRecords.size?[...audioRecords.entries()].sort().map(([id,r])=>`<div>${id} ${esc(r.name)} <button data-remove-audio="${id}">연결 삭제</button></div>`).join(''):'아직 연결한 음성 파일이 없습니다.'}</div><hr class="setting-divider"><h3>인터넷 없이 볼 수 있게</h3><p class="muted" style="font-size:12px;margin:10px 0 15px">사진과 지도, 원고를 미리 저장합니다. 저장 뒤 비행기 모드에서 다시 열어 확인하세요. 기기 음성의 오프라인 재생 여부도 별도로 시험하는 것이 좋습니다.</p><button class="soft-button" data-action="offline">사진·지도·원고 저장</button><div class="status-message" id="offlineStatus">${offlineReady?'현재 버전의 사진과 원고가 저장되었습니다.':'먼저 인터넷에 연결된 상태에서 저장하세요.'}</div><p class="muted" style="font-size:11px">Safari에서는 공유 메뉴의 ‘홈 화면에 추가’로 꺼내 두면 찾기 편합니다.</p><hr class="setting-divider"><div class="settings-actions"><a class="outline-button" href="narration/all-narration.txt" download="seville-narration.txt">전체 낭독 원고 받기</a><button class="outline-button" data-action="official-map">공식 지도 보기 ↗</button></div>`);
}

function openDb(){if(!('indexedDB' in window))return Promise.reject(new Error('파일 저장을 지원하지 않는 브라우저입니다.'));if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('our-seville-audio-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return dbPromise;}
async function dbRequest(mode,action){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('audio',mode);const req=action(tx.objectStore('audio'));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function loadAudioRecords(){try{const records=await dbRequest('readonly',store=>store.getAll());audioRecords=new Map(records.map(r=>[r.id,r]));}catch{audioRecords=new Map();}}
async function importFiles(files){let count=0,failed=0;for(const f of files){const match=f.name.match(/^(\d{1,2})(?:[_\s.\-]|$)/);const id=match?match[1].padStart(2,'0'):(files.length===1?fileTarget:null);if(!id||!DATA.stops.some(s=>s.id===id)){failed++;continue;}const record={id,name:f.name,type:f.type,blob:f};try{await dbRequest('readwrite',store=>store.put(record));audioRecords.set(id,record);count++;}catch{failed++;}}render();if($('#sheet').open)showSettings();toast(`${count}개 음성 파일을 연결했습니다.${failed?' 번호 또는 저장 공간을 확인할 파일 '+failed+'개가 있습니다.':''}`);$('#audioImport').value='';}
function formatTime(v){if(!Number.isFinite(v))return '0:00';return `${Math.floor(v/60)}:${String(Math.floor(v%60)).padStart(2,'0')}`;}
function updatePlayer(){const box=$('#miniPlayer');box.hidden=!playingId;if(!playingId)return;const s=DATA.stops.find(x=>x.id===playingId);$('#miniName').textContent=`${s.id} ${s.name}`;$('#miniToggle').innerHTML=(playbackMode==='file'?audio.paused:speechPaused)?icons.play:'Ⅱ';$('#miniToggle').setAttribute('aria-label',(playbackMode==='file'?audio.paused:speechPaused)?'음성 계속 재생':'음성 일시정지');$('#miniProgress').textContent=playbackMode==='file'?`${formatTime(audio.currentTime)} / ${formatTime(audio.duration)} · 내 음성 파일`:`${state.mode==='summary'?'핵심':'전체'} 해설 · 문장 ${Math.min(speechIndex+1,speechQueue.length)} / ${speechQueue.length}`;}
function stopPlayback(){runToken++;if('speechSynthesis'in window)speechSynthesis.cancel();audio.pause();audio.currentTime=0;playingId=null;playbackMode=null;speechPaused=false;$$('.reading').forEach(e=>e.classList.remove('reading'));updatePlayer();}
async function playCurrent(){
 const s=current();stopPlayback();
 const record=audioRecords.get(s.id);
 if(record){try{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(record.blob);audio.src=objectUrl;playingId=s.id;playbackMode='file';await audio.play();updatePlayer();}catch{stopPlayback();toast('음성을 재생하지 못했습니다. 파일 형식을 확인하고 다시 눌러 주세요.');}return;}
 if(!('speechSynthesis'in window)){toast('이 브라우저는 기기 음성을 지원하지 않습니다. 음성 파일을 연결해 주세요.');return;}
 const voice=selectedVoice();if(!voice){toast('한국어 읽기 음성을 찾지 못했습니다. 설정에서 확인하거나 음성 파일을 연결해 주세요.');showSettings();return;}
 const para=paragraphs(s);
 speechQueue=[];
 para.forEach((v,p)=>{const sentences=v.match(/[^.!?。！？]+[.!?。！？]?/g)||[v];sentences.forEach(t=>{if(t.trim())speechQueue.push({text:t.trim(),paragraph:p});});});
 speechIndex=0;speechPaused=false;playingId=s.id;playbackMode='tts';const token=runToken;
 speakNext(token,voice);
}
function speakNext(token,voice){if(token!==runToken||!playingId)return;if(speechIndex>=speechQueue.length){playingId=null;playbackMode=null;$$('.reading').forEach(e=>e.classList.remove('reading'));updatePlayer();toast('해설이 끝났습니다. 충분히 둘러본 뒤 다음 장소로 이동하세요.');return;}const part=speechQueue[speechIndex];const utterance=new SpeechSynthesisUtterance(part.text);utterance.lang='ko-KR';utterance.voice=voice;utterance.rate=state.rate;utterance.onstart=()=>{$$('.reading').forEach(e=>e.classList.remove('reading'));$(`[data-paragraph="${part.paragraph}"]`)?.classList.add('reading');updatePlayer();};utterance.onend=()=>{if(token!==runToken)return;speechIndex++;setTimeout(()=>speakNext(token,voice),180);};utterance.onerror=e=>{if(e.error==='interrupted'||e.error==='canceled')return;stopPlayback();toast('기기 음성을 재생하지 못했습니다. 다시 시도하거나 음성 파일을 연결하세요.');};speechSynthesis.speak(utterance);updatePlayer();}
function togglePlayback(){if(!playingId)return;if(playbackMode==='file'){if(audio.paused)audio.play().catch(()=>toast('다시 재생 버튼을 눌러 주세요.'));else audio.pause();}else{speechPaused=!speechPaused;if(speechPaused)speechSynthesis.pause();else speechSynthesis.resume();}updatePlayer();}
audio.addEventListener('timeupdate',updatePlayer);audio.addEventListener('loadedmetadata',updatePlayer);audio.addEventListener('pause',updatePlayer);audio.addEventListener('play',updatePlayer);audio.addEventListener('ended',()=>{stopPlayback();toast('해설이 끝났습니다. 다음 장소는 직접 선택하세요.');});audio.addEventListener('error',()=>{if(playbackMode==='file'){stopPlayback();toast('파일을 읽지 못했습니다. MP3 또는 WAV 파일을 다시 연결해 주세요.');}});

async function copyNarration(){const s=current();const value=`${s.id}. ${s.name}\n\n${s.arrival}\n\n${s.full}\n\n다음 이동: ${s.next}`;try{await navigator.clipboard.writeText(value);toast('이 장소의 전체 낭독 원고를 복사했습니다.');}catch{openSheet('낭독 원고',`<textarea readonly style="width:100%;height:55vh;font:inherit;font-size:14px;line-height:1.8;border:1px solid var(--line);padding:15px">${esc(value)}</textarea>`);}}
async function prepareOffline(){if(!('serviceWorker'in navigator)||!('caches'in window)){toast('이 환경은 오프라인 저장을 지원하지 않습니다. Safari 또는 Chrome에서 열어 주세요.');return;}const status=$('#offlineStatus');if(status)status.textContent='사진과 원고를 저장하고 있습니다…';try{const reg=await navigator.serviceWorker.ready;const worker=reg.active;if(!worker)throw new Error('worker');const channel=new MessageChannel();const result=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('timeout')),45000);channel.port1.onmessage=e=>{clearTimeout(timeout);e.data.ok?resolve(e.data):reject(new Error('cache'));};});worker.postMessage({type:'CACHE_GUIDE'},[channel.port2]);await result;offlineReady=true;renderSidebar();if(status)status.textContent='사진·지도·원고 저장 완료. 비행기 모드에서 다시 열어 확인하세요.';toast('사진과 원고를 오프라인으로 볼 준비가 되었습니다.');}catch{if(status)status.textContent='저장을 마치지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.';toast('오프라인 저장을 마치지 못했습니다.');}}

document.addEventListener('click',async e=>{
 const b=e.target.closest('button,a');if(!b)return;
 if(b.classList.contains('close-dialog')){b.closest('dialog').close();return;}
 if(b.dataset.stop){goTo(b.dataset.stop);return;}
 if(b.dataset.view){showView(b.dataset.view);return;}
 if(b.dataset.mode){stopPlayback();state.mode=b.dataset.mode;renderGuide();persist();return;}
 if(b.dataset.preset){state.preset=b.dataset.preset;renderRoute();persist();return;}
 if(b.dataset.removeAudio){stopPlayback();await dbRequest('readwrite',store=>store.delete(b.dataset.removeAudio));audioRecords.delete(b.dataset.removeAudio);renderGuide();showSettings();return;}
 const action=b.dataset.action;
 if(action==='play')return playCurrent();
 if(action==='photo')return showPhoto();
 if(action==='ask')return showAsk();
 if(action==='sources')return showSources();
 if(action==='copy')return copyNarration();
 if(action==='import'||action==='import-all'){fileTarget=action==='import'?state.id:null;$('#audioImport').click();return;}
 if(action==='done'){state.progress[state.id]=state.progress[state.id]==='done'?null:'done';render();toast(state.progress[state.id]==='done'?'관람 완료로 표시했습니다.':'완료 표시를 해제했습니다.');return;}
 if(action==='skip'){state.progress[state.id]='skipped';const next=nextStop();persist();if(next)goTo(next.id);else render();toast('건너뛴 장소로 기록했습니다. 나중에 다시 선택할 수 있습니다.');return;}
 if(action==='reset'){if(confirm('이 기기의 관람 완료·건너뛰기 기록을 지울까요?')){state.progress={};render();toast('관람 기록을 초기화했습니다.');}return;}
 if(action==='zoom-in'||action==='zoom-out'){mapZoom=Math.max(1,Math.min(2.5,mapZoom+(action==='zoom-in'?.3:-.3)));$('.cathedral-map').style.width=(mapZoom*100)+'%';return;}
 if(action==='official-map'){window.open(DATA.officialMap,'_blank','noopener');return;}
 if(action==='large-text'){state.large=!state.large;renderGuide();persist();showSettings();return;}
 if(action==='offline')return prepareOffline();
 if(action==='voice-test'){const voice=selectedVoice();if(!voice){toast('한국어 읽기 음성이 없습니다. 음성 파일 연결을 이용해 주세요.');return;}stopPlayback();const u=new SpeechSynthesisUtterance('우리 둘의 세비야. 눈앞의 작품을 천천히 살펴보세요.');u.lang='ko-KR';u.voice=voice;u.rate=state.rate;speechSynthesis.speak(u);}
});
document.addEventListener('click',e=>{const pin=e.target.closest('[data-map-stop]');if(pin){state.id=pin.dataset.mapStop;renderMap();renderSidebar();persist();updateHash();}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-map-stop]')){e.preventDefault();state.id=e.target.dataset.mapStop;renderMap();renderSidebar();persist();updateHash();}});
document.addEventListener('change',e=>{if(e.target.id==='voiceSelect'){state.voice=e.target.value;persist();}if(e.target.id==='audioImport'&&e.target.files.length)importFiles([...e.target.files]);});
document.addEventListener('input',e=>{if(e.target.id==='rateInput'){state.rate=Number(e.target.value);$('#rateValue').textContent=state.rate.toFixed(2)+'배';persist();}});
$('#settingsButton').addEventListener('click',showSettings);$('#miniToggle').addEventListener('click',togglePlayback);$('#stopAudio').addEventListener('click',stopPlayback);
window.addEventListener('hashchange',()=>{readHash();render();});
if('speechSynthesis'in window)speechSynthesis.addEventListener('voiceschanged',()=>{if($('#sheet').open&&$('#voiceSelect'))showSettings();});
window.addEventListener('pagehide',()=>{if('speechSynthesis'in window)speechSynthesis.cancel();});
readHash();render();
Promise.all([fetch('assets/photos.json').then(r=>r.ok?r.json():{}).catch(()=>({})),loadAudioRecords()]).then(([data])=>{photos=data.photos||data;render();});
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').then(async()=>{try{const cache=await caches.open('our-seville-guide-v1');offlineReady=!!(await cache.match(new URL('offline-ready.json', location.href)));renderSidebar();}catch{}}).catch(()=>{});
})();
