// Trip Canvas — With J 이야기(장소별 음성 해설) 순수 로직 (DOM·네트워크·현재시각 접근 없음)
//
// 카탈로그(stories/catalog.json)는 With J가 쓰고 검수해 정적 파일로 내보내는 콘텐츠다. 여행 문서에 넣지 않는다.
// 여기는 카탈로그를 믿을 수 있는 모양으로 거르고, 일정의 장소·날에 어느 이야기가 붙는지 정한다.
// ⚠️ 이름만으로 붙이지 않는다 — '스페인 광장'은 마드리드에도, '알카사르'는 세고비아·코르도바에도 있다.
//    Google placeId가 같거나, 좌표가 반경 안이면서 이름이 맞을 때만이다(docs/with-j-stories.md).
// @ts-check
(function(root){
  'use strict';

  /** @typedef {'CORE'|'MORE'|'STOP'} TrackRole */
  /** @typedef {{n:number,find:string[],localName:string}} TrackStop */
  /** @typedef {{id:string,role:TrackRole,title:string,src:string,seconds:number,bytes:number,sha256:string,sources:string[],stop:TrackStop|null}} StoryTrack */
  /** @typedef {{id:string,kind:'PLACE'|'CITY',name:string,localName:string,city:string,lat:number,lng:number,radiusM:number,placeIds:string[],aliases:string[],tracks:StoryTrack[]}} StoryPlace */
  /** @typedef {{title:string,url:string}} StorySource */
  /** @typedef {{version:number,updated:string,disclosure:string,places:StoryPlace[],sources:Record<string,StorySource>}} StoryCatalog */

  const ROLES = Object.freeze(['CORE','MORE','STOP']);
  const ROLE_LABEL = Object.freeze({CORE:'핵심', MORE:'더 듣기', STOP:'관람 지점'});
  const DISCLOSURE = 'AI 음성으로 읽었어요';
  // 카탈로그가 가리킬 수 있는 파일 — stories/ 아래 상대 경로의 mp3만. 밖으로 나가는 주소·상위 경로는 받지 않는다
  const SRC_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*\.mp3$/;
  const MAX_RADIUS_M = 50000;
  const MIN_ALIAS_LEN = 3;

  /** @param {unknown} v @returns {string} */
  const str = v => typeof v === 'string' ? v.trim() : '';
  /** @param {unknown} v @returns {number|null} */
  const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  /** @param {unknown} v @returns {string[]} */
  const strs = v => Array.isArray(v) ? v.map(str).filter(Boolean) : [];

  /** @param {unknown} v @returns {v is Record<string,any>} */
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  /**
   * 트랙 하나 — 검수(reviewedAt)를 거치지 않았거나 파일이 없는 트랙은 내보내지 않는다.
   * @param {unknown} raw @returns {StoryTrack|null}
   */
  function normalizeTrack(raw){
    if(!isObj(raw)) return null;
    const id=str(raw.id), role=str(raw.role), title=str(raw.title), src=str(raw.src);
    if(!id || !title || !ROLES.includes(role) || !SRC_RE.test(src) || src.includes('..')) return null;
    if(!str(raw.reviewedAt)) return null;
    const seconds=num(raw.seconds), bytes=num(raw.bytes);
    if(seconds==null || seconds<=0 || bytes==null || bytes<=0) return null;
    const sha=str(raw.sha256).toLowerCase();
    if(!/^[0-9a-f]{64}$/.test(sha)) return null;
    /** @type {TrackStop|null} */
    let stop=null;
    if(role==='STOP'){
      const s=isObj(raw.stop)? raw.stop : {};
      const n=num(s.n);
      if(n==null || n<1 || !Number.isInteger(n)) return null;
      stop={n, find:strs(s.find).slice(0,5), localName:str(s.localName)};
    }
    return {id, role:/** @type {TrackRole} */(role), title, src, seconds:Math.round(seconds), bytes:Math.round(bytes), sha256:sha, sources:strs(raw.sources), stop};
  }

  /** CORE → MORE → STOP(번호 순) @param {StoryTrack} a @param {StoryTrack} b @returns {number} */
  function trackOrder(a,b){
    const r=ROLES.indexOf(a.role)-ROLES.indexOf(b.role);
    if(r) return r;
    return ((a.stop&&a.stop.n)||0)-((b.stop&&b.stop.n)||0);
  }

  /**
   * 장소 하나. 위치·반경이 없거나 들을 트랙이 하나도 없으면 버린다.
   * @param {unknown} raw @returns {StoryPlace|null}
   */
  function normalizePlace(raw){
    if(!isObj(raw)) return null;
    const id=str(raw.id), kind=str(raw.kind), name=str(raw.name);
    if(!id || !name || (kind!=='PLACE' && kind!=='CITY')) return null;
    const lat=num(raw.lat), lng=num(raw.lng), radiusM=num(raw.radiusM);
    if(lat==null || lng==null || Math.abs(lat)>90 || Math.abs(lng)>180) return null;
    if(radiusM==null || radiusM<=0 || radiusM>MAX_RADIUS_M) return null;
    const seen=new Set();
    const tracks=(Array.isArray(raw.tracks)?raw.tracks:[]).map(normalizeTrack)
      .filter(/** @returns {t is StoryTrack} */ t=>!!t && !seen.has(t.id) && !!seen.add(t.id))
      .sort(trackOrder);
    if(!tracks.length) return null;
    return {id, kind:/** @type {'PLACE'|'CITY'} */(kind), name, localName:str(raw.localName), city:str(raw.city),
      lat, lng, radiusM, placeIds:strs(raw.placeIds), aliases:strs(raw.aliases), tracks};
  }

  /**
   * 받은 카탈로그를 믿을 수 있는 모양으로 — 모르는 값은 버리고, 같은 id는 앞의 것만.
   * @param {unknown} raw @returns {StoryCatalog}
   */
  function normalizeCatalog(raw){
    const obj=isObj(raw)? raw : {};
    const ids=new Set();
    const places=(Array.isArray(obj.places)?obj.places:[]).map(normalizePlace)
      .filter(/** @returns {p is StoryPlace} */ p=>!!p && !ids.has(p.id) && !!ids.add(p.id));
    /** @type {Record<string,StorySource>} */
    const sources={};
    if(isObj(obj.sources)) for(const [k,v] of Object.entries(obj.sources)){
      if(!isObj(v)) continue;
      const url=str(v.url), title=str(v.title);
      if(title && /^https:\/\/[^\s]+$/.test(url)) sources[k]={title,url};
    }
    const voice=isObj(obj.voice)? obj.voice : {};
    return {version:num(obj.version)||0, updated:str(obj.updated), disclosure:str(voice.disclosure)||DISCLOSURE, places, sources};
  }

  /** @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2 @returns {number} 미터 */
  function distanceM(lat1,lng1,lat2,lng2){
    const R=6371000, rad=Math.PI/180;
    const dLat=(lat2-lat1)*rad, dLng=(lng2-lng1)*rad;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
  }

  /**
   * 이름 비교용 열쇠 — 대소문자·악센트·공백·문장부호를 뗀다('Alcázar de Sevilla' → 'alcazardesevilla').
   * @param {unknown} v @returns {string}
   */
  function nameKey(v){
    // ⚠️ NFKD는 한글도 자모로 쪼갠다 — 악센트만 뗀 뒤 NFC로 다시 붙여야 '광장'이 두 글자로 남는다
    return str(v).normalize('NFKD').replace(/[̀-ͯ]/g,'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  }

  /**
   * 장소 이름이 이야기의 이름 중 하나를 담고 있는가(또는 그 반대). 세 글자 미만의 이름으로는 맞추지 않는다.
   * @param {unknown} spotName @param {StoryPlace} place @returns {boolean}
   */
  function nameMatches(spotName, place){
    const n=nameKey(spotName);
    if(n.length<2) return false;
    return [place.name, place.localName, ...place.aliases].map(nameKey)
      .some(a=>a.length>=MIN_ALIAS_LEN && (n===a || n.includes(a) || (n.length>=MIN_ALIAS_LEN && a.includes(n))));
  }

  /** @param {any} spot @returns {{lat:number,lng:number}|null} */
  function coordOf(spot){
    if(!spot || typeof spot!=='object') return null;
    const lat=Number(spot.lat), lng=Number(spot.lng);
    if(spot.lat==null || spot.lng==null || spot.lat==='' || spot.lng==='') return null;
    if(!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return null;
    if(lat===0 && lng===0) return null;
    return {lat,lng};
  }

  /**
   * 일정의 장소에 붙는 이야기 — 없으면 null.
   * 1) Google placeId가 같으면 그 장소 2) 좌표가 반경 안이면서 이름이 맞으면 그 장소(가장 가까운 것).
   * 좌표 없는 장소·이름만 같은 장소에는 붙이지 않는다.
   * @param {any} spot @param {StoryCatalog|null|undefined} catalog @returns {StoryPlace|null}
   */
  function storyForSpot(spot, catalog){
    if(!catalog || !spot || typeof spot!=='object') return null;
    const places=catalog.places.filter(p=>p.kind==='PLACE');
    const pid=str(spot.placeId);
    if(pid){
      const hit=places.find(p=>p.placeIds.includes(pid));
      if(hit) return hit;
    }
    const c=coordOf(spot);
    if(!c) return null;
    let best=null, bestD=Infinity;
    for(const p of places){
      const d=distanceM(c.lat,c.lng,p.lat,p.lng);
      if(d<=p.radiusM && d<bestD && nameMatches(spot.name,p)){ best=p; bestD=d; }
    }
    return best;
  }

  /**
   * 날에 붙는 도시 이야기 — 그날 위치 있는 장소 중 하나라도 도시 반경 안이면 그 도시(첫 장소 기준으로 먼저 걸린 것).
   * @param {{spots?:any[]}|null|undefined} day @param {StoryCatalog|null|undefined} catalog @returns {StoryPlace|null}
   */
  function cityStoryForDay(day, catalog){
    if(!catalog || !day || !Array.isArray(day.spots)) return null;
    const cities=catalog.places.filter(p=>p.kind==='CITY');
    if(!cities.length) return null;
    for(const s of day.spots){
      const c=coordOf(s);
      if(!c) continue;
      const hit=cities.find(p=>distanceM(c.lat,c.lng,p.lat,p.lng)<=p.radiusM);
      if(hit) return hit;
    }
    return null;
  }

  /**
   * 여행 전체에서 붙는 이야기 — 오프라인 저장 대상을 셀 때 쓴다. 같은 이야기는 한 번만.
   * @param {{days?:{spots?:any[]}[]}|null|undefined} trip @param {StoryCatalog|null|undefined} catalog @returns {StoryPlace[]}
   */
  function storiesForTrip(trip, catalog){
    if(!catalog || !trip || !Array.isArray(trip.days)) return [];
    /** @type {Map<string,StoryPlace>} */
    const out=new Map();
    for(const day of trip.days){
      const city=cityStoryForDay(day,catalog);
      if(city) out.set(city.id,city);
      for(const s of (day && Array.isArray(day.spots))? day.spots : []){
        const p=storyForSpot(s,catalog);
        if(p) out.set(p.id,p);
      }
    }
    return [...out.values()];
  }

  /** @param {StoryPlace} place @returns {number} */
  function storyBytes(place){ return place.tracks.reduce((a,t)=>a+t.bytes,0); }

  /** @param {StoryPlace} place @returns {number} */
  function storySeconds(place){ return place.tracks.reduce((a,t)=>a+t.seconds,0); }

  /** '1분 45초' · '45초' · '1시간 2분' @param {number} sec @returns {string} */
  function durationText(sec){
    const s=Math.max(0,Math.round(sec)), h=Math.floor(s/3600), m=Math.floor(s%3600/60), r=s%60;
    if(h) return m? `${h}시간 ${m}분` : `${h}시간`;
    if(m) return r? `${m}분 ${r}초` : `${m}분`;
    return `${r}초`;
  }

  /** '1.4MB' · '820KB' @param {number} bytes @returns {string} */
  function sizeText(bytes){
    if(bytes>=1024*1024) return `${(bytes/1024/1024).toFixed(1)}MB`;
    return `${Math.max(1,Math.round(bytes/1024))}KB`;
  }

  /** 앱에서 부를 주소(같은 출처의 상대 경로) @param {StoryTrack} track @returns {string} */
  function trackUrl(track){ return 'stories/'+track.src; }

  /**
   * 트랙이 기댄 출처 — 카탈로그에 있는 것만, 처음 나온 순서대로.
   * @param {StoryPlace} place @param {StoryCatalog} catalog @returns {(StorySource&{id:string})[]}
   */
  function placeSources(place, catalog){
    const ids=[...new Set(place.tracks.flatMap(t=>t.sources))];
    return ids.filter(id=>catalog.sources[id]).map(id=>({id, ...catalog.sources[id]}));
  }

  const API={ROLES, ROLE_LABEL, DISCLOSURE, normalizeCatalog, normalizeTrack, normalizePlace, distanceM, nameKey, nameMatches,
    storyForSpot, cityStoryForDay, storiesForTrip, storyBytes, storySeconds, durationText, sizeText, trackUrl, placeSources};
  if(typeof module!=='undefined' && module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_STORIES=API;                           // 브라우저 전역
})(typeof window!=='undefined'?window:globalThis);
