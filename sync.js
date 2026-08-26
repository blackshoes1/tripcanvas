(function(root){
  'use strict';

  /** @param {any} raw @param {any[]} legacyIds @returns {Record<string, any>} */
  function loadMeta(raw, legacyIds){
    let value={};
    try{ value=typeof raw==='string'?JSON.parse(raw):(raw||{}); }catch(_){ value={}; }
    if(!value || typeof value!=='object' || Array.isArray(value)) value={};
    /** @type {Record<string,any>} */ const out={};
    for(const [id,entry] of Object.entries(value)){
      if(!id || !entry || typeof entry!=='object') continue;
      out[id]={revision:Number.isInteger(+entry.revision)&&+entry.revision>0?+entry.revision:null,status:String(entry.status||'clean'),op:String(entry.op||''),hash:entry.hash?String(entry.hash):''};
    }
    for(const id of Array.isArray(legacyIds)?legacyIds:[]) if(id&&!out[id]) out[id]={revision:null,status:'legacy',op:'',hash:''};
    return out;
  }

  // 마지막으로 클라우드에 올린 내용의 지문. revision만으로는 "로컬이 그 revision 그대로인지"를 알 수 없어
  // (예: 활성 여행이 아니라 업로드가 누락된 편집) 내용 자체를 비교해 밀린 여행을 찾아낸다.
  /** @param {any} value @returns {string} */
  function hashTrip(value){
    let json=''; try{ json=JSON.stringify(value)||''; }catch(_){ return ''; }
    let h=5381;
    for(let i=0;i<json.length;i++) h=((h*33)^json.charCodeAt(i))>>>0;
    return json.length.toString(36)+'.'+h.toString(36);
  }

  /** @param {any} a @param {any} b @returns {boolean} */
  function sameData(a,b){
    try{return JSON.stringify(a)===JSON.stringify(b);}catch(_){return false;}
  }

  /**
   * 로그인 병합을 결정한다. 원격이 더 새롭거나 tombstone이면 로컬을 자동 삭제/덮어쓰기하지 않고 conflict로 보존한다.
   * @param {any[]} localTrips @param {any[]} remoteRows @param {Record<string,any>} currentMeta
   */
  function mergeForLogin(localTrips, remoteRows, currentMeta){
    const meta=loadMeta(currentMeta,[]), trips=[], actions=[], conflicts=[];
    const remote=new Map((remoteRows||[]).filter(r=>r&&r.client_id).map(r=>[r.client_id,r]));
    for(const local of localTrips||[]){
      if(!local||!local.id) continue;
      const row=remote.get(local.id), entry=meta[local.id]||{revision:null,status:'new',op:''};
      remote.delete(local.id);
      if(!row){
        trips.push(local);
        if(entry.revision) conflicts.push({kind:'remote-missing',local,remote:null,revision:entry.revision,deleted_at:null});
        else actions.push({kind:'upload',trip:local,force:false});
        meta[local.id]=entry;
        continue;
      }
      const revision=Number(row.revision)||1;
      // 미해결 충돌에는 서버 revision을 stamp하지 않는다. stamp하면 다음 로그인 병합이
      // "로컬이 그 revision의 후손"으로 착각해 원격본을 조용히 덮어쓴다(양쪽 편집 유실).
      if(row.deleted_at){
        trips.push(local);
        meta[local.id]={revision:entry.revision,status:'conflict',op:'',hash:entry.hash||''};
        conflicts.push({kind:'remote-deleted',local,remote:row.data||null,revision,deleted_at:row.deleted_at});
      }else if(sameData(local,row.data)){
        trips.push(row.data);
        meta[local.id]={revision,status:'clean',op:'',hash:hashTrip(row.data)};
      }else if(entry.revision && entry.revision===revision){
        trips.push(local);
        meta[local.id]={revision,status:'dirty',op:'',hash:entry.hash||''};
        actions.push({kind:'upload',trip:local,force:false});
      }else{
        trips.push(local);
        meta[local.id]={revision:entry.revision,status:'conflict',op:'',hash:entry.hash||''};
        conflicts.push({kind:'changed-both',local,remote:row.data,revision,deleted_at:null});
      }
    }
    for(const [id,row] of remote){
      const revision=Number(row.revision)||1;
      meta[id]={revision,status:row.deleted_at?'tombstoned':'clean',op:'',hash:row.data?hashTrip(row.data):''};
      if(!row.deleted_at && row.data) trips.push(row.data);
    }
    return {trips,actions,conflicts,meta};
  }

  /** @param {Record<string,any>} meta @param {string} id @param {string} op */
  function beginDelete(meta,id,op){
    const prev=meta[id]||{};
    meta[id]={revision:prev.revision||null,status:'delete-pending',op,hash:prev.hash||''};
    return meta[id];
  }
  /** @param {Record<string,any>} meta @param {string} id */
  function undoDelete(meta,id){
    const prev=meta[id]||{};
    meta[id]={revision:prev.revision||null,status:'dirty',op:'',hash:''};   // 부활한 여행은 반드시 재업로드
    return meta[id];
  }
  /** @param {Record<string,any>} meta @param {string} id @param {string} op @param {number} revision */
  function finishDelete(meta,id,op,revision){
    const current=meta[id]||{};
    if(current.op!==op){
      meta[id]={revision,status:'dirty',op:'',hash:''};
      return {resync:true,entry:meta[id]};
    }
    meta[id]={revision,status:'tombstoned',op:'',hash:''};
    return {resync:false,entry:meta[id]};
  }

  const API={loadMeta,sameData,hashTrip,mergeForLogin,beginDelete,undoDelete,finishDelete};
  if(typeof module!=='undefined'&&module.exports) module.exports=API;
  else /** @type {any} */(root).TC_SYNC=API;
})(typeof window!=='undefined'?window:globalThis);
