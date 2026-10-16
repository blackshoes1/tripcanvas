// TripCanvas — user-provided audio stays on this browser, outside the synced trip document.
(function(root){
  'use strict';

  /** @typedef {{id:string,tripId:string,spotId:string,name:string,type:string,size:number,createdAt:number,blob:Blob}} AudioGuide */
  /** @typedef {Omit<AudioGuide,'blob'>&{blob?:Blob,bytes?:ArrayBuffer}} StoredAudioGuide */
  const MAX_FILE_BYTES=100*1024*1024;
  const ACCEPT='audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.aif,.aiff,.caf';
  const AUDIO_EXTENSION=/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|aif|aiff|caf)$/i;
  const DB_NAME='tripcanvas_audio_guides_v1';
  const STORE='guides';

  class AudioGuideError extends Error{
    /** @param {string} code @param {string} message */
    constructor(code,message){super(message);this.name='AudioGuideError';this.code=code;}
  }

  /** @param {unknown} error @returns {AudioGuideError} */
  function storageError(error){
    if(error instanceof AudioGuideError)return error;
    const name=error&&typeof error==='object'&&'name' in error?String(error.name):'';
    if(name==='QuotaExceededError')return new AudioGuideError('QUOTA','기기 저장 공간이 부족해요. 필요 없는 가이드를 지운 뒤 다시 넣어 주세요.');
    if(name==='SecurityError'||name==='NotAllowedError')return new AudioGuideError('UNAVAILABLE','이 브라우저에서는 음성 파일을 저장할 수 없어요. 저장을 허용한 일반 창에서 다시 열어 주세요.');
    return new AudioGuideError('STORAGE','음성 가이드를 저장하거나 읽지 못했어요. 다시 시도해 주세요.');
  }

  /** Validate the selected file before opening a transaction. @param {File} file @returns {void} */
  function validateFile(file){
    if(!file||typeof file.slice!=='function'||!Number.isFinite(file.size)||file.size<=0)
      throw new AudioGuideError('EMPTY_FILE','비어 있지 않은 음성 파일을 골라 주세요.');
    if(file.size>MAX_FILE_BYTES)throw new AudioGuideError('FILE_TOO_LARGE','음성 파일은 하나에 100MB까지 넣을 수 있어요.');
    const type=String(file.type||'').toLowerCase().split(';')[0].trim();
    const extension=AUDIO_EXTENSION.test(String(file.name||''));
    if(!type.startsWith('audio/')&&!(extension&&(!type||type==='application/octet-stream'||type==='video/mp4')))
      throw new AudioGuideError('NOT_AUDIO','MP3, M4A, WAV 같은 음성 파일을 골라 주세요.');
  }

  /**
   * Places have no durable document id. Provider identity wins; coordinates survive a rename.
   * Repeated visits to the same place in a trip intentionally share the same guide list.
   * @param {{placeId?:unknown,kakaoId?:unknown,lat?:unknown,lng?:unknown,city?:unknown,name?:unknown}|null|undefined} spot
   * @returns {string}
   */
  function placeKey(spot){
    if(!spot)throw new AudioGuideError('INVALID_PLACE','먼저 가이드를 연결할 장소를 골라 주세요.');
    const google=String(spot.placeId==null?'':spot.placeId).trim();
    if(google)return JSON.stringify(['google',google]);
    const kakao=String(spot.kakaoId==null?'':spot.kakaoId).trim();
    if(kakao)return JSON.stringify(['kakao',kakao]);
    const latValue=spot.lat,lngValue=spot.lng;
    if((typeof latValue==='number'||typeof latValue==='string')&&String(latValue).trim()!==''&&(typeof lngValue==='number'||typeof lngValue==='string')&&String(lngValue).trim()!==''){
      const lat=Number(latValue),lng=Number(lngValue);
      if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)
        return JSON.stringify(['point',lat.toFixed(6),lng.toFixed(6)]);
    }
    const name=String(spot.name==null?'':spot.name).trim().toLowerCase();
    if(!name)throw new AudioGuideError('INVALID_PLACE','먼저 가이드를 연결할 장소를 골라 주세요.');
    const city=String(spot.city==null?'':spot.city).trim().toLowerCase();
    return JSON.stringify(['name',city,name]);
  }

  /** @param {string} tripId @param {string} spotId @returns {[string,string]} */
  function scope(tripId,spotId){
    if(typeof tripId!=='string'||!tripId.trim()||typeof spotId!=='string'||!spotId.trim())
      throw new AudioGuideError('INVALID_PLACE','먼저 가이드를 연결할 여행과 장소를 골라 주세요.');
    return [tripId,spotId];
  }

  /**
   * Storage is lazy so browsers without IndexedDB can still open and edit their trips.
   * @param {{indexedDB?:IDBFactory|null,databaseName?:string}} [options]
   */
  function createStore(options){
    const opts=options||{};
    /** @type {Promise<IDBDatabase>|null} */
    let opening=null;
    /** @type {IDBDatabase|null} */
    let database=null;

    /** @returns {Promise<IDBDatabase>} */
    function open(){
      if(opening)return opening;
      const pending=new Promise((/** @type {(db:IDBDatabase)=>void} */resolve,reject)=>{
        try{
          const factory=Object.prototype.hasOwnProperty.call(opts,'indexedDB')?opts.indexedDB:root.indexedDB;
          if(!factory){reject(new AudioGuideError('UNAVAILABLE','이 브라우저에서는 음성 파일을 저장할 수 없어요. 다른 브라우저에서 열어 주세요.'));return;}
          const request=factory.open(opts.databaseName||DB_NAME,1);
          let settled=false;
          request.onupgradeneeded=()=>{
            try{
              const db=request.result;
              if(!db.objectStoreNames.contains(STORE)){
                const store=db.createObjectStore(STORE,{keyPath:'id'});
                store.createIndex('place',['tripId','spotId'],{unique:false});
              }
            }catch(error){settled=true;request.transaction?.abort();reject(storageError(error));}
          };
          request.onerror=()=>{settled=true;reject(storageError(request.error));};
          request.onblocked=()=>{settled=true;reject(new AudioGuideError('BLOCKED','다른 With J 창을 닫고 음성 가이드를 다시 열어 주세요.'));};
          request.onsuccess=()=>{
            const db=request.result;
            if(settled){db.close();return;}
            settled=true;
            database=db;
            db.onversionchange=()=>{db.close();database=null;opening=null;};
            db.onclose=()=>{if(database===db){database=null;opening=null;}};
            resolve(db);
          };
        }catch(error){reject(storageError(error));}
      });
      opening=pending;
      pending.catch(()=>{if(opening===pending)opening=null;});
      return pending;
    }

    /**
     * A write succeeds only when its transaction commits, never at request.onsuccess.
     * @template T
     * @param {IDBTransactionMode} mode
     * @param {(store:IDBObjectStore,setResult:(value:T)=>void)=>void} operation
     * @returns {Promise<T>}
     */
    async function transact(mode,operation){
      const db=await open();
      return new Promise((resolve,reject)=>{
        try{
          const tx=db.transaction(STORE,mode);
          /** @type {T} */
          let result;
          tx.oncomplete=()=>resolve(result);
          tx.onerror=event=>reject(storageError((/** @type {IDBRequest|null} */(event.target))?.error||tx.error));
          tx.onabort=()=>reject(storageError(tx.error));
          try{operation(tx.objectStore(STORE),value=>{result=value;});}
          catch(error){tx.abort();reject(storageError(error));}
        }catch(error){reject(storageError(error));}
      });
    }

    /** @param {string} tripId @param {string} spotId @returns {Promise<AudioGuide[]>} */
    async function list(tripId,spotId){
      const key=scope(tripId,spotId);
      const rows=await transact('readonly',(store,done)=>{
        const request=store.index('place').getAll(key);
        request.onsuccess=()=>done(/** @type {StoredAudioGuide[]} */(request.result));
      });
      return /** @type {StoredAudioGuide[]} */(rows).map(row=>{
        // Some WebKit ports cannot persist Blob/File in IndexedDB. Read legacy Blob rows
        // too, but reconstruct new byte-backed records only after the read commits.
        const blob=row.blob||(row.bytes?new root.Blob([row.bytes],{type:row.type}):null);
        if(!blob)throw storageError(null);
        return {id:row.id,tripId:row.tripId,spotId:row.spotId,name:row.name,type:row.type,size:row.size,createdAt:row.createdAt,blob};
      }).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
    }

    /** @param {string} tripId @param {string} spotId @param {File} file @returns {Promise<AudioGuide>} */
    async function add(tripId,spotId,file){
      scope(tripId,spotId);
      validateFile(file);
      // File IO must finish before opening an IDB transaction; awaiting it inside the
      // transaction can make Safari auto-commit before the add request is issued.
      let bytes;
      try{bytes=await file.arrayBuffer();}catch(error){throw storageError(error);}
      const id=root.crypto&&typeof root.crypto.randomUUID==='function'?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
      const metadata={id,tripId,spotId,name:String(file.name||'음성 가이드').slice(0,240),type:file.type||'',size:file.size,createdAt:Date.now()};
      /** @type {AudioGuide} */
      const guide={...metadata,blob:file.slice(0,file.size,file.type)};
      await transact('readwrite',(store,done)=>{
        store.add({...metadata,bytes});
        done(guide);
      });
      return guide;
    }

    /** A stale UI cannot delete a guide belonging to a different place or trip.
     * @param {string} tripId @param {string} spotId @param {string} id @returns {Promise<boolean>}
     */
    async function remove(tripId,spotId,id){
      scope(tripId,spotId);
      return /** @type {Promise<boolean>} */(transact('readwrite',(store,done)=>{
        const request=store.get(id);
        request.onsuccess=()=>{
          const guide=/** @type {AudioGuide|undefined} */(request.result);
          if(!guide||guide.tripId!==tripId||guide.spotId!==spotId){done(false);return;}
          store.delete(id);
          done(true);
        };
      }));
    }

    function close(){if(database)database.close();database=null;opening=null;}
    return {list,add,remove,close};
  }

  const API={MAX_FILE_BYTES,ACCEPT,AudioGuideError,validateFile,placeKey,createStore};
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  else root.TCAudioGuides=API;
})(/** @type {any} */(typeof window!=='undefined'?window:globalThis));
