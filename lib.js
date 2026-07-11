// Trip Canvas — 순수 로직 (브라우저 전역 + Node 모듈 겸용, 유닛 테스트 대상)
(function(root){
  'use strict';

  // 로컬 날짜 → YYYY-MM-DD (타임존 밀림 방지)
  function toISO(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  // 직선거리(하버사인, km)
  function haversine(a,b){
    const R=6371, toRad=x=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const h=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }

  // 구간 캐시 키 (좌표 4자리 + 이동수단)
  function legId(a,b){ return `${(+a.lat).toFixed(4)},${(+a.lng).toFixed(4)}>${(+b.lat).toFixed(4)},${(+b.lng).toFixed(4)}`; }
  function legKey(a,b,mode){ return legId(a,b)+'#'+(mode||'car'); }

  // p 주변 반경 r(m) 8방위 후보점 (도로 스냅)
  function ringPts(p,r){
    const dLat=r/111320, dLng=r/(111320*Math.cos(p.lat*Math.PI/180));
    const out=[];
    for(let k=0;k<8;k++){ const th=k*Math.PI/4; out.push({lat:p.lat+dLat*Math.sin(th), lng:p.lng+dLng*Math.cos(th)}); }
    return out;
  }

  // HH:MM ↔ 분
  function parseHM(t){ const m=/^(\d{1,2}):(\d{2})$/.exec(t||''); return m? (+m[1])*60+(+m[2]) : 9*60; }
  function hm(min){ min=((Math.round(min)%1440)+1440)%1440; return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }

  // 한국 영역 여부 (엔진·라우팅 선택)
  function inKorea(p){ return !!p && p.lat>=33 && p.lat<=39 && p.lng>=124.5 && p.lng<=132; }

  // 서술형 꼬리말 제거 ("감포 바다"→"감포", 괄호 제거)
  function simplifyName(n){
    return String(n||'').replace(/\([^)]*\)/g,'')
      .replace(/\s*(앞바다|바다|해변|해수욕장|일대|근처|주변|전경|야경|거리|풍경)\s*$/,'').trim();
  }

  // 붙여넣기 직접 형식 → 구조화
  function parseDirect(text){
    const out={name:'',start:'',days:[]};
    let cur=null, lastCity='';
    String(text||'').split(/\r?\n/).forEach(raw=>{
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

  // 폴리라인 인코딩/디코딩 (Google 알고리즘, precision 5) — SDK 비의존, 구글 encodedPolyline과 호환
  function encodePolyline(points){
    const factor=1e5; let lat=0,lng=0,res='';
    const enc=v=>{ v=v<0?~(v<<1):(v<<1); let s=''; while(v>=0x20){ s+=String.fromCharCode((0x20|(v&0x1f))+63); v>>>=5; } s+=String.fromCharCode(v+63); return s; };
    for(const p of points){ const la=Math.round(p.lat*factor), ln=Math.round(p.lng*factor); res+=enc(la-lat)+enc(ln-lng); lat=la; lng=ln; }
    return res;
  }
  function decodePolyline(str){
    const factor=1e5; let i=0,lat=0,lng=0; const out=[]; str=str||'';
    while(i<str.length){
      let b,shift=0,result=0;
      do{ b=str.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; }while(b>=0x20);
      lat+=(result&1)?~(result>>1):(result>>1);
      shift=0; result=0;
      do{ b=str.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; }while(b>=0x20);
      lng+=(result&1)?~(result>>1):(result>>1);
      out.push({lat:lat/factor, lng:lng/factor});
    }
    return out;
  }

  // 동선 순서 최적화 — 직선거리 기준 nearest-neighbor + 2-opt.
  // coords: [{lat,lng}], opt.fixStart(기본 true: 첫 지점 고정)·opt.fixEnd(마지막 고정, 숙소 복귀 등)
  // 반환: 방문 순서 인덱스 배열
  function optimizeRoute(coords, opt){
    opt=opt||{}; const n=coords.length;
    if(n<=2) return coords.map((_,i)=>i);
    const D=(i,j)=>haversine(coords[i],coords[j]);
    const fixStart=opt.fixStart!==false, fixEnd=!!opt.fixEnd;
    const startIdx=0, endIdx=fixEnd?n-1:-1;
    const pool=[]; for(let i=0;i<n;i++) if(i!==startIdx && i!==endIdx) pool.push(i);
    // nearest-neighbor (시작점에서 가장 가까운 순으로)
    const order=[startIdx]; let cur=startIdx;
    while(pool.length){
      let best=0,bd=Infinity;
      for(let k=0;k<pool.length;k++){ const d=D(cur,pool[k]); if(d<bd){bd=d;best=k;} }
      cur=pool.splice(best,1)[0]; order.push(cur);
    }
    if(endIdx>=0) order.push(endIdx);
    // 2-opt (고정 끝점 존중)
    const lo=fixStart?1:0, hi=fixEnd?order.length-2:order.length-1;
    let improved=true, guard=0;
    while(improved && guard++<200){
      improved=false;
      for(let i=lo;i<=hi;i++){
        for(let j=i+1;j<=hi;j++){
          const a=order[i-1], b=order[i], c=order[j], d=(j+1<order.length?order[j+1]:-1);
          const before=D(a,b)+(d>=0?D(c,d):0);
          const after=D(a,c)+(d>=0?D(b,d):0);
          if(after+1e-9<before){ let x=i,y=j; while(x<y){ const t=order[x];order[x]=order[y];order[y]=t;x++;y--; } improved=true; }
        }
      }
    }
    return order;
  }
  // 경로 총 직선거리(km)
  function routeLength(coords, order){
    order=order||coords.map((_,i)=>i); let s=0;
    for(let k=1;k<order.length;k++) s+=haversine(coords[order[k-1]],coords[order[k]]);
    return s;
  }

  const TC={toISO,haversine,legId,legKey,ringPts,parseHM,hm,inKorea,simplifyName,parseDirect,encodePolyline,decodePolyline,optimizeRoute,routeLength};
  if(typeof module!=='undefined' && module.exports){ module.exports=TC; }   // Node (테스트)
  else { for(const k in TC) root[k]=TC[k]; }                                // 브라우저 전역
})(typeof window!=='undefined'?window:globalThis);
