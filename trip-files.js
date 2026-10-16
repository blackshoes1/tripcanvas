// Shared files: an account-scoped offline cache, outside itinerary JSON.
(function(root){
  'use strict';
  const AUDIO_LIMIT=25*1024*1024, DOCUMENT_LIMIT=10*1024*1024;
  const AUDIO_ACCEPT='.mp3,.m4a,.wav,.ogg,.oga,.opus,.flac';
  const DOCUMENT_ACCEPT='.pdf,.jpg,.jpeg,.png,.webp,.txt';
  function validate(file,kind){
    if(!file||file.size<=0)throw new Error('비어 있지 않은 파일을 골라 주세요.');
    const limit=kind==='AUDIO'?AUDIO_LIMIT:DOCUMENT_LIMIT;
    if(file.size>limit)throw new Error(kind==='AUDIO'?'공유 음성은 파일당 25MB까지 올릴 수 있어요.':'문서는 파일당 10MB까지 올릴 수 있어요.');
    const ext=String(file.name).split('.').pop().toLowerCase();
    if(!(kind==='AUDIO'?AUDIO_ACCEPT:DOCUMENT_ACCEPT).split(',').includes('.'+ext))throw new Error('지원하는 파일 형식을 골라 주세요.');
  }
  function createCache(){
    let opening;
    function open(){
      if(!opening)opening=new Promise((resolve,reject)=>{
        const request=root.indexedDB.open('tripcanvas_shared_files_v1',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('files');
        let blocked=false;
        request.onsuccess=()=>{
          const db=request.result;
          if(blocked){db.close();return;}
          db.onversionchange=()=>{db.close();opening=null;};resolve(db);
        };
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>{blocked=true;reject(new Error('다른 With J 창을 닫고 다시 시도해 주세요.'));};
      }).catch(error=>{opening=null;throw error;});
      return opening;
    }
    async function operate(mode,key,value,remove=false){
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('files',mode), store=tx.objectStore('files');
        let result;
        const request=mode==='readonly'?store.get(key):remove?store.delete(key):store.put(value,key);
        request.onsuccess=()=>{result=request.result;};
        tx.oncomplete=()=>resolve(result);
        tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
    }
    const key=(scope,id)=>JSON.stringify([scope,id]);
    return {
      list:scope=>operate('readonly',key(scope,'list')),
      saveList:(scope,files)=>operate('readwrite',key(scope,'list'),files),
      async get(scope,id){const row=await operate('readonly',key(scope,id));return row?new root.Blob([row.bytes],{type:row.mime}):null;},
      async save(scope,id,blob){return operate('readwrite',key(scope,id),{bytes:await blob.arrayBuffer(),mime:blob.type});},
      remove:(scope,id)=>operate('readwrite',key(scope,id),null,true)
    };
  }
  const api={validate,createCache,AUDIO_ACCEPT,DOCUMENT_ACCEPT};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.TCTripFiles=api;
})(typeof globalThis!=='undefined'?globalThis:this);
