// Trip Canvas — Adaptive Travel OS 도메인 (순수 로직: DOM·네트워크·현재시각 접근 없음)
// 제품 한 문장: "현재 여행 상태를 이해하고, 다음을 이어준다".
// 흐름은 한 방향이다:  상태(TripState) → 후보(Candidate) → 순위(rank) → 제안(TripSuggestion) → 사용자 결정.
// 시각·이동시간·영업요일 같은 '사실'은 전부 인자로 주입받는다 → 같은 입력이면 항상 같은 결과(추천 안정성).
// 추천 점수는 내부 값일 뿐이고 사용자에게는 reasons(이유 문장)만 보여준다.
// @ts-check
(function(root){
  'use strict';
  // lib.js 재사용(haversine·parseHM·hm·isOpenAt). 브라우저는 전역, Node(테스트)는 모듈.
  const LIB = (typeof module!=='undefined' && module.exports) ? require('./lib.js') : /** @type {any} */(root);

  /** @typedef {{lat:number,lng:number}} LatLng */
  /** @typedef {'FIXED'|'SEMI_FIXED'|'FLEXIBLE'} Flexibility */
  /** @typedef {'PLANNED'|'READY'|'IN_PROGRESS'|'COMPLETED'|'SKIPPED'|'CANCELLED'} ActivityStatus */
  /** @typedef {'FLIGHT'|'TRAIN'|'HOTEL'|'RESTAURANT'|'TOUR'|'CAR'|'OTHER'} CommitmentType */
  /** @typedef {'MANUAL'|'ASSISTED'|'DELEGATED'} PlanningMode */
  /** @typedef {'LOW'|'NORMAL'|'HIGH'} EnergyLevel */
  /** @typedef {'VISIT_PLACE'|'MOVE'|'EAT'|'REST'|'CHECK_IN'|'RETURN_TO_HOTEL'|'WAIT'} ActionKind */
  /** @typedef {{id:string,si:number,name:string,spot:any,eta:number,natural:number,travelIn:number,depart:number,end:number,stayMin:number,status:ActivityStatus,flexibility:Flexibility,type:CommitmentType,priority:number,location:(LatLng|null),fixedAt:(number|null),conflict:boolean}} TripItem */
  /** @typedef {{id:string,type:CommitmentType,itemId:string,startMin:number,endMin:number,location:(LatLng|null),flexibility:Flexibility,title:string}} FixedCommitment */
  /** @typedef {{startMin:number,endMin:number,minutes:number,anchor:(LatLng|null),afterId:(string|null),beforeId:(string|null),beforeFixed:boolean}} FreeWindow */
  /** @typedef {{id:string,kind:ActionKind,title:string,location:(LatLng|null),durationMin:number,priority:number,must:boolean,hours:(any[]|null),fromDay:(number|null),si:(number|null),inPlan:boolean,spot:any}} ActionCandidate */
  /** @typedef {{type:string,id:string,targetId:(string|null),title:string,score:number,reasons:string[],estimatedDuration:number,estimatedTravelTime:number,arriveMin:number,endMin:number,fromDay:(number|null),si:(number|null),spot:any}} NextActionCandidate */
  /** @typedef {{timeChangeMinutes?:number,travelTimeChangeMinutes?:number,costChange?:number,removedActivities?:string[],addedActivities?:string[]}} SuggestionImpact */
  /** @typedef {{id:string,key:string,type:string,title:string,description:string,reasons:string[],impact:SuggestionImpact,status:string,action:any}} TripSuggestion */

  /** 판정 기준은 흩어놓지 않고 한곳에 모은다 — 모든 함수가 cfg 재정의를 받는다. */
  const ADAPT_CFG = Object.freeze({
    minWindowMin: 45,        // 이보다 짧은 틈은 '일정을 넣을 빈 시간'으로 보지 않는다
    bufferMin: 15,           // 고정 일정 도착 전에 남겨둘 여유
    maxSuggest: 3,           // 한 번에 보여줄 제안 수 — 검색 결과 앱이 되지 않게
    defaultStayMin: 60,      // 체류시간 미지정 장소의 기본값 (computeTimeline과 동일)
    readyLeadMin: 15,        // 도착 예정 이 시간 전부터 'READY'
    lateThresholdMin: 20,    // 현재 시각이 계획보다 이만큼 밀리면 '지연'
    heavyTravelMin: 180,     // 오늘 누적 이동이 이보다 크면 휴식 후보 가중
    dayEndMin: 21*60,        // 하루 활동 종료 기준(빈 시간 탐지의 꼬리)
    nearKm: 1.5,             // 이 안이면 '바로 근처'
    fallbackSpeedKmh: 25,    // 이동시간 주입이 없을 때의 직선거리 환산 속도
    lookAheadDays: 3         // 다른 날에서 후보를 끌어올 때 살펴볼 앞뒤 일자 범위
  });
  const MEAL_WINDOWS = Object.freeze([
    Object.freeze({key:'lunch', from:11*60+30, to:13*60+30, label:'점심'}),
    Object.freeze({key:'dinner', from:17*60+30, to:20*60, label:'저녁'})
  ]);

  /** @param {any} o @returns {any} */
  function cfgOf(o){ return (o&&o.cfg)||ADAPT_CFG; }
  /** @param {any} s @returns {boolean} */
  function hasCoord(s){ return !!s && s.lat!=null && s.lng!=null && isFinite(+s.lat) && isFinite(+s.lng); }
  /** @param {any} s @returns {LatLng|null} */
  function locOf(s){ return hasCoord(s)? {lat:+s.lat, lng:+s.lng} : null; }
  /** @param {any} x @param {number} d @returns {number} */
  function num(x,d){ const n=+x; return isFinite(n)? n : d; }
  /** YYYY-MM-DD → 요일(0=일). 파싱 실패는 -1. @param {string} iso @returns {number} */
  function weekdayOf(iso){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||''))) return -1;
    const ms=Date.parse(iso+'T00:00:00Z');
    return isFinite(ms)? new Date(ms).getUTCDay() : -1;
  }
  /** trip.start 기준 오늘의 일자 index. 여행 기간 밖이면 -1. @param {any} trip @param {string} todayISO @returns {number} */
  function currentDayIndex(trip, todayISO){
    const days=(trip&&trip.days)||[];
    if(!days.length || !/^\d{4}-\d{2}-\d{2}$/.test(String((trip&&trip.start)||'')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayISO||''))) return -1;
    const a=Date.parse(trip.start+'T00:00:00Z'), b=Date.parse(todayISO+'T00:00:00Z');
    if(!isFinite(a)||!isFinite(b)) return -1;
    const diff=Math.round((b-a)/86400000);
    return (diff>=0 && diff<days.length)? diff : -1;
  }
  /** 이동시간(분) — 주입된 legMin 우선, 없으면 직선거리 환산. 좌표가 없으면 0(모름). @param {any} a @param {any} b @param {any=} opts @returns {number} */
  function travelMinutes(a,b,opts){
    if(!hasCoord(a)||!hasCoord(b)) return 0;
    const c=cfgOf(opts), fn=opts&&opts.legMin;
    if(typeof fn==='function'){ const v=+fn(a,b); if(isFinite(v)&&v>=0) return Math.round(v); }
    return Math.round(LIB.haversine({lat:+a.lat,lng:+a.lng},{lat:+b.lat,lng:+b.lng})/c.fallbackSpeedKmh*60);
  }

  // ── 1. 고정 / 유동 분류 ───────────────────────────────────────────
  /**
   * 일정 하나의 성격. 상대가 정한 시각(bookAt)·항공·기차는 FIXED(침범 금지),
   * 내가 정한 도착시각(at)·숙소·렌터카는 SEMI_FIXED, 나머지 관광/카페/산책은 FLEXIBLE.
   * @param {any} spot @param {any} day @param {any[]=} bookings
   * @returns {{type:CommitmentType, flexibility:Flexibility, bookingId:(string|null)}}
   */
  function commitmentOf(spot, day, bookings){
    const s=spot||{};
    const bk=(s.bookingId && Array.isArray(bookings))? (bookings.filter(b=>b&&b.id===s.bookingId)[0]||null) : null;
    const legMode=s.legMode || (day&&day.mode) || '';
    /** @type {CommitmentType} */
    let type='OTHER';
    if(bk && bk.type==='flight') type='FLIGHT';
    else if(bk && bk.type==='car') type='CAR';
    else if(bk && bk.type==='hotel') type='HOTEL';
    else if(s.stay) type='HOTEL';
    else if(legMode==='flight') type='FLIGHT';
    else if(legMode==='train') type='TRAIN';
    else if(s.bookAt) type='TOUR';   // 식당/투어/공연을 구분할 데이터가 없다 — '상대가 정한 약속'으로만 취급
    /** @type {Flexibility} */
    let flexibility='FLEXIBLE';
    if(type==='FLIGHT'||type==='TRAIN'||s.bookAt) flexibility='FIXED';
    else if(type==='HOTEL'||type==='CAR'||s.at) flexibility='SEMI_FIXED';
    return {type, flexibility, bookingId: bk? bk.id : null};
  }
  /** 보호 우선순위 (3=반드시 → 1=선택). 고정 일정과 mustVisit은 항상 최우선. @param {any} spot @param {Flexibility} flexibility @returns {number} */
  function priorityOf(spot, flexibility){
    if(spot && spot.must) return 3;
    if(flexibility!=='FLEXIBLE') return 3;
    if(spot && spot.opt) return 1;
    return 2;
  }
  /**
   * 실행 상태. 저장된 값(COMPLETED/SKIPPED/CANCELLED)이 우선이고, 나머지는 시각으로 유도한다.
   * 자동 완료 처리는 하지 않는다 — 방문 판정은 사용자가 누른다.
   * @param {any} spot @param {number} eta @param {number} endMin @param {number} nowMin @param {boolean} live @param {any=} opts
   * @returns {ActivityStatus}
   */
  function statusOf(spot, eta, endMin, nowMin, live, opts){
    const raw=spot&&spot.status;
    if(raw==='COMPLETED'||raw==='SKIPPED'||raw==='CANCELLED') return raw;
    if(!live) return 'PLANNED';
    const c=cfgOf(opts);
    if(nowMin>=eta && nowMin<endMin) return 'IN_PROGRESS';
    if(nowMin>=eta-c.readyLeadMin && nowMin<eta) return 'READY';
    return 'PLANNED';
  }
  /** 계획을 얼마나 직접 세웠는지 추정 — 사용자가 지정하지 않았을 때의 기본값. @param {any} trip @returns {PlanningMode} */
  function planningModeHint(trip){
    const days=(trip&&trip.days)||[];
    if(!days.length) return 'DELEGATED';
    const filled=days.filter((/**@type{any}*/d)=>(((d&&d.spots)||[]).length>=2)).length;
    const ratio=filled/days.length;
    if(ratio>=0.8) return 'MANUAL';
    if(ratio>=0.3) return 'ASSISTED';
    return 'DELEGATED';
  }

  // ── 2. TripState ─────────────────────────────────────────────────
  /**
   * 현재 여행 상태. itinerary 배열이 아니라 "지금 어디까지 왔고 무엇이 남았는가"를 계산한다.
   * timeline은 app이 실제 이동시간으로 계산한 computeTimeline 결과를 그대로 넘긴다(출발 기준점 단일 진실 공유).
   * @param {any} trip
   * @param {{dayIndex?:number, todayISO?:string, nowMin?:number, live?:boolean, timeline?:any[], startAnchor?:any,
   *          currentLocation?:any, planningMode?:PlanningMode, energyLevel?:EnergyLevel, legMin?:any, cfg?:any}=} opts
   * @returns {any}
   */
  function buildTripState(trip, opts){
    const o=opts||{}, c=cfgOf(o), days=(trip&&trip.days)||[];
    const todayISO=o.todayISO||'';
    const today=currentDayIndex(trip, todayISO);
    const di=(o.dayIndex!=null && o.dayIndex>=0 && o.dayIndex<days.length)? o.dayIndex : (today>=0? today : 0);
    const day=days[di]||{spots:[]};
    const spots=(day.spots)||[];
    const timeline=Array.isArray(o.timeline)? o.timeline : [];
    const live=(o.live!=null)? !!o.live : (today>=0 && di===today);
    const dayStartMin=LIB.parseHM(day.startAt);
    const nowMin=live? Math.max(0, Math.min(1439, Math.round(num(o.nowMin, dayStartMin)))) : dayStartMin;
    const bookings=(trip&&trip.bookings)||[];
    const startLocation=locOf(o.startAnchor);

    /** @type {TripItem[]} */
    const items=[];
    let prevEnd=dayStartMin, travelToday=0;
    spots.forEach((/**@type{any}*/s,/**@type{number}*/si)=>{
      const tl=timeline[si]||{};
      const eta=num(tl.eta, prevEnd), natural=num(tl.natural, eta), wait=num(tl.wait, 0);
      const stayMin=(s&&s.stayMin!=null)? Math.max(0,num(s.stayMin,c.defaultStayMin)) : c.defaultStayMin;
      const depart=eta+wait, end=depart+stayMin;
      const travelIn=Math.max(0, natural-prevEnd);
      const cm=commitmentOf(s, day, bookings);
      const status=statusOf(s, eta, end, nowMin, live, o);
      items.push({
        id:'d'+di+'s'+si, si, name:String((s&&s.name)||''), spot:s,
        eta, natural, travelIn, depart, end, stayMin, status,
        flexibility:cm.flexibility, type:cm.type, priority:priorityOf(s, cm.flexibility),
        location:locOf(s), fixedAt:(s&&s.bookAt)? LIB.parseHM(s.bookAt) : ((s&&s.at)? LIB.parseHM(s.at) : null),
        conflict:!!tl.conflict
      });
      travelToday+=travelIn; prevEnd=end;
    });

    const active=items.filter(it=>it.status!=='SKIPPED' && it.status!=='CANCELLED');
    const completed=items.filter(it=>it.status==='COMPLETED');
    const remaining=active.filter(it=>it.status!=='COMPLETED');
    /** @type {FixedCommitment[]} */
    const fixedCommitments=active.filter(it=>it.flexibility!=='FLEXIBLE').map(it=>({
      id:'fc-'+it.id, itemId:it.id, type:it.type, title:it.name,
      startMin:(it.fixedAt!=null? it.fixedAt : it.eta), endMin:it.end,
      location:it.location, flexibility:it.flexibility
    }));
    const nextFixed=fixedCommitments.filter(f=>f.startMin>=nowMin)[0]||null;
    const lastDone=completed.length? completed[completed.length-1] : null;
    const inProgress=items.filter(it=>it.status==='IN_PROGRESS')[0]||null;
    const currentLocation=locOf(o.currentLocation) || (inProgress&&inProgress.location) || (lastDone&&lastDone.location) || startLocation;
    // 지연: 이미 지났어야 할 활동이 아직 남아 있으면 그 차이 (계획 대비 밀린 분)
    let delayMin=0;
    if(live) remaining.forEach(it=>{ if(nowMin>it.eta) delayMin=Math.max(delayMin, Math.round(nowMin-it.eta)); });
    const lastEnd=items.length? items[items.length-1].end : dayStartMin;
    const dayEndMin=Math.max(c.dayEndMin, lastEnd);
    const freeFrom=Math.max(nowMin, lastDone? lastDone.end : nowMin);
    const availableMin=nextFixed? Math.max(0, nextFixed.startMin-freeFrom) : Math.max(0, dayEndMin-freeFrom);
    const hotel=active.filter(it=>it.type==='HOTEL').pop()||null;

    return {
      tripId:(trip&&trip.id)||'', tripName:(trip&&trip.name)||'',
      currentDay:di, todayIndex:today, dayCount:days.length, todayISO, weekday:weekdayOf(todayISO),
      live, nowMin, dayStartMin, dayEndMin, day,
      items, completedItems:completed.map(it=>it.id), remainingItems:remaining.map(it=>it.id),
      skippedItems:items.filter(it=>it.status==='SKIPPED').map(it=>it.id),
      fixedCommitments, nextFixed, currentItem:inProgress, nextItem:remaining[0]||null,
      currentLocation, startLocation, hotelLocation:(hotel&&hotel.location)||startLocation,
      availableMin, delayMin, travelMinToday:travelToday,
      planningMode:o.planningMode||planningModeHint(trip),
      energyLevel:o.energyLevel||'NORMAL'
    };
  }

  // ── 3. 빈 시간 탐지 ───────────────────────────────────────────────
  /**
   * 일정의 빈 시간. '이동시간'은 빈 시간이 아니다 — 활동 종료와 다음 활동의 자연 도착 사이에서
   * 이동에 쓰이는 만큼을 빼고 남는 여유만 창으로 본다(고정 시각을 기다리는 대기시간이 대부분).
   * live면 이미 지나간 구간은 잘라낸다.
   * @param {any} state @param {{cfg?:any, minMinutes?:number}=} opts
   * @returns {FreeWindow[]}
   */
  function findFreeWindows(state, opts){
    const c=cfgOf(opts), min=num(opts&&opts.minMinutes, c.minWindowMin);
    /** @type {FreeWindow[]} */
    const out=[];
    const items=state.items.filter((/**@type{TripItem}*/it)=>it.status!=='SKIPPED'&&it.status!=='CANCELLED');
    let cur=state.live? Math.max(state.nowMin, state.dayStartMin) : state.dayStartMin;
    /** @type {TripItem|null} */
    let prev=null;
    for(let i=0;i<items.length;i++){
      const it=/** @type {TripItem} */(items[i]);
      if(it.status==='COMPLETED'||it.status==='IN_PROGRESS'){ cur=Math.max(cur,it.end); prev=it; continue; }
      // 활동이 실제로 시작되는 시각은 depart(예약 시각까지 기다리면 그때) — 그 전 이동시간을 뺀 나머지가 여유다
      const free=(it.depart-it.travelIn)-cur;
      if(free>=min) out.push({
        startMin:Math.round(cur), endMin:Math.round(cur+free), minutes:Math.round(free),
        anchor:(prev&&prev.location)||state.currentLocation||state.startLocation,
        afterId:prev? prev.id : null, beforeId:it.id, beforeFixed:it.flexibility!=='FLEXIBLE'
      });
      cur=Math.max(cur,it.end); prev=it;
    }
    if(state.dayEndMin-cur>=min) out.push({
      startMin:Math.round(cur), endMin:Math.round(state.dayEndMin), minutes:Math.round(state.dayEndMin-cur),
      anchor:(prev&&prev.location)||state.currentLocation||state.startLocation,
      afterId:prev? prev.id : null, beforeId:null, beforeFixed:false
    });
    return out;
  }
  /** 창이 걸치는 식사 시간대(없으면 null). @param {FreeWindow} win @returns {any} */
  function mealOverlap(win){
    return MEAL_WINDOWS.filter(m=>win.startMin<m.to && win.endMin>m.from)[0]||null;
  }

  // ── 4. 후보 생성 ─────────────────────────────────────────────────
  /**
   * 다음 행동 후보. MVP는 외부 실시간 데이터 없이 사용자의 여행 데이터만 쓴다:
   * 오늘 남은 일정 + 가까운 일자의 유동 장소(옮겨올 수 있는 곳) + 휴식/복귀/식사 같은 '안 움직이는' 선택지.
   * @param {any} trip @param {any} state @param {{window?:FreeWindow, cfg?:any}=} opts
   * @returns {ActionCandidate[]}
   */
  function buildCandidates(trip, state, opts){
    const c=cfgOf(opts), days=(trip&&trip.days)||[], di=state.currentDay;
    /** @type {ActionCandidate[]} */
    const out=[];
    /** @type {any} */
    const seen=Object.create(null);
    /** @param {any} s @returns {string} */
    const nameKey=(s)=>String((s&&s.name)||'').trim().toLowerCase();
    state.items.forEach((/**@type{TripItem}*/it)=>{
      seen[nameKey(it.spot)]=1;
      if(it.status==='COMPLETED'||it.status==='SKIPPED'||it.status==='CANCELLED') return;
      if(it.flexibility==='FIXED') return;   // 고정 일정은 '추천'이 아니라 지켜야 할 약속이다
      out.push({id:'c-'+it.id, kind:(it.type==='HOTEL'?'CHECK_IN':'VISIT_PLACE'), title:it.name, location:it.location,
        durationMin:it.stayMin, priority:it.priority, must:!!(it.spot&&it.spot.must), hours:(it.spot&&it.spot.hours)||null,
        fromDay:null, si:it.si, inPlan:true, spot:it.spot});
    });
    /** @type {any} */
    const cities=Object.create(null);
    ((state.day&&state.day.spots)||[]).forEach((/**@type{any}*/s)=>{ if(s&&s.city) cities[s.city]=1; });
    const anyCity=Object.keys(cities).length===0;   // 오늘 계획이 비어 있으면 근처 일자에서 폭넓게 후보를 찾는다
    for(let k=0;k<days.length;k++){
      if(k===di || Math.abs(k-di)>c.lookAheadDays) continue;
      ((days[k]&&days[k].spots)||[]).forEach((/**@type{any}*/s,/**@type{number}*/si)=>{
        if(!s || s.stay || s.bookAt || s.status==='COMPLETED' || s.status==='SKIPPED' || s.status==='CANCELLED') return;
        if(!anyCity && !cities[s.city]) return;      // 오늘 머무는 도시가 아니면 옮겨올 후보가 아니다(오늘이 통째로 비었으면 도시 제한 없음)
        if(seen[nameKey(s)]) return;
        seen[nameKey(s)]=1;
        const cm=commitmentOf(s, days[k], (trip&&trip.bookings)||[]);
        if(cm.flexibility!=='FLEXIBLE') return;
        out.push({id:'c-d'+k+'s'+si, kind:'VISIT_PLACE', title:String(s.name||''), location:locOf(s),
          durationMin:(s.stayMin!=null? Math.max(0,num(s.stayMin,c.defaultStayMin)) : c.defaultStayMin),
          priority:priorityOf(s, cm.flexibility), must:!!s.must, hours:s.hours||null,
          fromDay:k, si, inPlan:false, spot:s});
      });
    }
    // 움직이지 않는 선택지 — 억지로 다음 장소를 만들지 않기 위한 정상 후보
    const win=(opts&&opts.window)||null;
    const winMin=win? win.minutes : state.availableMin;
    out.push({id:'c-rest', kind:'REST', title:'조금 더 쉬기', location:null,
      durationMin:Math.min(90, Math.max(30, Math.round(winMin/2))), priority:2, must:false, hours:null, fromDay:null, si:null, inPlan:false, spot:null});
    if(state.hotelLocation) out.push({id:'c-hotel', kind:'RETURN_TO_HOTEL', title:'숙소로 돌아가기', location:state.hotelLocation,
      durationMin:0, priority:2, must:false, hours:null, fromDay:null, si:null, inPlan:false, spot:null});
    const meal=win? mealOverlap(win) : null;
    if(meal) out.push({id:'c-eat-'+meal.key, kind:'EAT', title:meal.label+' 시간이 비어 있어요', location:(win?win.anchor:null),
      durationMin:60, priority:2, must:false, hours:null, fromDay:null, si:null, inPlan:false, spot:null});
    return out;
  }

  // ── 5. 순위 (deterministic) ──────────────────────────────────────
  /**
   * 후보 점수와 이유. 점수는 내부값이고 UI는 reasons만 쓴다.
   * 불가능한 후보(시간 안에 못 들어옴·영업 종료)는 아예 제외한다 — 억지 추천을 만들지 않는다.
   * @param {any} state @param {ActionCandidate[]} candidates
   * @param {{window?:FreeWindow, legMin?:any, cfg?:any, weekday?:number, exclude?:string[]}=} opts
   * @returns {NextActionCandidate[]}
   */
  function rankNextActions(state, candidates, opts){
    const o=opts||{}, c=cfgOf(o);
    /** @type {FreeWindow} */
    const win=o.window || {startMin:(state.live?state.nowMin:state.dayStartMin), endMin:state.dayEndMin,
      minutes:state.availableMin, anchor:(state.currentLocation||state.startLocation), afterId:null, beforeId:null, beforeFixed:false};
    const weekday=(o.weekday!=null)? o.weekday : state.weekday;
    /** @type {any} */
    const exclude=Object.create(null);
    (o.exclude||[]).forEach((/**@type{string}*/k)=>{ exclude[k]=1; });
    const nextFixedLoc=state.nextFixed? state.nextFixed.location : null;
    const meal=mealOverlap(win);
    /** @type {NextActionCandidate[]} */
    const out=[];
    (candidates||[]).forEach((/**@type{ActionCandidate}*/cd)=>{
      if(exclude[cd.id]) return;
      /** @type {string[]} */
      const reasons=[];
      const travel=cd.location? travelMinutes(win.anchor, cd.location, o) : 0;
      const arrive=win.startMin+travel;
      const duration=Math.max(0, cd.durationMin||0);
      const finish=arrive+duration;
      let score=50;
      if(cd.kind==='REST'||cd.kind==='WAIT'){
        score=38;
        if(state.energyLevel==='LOW'){ score+=25; reasons.push('지금은 체력을 아끼는 편이 낫습니다'); }
        if(state.travelMinToday>=c.heavyTravelMin){ score+=15; reasons.push('오늘 이동이 '+Math.round(state.travelMinToday/60)+'시간을 넘었습니다'); }
        if(state.nextFixed) reasons.push(state.nextFixed.title+' '+LIB.hm(state.nextFixed.startMin)+'까지 '+Math.round(state.availableMin)+'분 남았습니다');
        else reasons.push('남은 고정 일정이 없어 쉬어도 밀리지 않습니다');
        out.push({type:'REST', id:cd.id, targetId:null, title:cd.title, score, reasons, estimatedDuration:duration,
          estimatedTravelTime:0, arriveMin:win.startMin, endMin:win.startMin+duration, fromDay:null, si:null, spot:null});
        return;
      }
      if(cd.kind==='RETURN_TO_HOTEL'){
        score=36;
        if(state.travelMinToday>=c.heavyTravelMin){ score+=14; reasons.push('오늘 이동이 많았습니다'); }
        if(travel) reasons.push('숙소까지 약 '+travel+'분');
        if(state.nextFixed && state.nextFixed.startMin-finish>=c.bufferMin) reasons.push('숙소에 들렀다 가도 '+state.nextFixed.title+' 시간에는 여유가 있습니다');
        if(!reasons.length) reasons.push('오늘 남은 일정을 숙소에서 이어가도 됩니다');
        out.push({type:'RETURN_TO_HOTEL', id:cd.id, targetId:null, title:cd.title, score, reasons, estimatedDuration:0,
          estimatedTravelTime:travel, arriveMin:arrive, endMin:arrive, fromDay:null, si:null, spot:null});
        return;
      }
      if(cd.kind==='EAT'){
        out.push({type:'EAT', id:cd.id, targetId:null, title:cd.title, score:46,
          reasons:[(meal? meal.label : '식사')+' 시간대에 일정이 비어 있습니다', '이 시간에 식사를 넣으면 남은 일정이 밀리지 않습니다'],
          estimatedDuration:duration, estimatedTravelTime:0, arriveMin:win.startMin, endMin:win.startMin+duration,
          fromDay:null, si:null, spot:null});
        return;
      }
      // 장소 방문 — 실제로 가능한지부터 확인한다
      const backMin=(cd.location&&nextFixedLoc)? travelMinutes(cd.location, nextFixedLoc, o) : 0;
      const deadline=win.beforeFixed? win.endMin : Math.min(win.endMin, state.dayEndMin);
      const guard=(win.beforeFixed||nextFixedLoc)? c.bufferMin : 0;
      if(finish+backMin+guard > deadline) return;                                             // 이동시간 때문에 불가능
      if(weekday>=0 && cd.hours && cd.hours.length){
        if(LIB.isOpenAt(cd.hours, weekday, arrive)===false) return;                            // 도착 시점에 영업 종료
        if(duration>0 && LIB.isOpenAt(cd.hours, weekday, Math.max(arrive, finish-1))===false) return;   // 머무는 중에 문 닫음
        reasons.push('도착 예정 시각에 문을 엽니다');
      }
      if(travel>0){
        score+=Math.max(0, 20-travel*0.5);
        reasons.push((cd.inPlan?'':'현재 위치에서 ')+'이동 약 '+travel+'분');
      }
      const slack=deadline-(finish+backMin);
      score+=Math.max(0, Math.min(15, 15-Math.abs(slack-c.bufferMin)/8));
      if(cd.must){ score+=18; reasons.push('꼭 가려고 표시한 곳입니다'); }
      else if(cd.priority>=2) score+=6;
      if(cd.inPlan){ score+=8; reasons.push('원래 오늘 일정에 있던 곳입니다'); }
      else if(cd.fromDay!=null) reasons.push('Day '+(cd.fromDay+1)+' 일정에서 옮겨올 수 있습니다');
      if(state.energyLevel==='LOW' && travel>25){ score-=12; reasons.push('다만 이동이 조금 깁니다'); }
      if(nextFixedLoc && state.nextFixed && cd.location){
        const direct=travelMinutes(win.anchor, nextFixedLoc, o);
        const detour=Math.max(0, (travel+backMin)-direct);
        score-=Math.min(20, detour*0.4);
        if(detour<=10) reasons.push(state.nextFixed.title+' 동선과 같은 방향입니다');
      }
      if(duration) reasons.push('약 '+(duration>=60? (Math.round(duration/60*10)/10)+'시간' : duration+'분')+'이면 둘러볼 수 있습니다');
      out.push({type:(cd.kind==='CHECK_IN'?'CHECK_IN':'VISIT_PLACE'), id:cd.id, targetId:(cd.si!=null? String(cd.si) : null),
        title:cd.title, score:Math.round(score*100)/100, reasons, estimatedDuration:duration, estimatedTravelTime:travel,
        arriveMin:arrive, endMin:finish, fromDay:cd.fromDay, si:cd.si, spot:cd.spot});
    });
    // 같은 상태에서는 같은 순서 — 점수 → 이동시간 → id 순으로 완전 정렬
    out.sort((a,b)=> (b.score-a.score) || (a.estimatedTravelTime-b.estimatedTravelTime) || (a.id<b.id? -1 : (a.id>b.id? 1 : 0)));
    return out;
  }

  // ── 6. 일정 충돌 · 재구성 ────────────────────────────────────────
  /**
   * 남은 일정을 현재 시각부터 다시 굴려본다. 고정 일정(FIXED) 도착이 약속 시각을 넘기면 위반.
   * @param {any} state @param {TripItem[]} list @param {any=} opts
   * @returns {{ok:boolean, lateBy:number, endMin:number, violated:string[]}}
   */
  function simulate(state, list, opts){
    const done=state.items.filter((/**@type{TripItem}*/it)=>it.status==='COMPLETED');
    const lastDone=done.length? done[done.length-1] : null;
    let clock=state.live? Math.max(state.nowMin, lastDone? lastDone.end : state.nowMin) : state.dayStartMin;
    /** @type {any} */
    let prev=state.currentLocation||state.startLocation;
    let lateBy=0;
    /** @type {string[]} */
    const violated=[];
    list.forEach((/**@type{TripItem}*/it)=>{
      if(it.location && prev) clock+=travelMinutes(prev, it.location, opts);
      if(it.fixedAt!=null){
        if(it.flexibility==='FIXED'){
          const over=clock-it.fixedAt;
          if(over>0.5){ lateBy=Math.max(lateBy, Math.round(over)); violated.push(it.id); }
        }
        clock=Math.max(clock, it.fixedAt);
      }
      clock+=it.stayMin;
      if(it.location) prev=it.location;
    });
    return {ok:!violated.length, lateBy, endMin:Math.round(clock), violated};
  }
  /**
   * 남은 일정 재구성 후보. 순서를 지킨다: 고정 예약 보호 → 완료 일정 유지 → mustVisit 보호 →
   * 남은 시간 안에 들어오는 일정 우선 → 우선순위 낮은 일정부터 제거. 자동 적용하지 않는다(미리보기).
   * @param {any} state @param {{legMin?:any, cfg?:any}=} opts
   * @returns {{needed:boolean, feasible:boolean, keep:string[], drop:string[], dropNames:string[], lateBy:number, impact:SuggestionImpact, before:string[], after:string[]}}
   */
  function generateReplan(state, opts){
    const pending=state.items.filter((/**@type{TripItem}*/it)=>it.status!=='COMPLETED'&&it.status!=='SKIPPED'&&it.status!=='CANCELLED');
    const base=simulate(state, pending, opts);
    let keep=pending.slice();
    /** @type {TripItem[]} */
    const drop=[];
    // 뺄 수 있는 것: 유동 + mustVisit 아님. 우선순위 낮은 것 → 뒤쪽(늦은 순서) 것부터.
    const droppable=pending.filter((/**@type{TripItem}*/it)=>it.flexibility==='FLEXIBLE' && !(it.spot&&it.spot.must))
      .sort((/**@type{TripItem}*/a,/**@type{TripItem}*/b)=> (a.priority-b.priority) || (b.si-a.si));
    let r=base, i=0;
    while(!r.ok && i<droppable.length){
      const victim=droppable[i++];
      keep=keep.filter((/**@type{TripItem}*/it)=>it.id!==victim.id);
      drop.push(victim);
      r=simulate(state, keep, opts);
    }
    return {
      needed:!base.ok, feasible:r.ok,
      keep:keep.map((/**@type{TripItem}*/it)=>it.id), drop:drop.map((/**@type{TripItem}*/it)=>it.id),
      dropNames:drop.map((/**@type{TripItem}*/it)=>it.name), lateBy:base.lateBy,
      before:pending.map((/**@type{TripItem}*/it)=>it.name), after:keep.map((/**@type{TripItem}*/it)=>it.name),
      impact:{timeChangeMinutes:r.endMin-base.endMin, removedActivities:drop.map((/**@type{TripItem}*/it)=>it.name), addedActivities:[]}
    };
  }
  /** 제안이 일정에 주는 영향. @param {any} before @param {any} after @returns {SuggestionImpact} */
  function calcSuggestionImpact(before, after){
    return {
      timeChangeMinutes:Math.round(num(after&&after.endMin,0)-num(before&&before.endMin,0)),
      travelTimeChangeMinutes:Math.round(num(after&&after.travelMin,0)-num(before&&before.travelMin,0)),
      removedActivities:(after&&after.removed)||[], addedActivities:(after&&after.added)||[]
    };
  }

  // ── 7. 제안 (모든 기능이 공유하는 형태) ──────────────────────────
  /** 같은 제안을 하루 안에서 다시 만들지 않기 위한 안정 키. @param {string} type @param {string} what @param {any} state @returns {string} */
  function suggestionKey(type, what, state){
    return [state.tripId||'-', state.todayISO||('d'+state.currentDay), type, what].join('|');
  }
  /**
   * 화면에 보여줄 제안 목록. 재구성(고정 예약 위험)이 최우선이고, 그다음 다음 행동, 마지막이 가격 절약.
   * 가격 절약도 같은 '상태→제안→반영' 패턴을 쓰므로 별도 서브앱이 아니라 이 목록에 함께 들어온다.
   * @param {any} trip @param {any} state
   * @param {{legMin?:any, cfg?:any, dismissed?:string[], priceSuggestions?:any[], window?:FreeWindow}=} opts
   * @returns {{suggestions:TripSuggestion[], windows:FreeWindow[], replan:any, ranked:NextActionCandidate[], window:(FreeWindow|null), empty:boolean}}
   */
  function buildSuggestions(trip, state, opts){
    const o=opts||{}, c=cfgOf(o);
    /** @type {any} */
    const dismissed=Object.create(null);
    (o.dismissed||[]).forEach((/**@type{string}*/k)=>{ dismissed[k]=1; });
    const windows=findFreeWindows(state, o);
    const replan=generateReplan(state, o);
    const win=o.window || windows[0] || null;
    const ranked=rankNextActions(state, buildCandidates(trip, state, {window:(win||undefined), cfg:c}),
      {window:(win||undefined), legMin:o.legMin, cfg:c});
    /** @type {TripSuggestion[]} */
    const out=[];
    const cap=c.maxSuggest+1;   // 재구성/가격은 '다음 행동' 3개와 별개로 한 자리 더 허용
    /** @param {TripSuggestion} s */
    const push=(s)=>{ if(!dismissed[s.key] && out.length<cap) out.push(s); };

    if(replan.needed){
      const key=suggestionKey('REPLAN', replan.drop.join(',')||'none', state);
      push({id:key, key, type:'REPLAN',
        title:replan.lateBy+'분 지연 — 이렇게 조정하면 약속에 늦지 않아요',
        description:replan.feasible
          ? (replan.dropNames.length? replan.dropNames.join(', ')+'을(를) 빼면 고정 예약 시간을 지킬 수 있어요' : '순서를 그대로 두어도 괜찮습니다')
          : '일정을 줄여도 고정 예약 시간을 맞추기 어려워요 — 예약 변경을 검토해 보세요',
        reasons:['현재 '+replan.lateBy+'분 밀렸습니다', '고정 예약은 그대로 지킵니다', '완료한 일정은 유지합니다'],
        impact:replan.impact, status:'NEW', action:{kind:'REPLAN', drop:replan.drop, keep:replan.keep}});
    }
    ranked.slice(0, c.maxSuggest).forEach((r)=>{
      const key=suggestionKey(r.type, r.title, state);
      push({id:key, key, type:((r.type==='REST'||r.type==='RETURN_TO_HOTEL')? 'REST' : (r.type==='EAT'? 'NEXT_ACTIVITY' : 'NEXT_ACTIVITY')),
        title:r.title,
        description:(r.type==='VISIT_PLACE'||r.type==='CHECK_IN')
          ? ((r.estimatedTravelTime? r.estimatedTravelTime+'분 이동 · ' : '')+LIB.hm(r.arriveMin)+' 도착 · '+LIB.hm(r.endMin)+'까지')
          : (r.type==='EAT'? (LIB.hm(r.arriveMin)+'부터 비어 있어요') : '지금 쉬어도 남은 일정에는 여유가 있어요'),
        reasons:r.reasons,
        impact:{timeChangeMinutes:r.estimatedDuration+r.estimatedTravelTime, addedActivities:(r.spot?[r.title]:[]), removedActivities:[]},
        status:'NEW', action:{kind:r.type, si:r.si, fromDay:r.fromDay, candidateId:r.id, startMin:(win? win.startMin : state.nowMin)}});
    });
    (o.priceSuggestions||[]).forEach((/**@type{any}*/p)=>{
      const key=suggestionKey('PRICE_SAVING', String(p.bookingId||p.title||''), state);
      push({id:key, key, type:'PRICE_SAVING', title:String(p.title||''), description:String(p.description||''),
        reasons:(Array.isArray(p.reasons)? p.reasons : []), impact:(p.impact||{costChange:num(p.costChange,0)}),
        status:'NEW', action:{kind:'OPEN_BOOKING', bookingId:p.bookingId}});
    });
    return {suggestions:out, windows, replan, ranked, window:win, empty:!out.length};
  }
  /** 추천 반응 기록 — 향후 선호 학습용 구조만 준비한다. @param {any} sug @param {string} action @param {string} atISO @returns {any} */
  function feedbackEntry(sug, action, atISO){
    return {recommendationId:(sug&&sug.id)||'', key:(sug&&sug.key)||'', type:(sug&&sug.type)||'',
      action:((action==='ACCEPTED'||action==='SKIPPED'||action==='DISMISSED'||action==='REPLACED')? action : 'DISMISSED'),
      createdAt:String(atISO||'')};
  }

  const API={ADAPT_CFG, MEAL_WINDOWS, currentDayIndex, weekdayOf, commitmentOf, priorityOf, statusOf, planningModeHint,
    buildTripState, findFreeWindows, mealOverlap, buildCandidates, rankNextActions, simulate, generateReplan,
    calcSuggestionImpact, suggestionKey, buildSuggestions, feedbackEntry, travelMinutes};
  if(typeof module!=='undefined' && module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_ADAPT=API;                             // 브라우저 전역 (lib/price와 동일 패턴)
})(typeof window!=='undefined'?window:globalThis);
