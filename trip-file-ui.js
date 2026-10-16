/* global TCTripFiles, TC_API */
(function(root){
  'use strict';
  const el=id=>document.getElementById(id), dialog=el('tripFileDialog'), cache=TCTripFiles.createCache();
  let ctx=null, serial=0, rows=[], canEdit=false, busy=false, audioURL=null, playing=null, playingCtx=null, travel=null;
  const audio=el('tripFileAudio');
  function node(tag,text,cls){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
  function valid(c){return ctx===c&&c.stillCurrent();}
  function status(text,error=false){el('tripFileStatus').textContent=text;el('tripFileStatus').classList.toggle('audioGuideError',error);}
  function controls(on){busy=on;el('tripFileInput').disabled=on||!canEdit;dialog.querySelectorAll('[data-file-action]').forEach(b=>{b.disabled=on;});}
  function stop(){
    audio.pause();audio.removeAttribute('src');audio.load();
    if(audioURL)URL.revokeObjectURL(audioURL);audioURL=null;playing=null;playingCtx=null;el('tripFilePlayer').hidden=true;
    if(root.navigator.mediaSession)root.navigator.mediaSession.metadata=null;
  }
  function close(){++serial;ctx=null;dialog.close();if(travel){travel.removeAttribute('inert');travel=null;}}
  async function result(promise){const response=await promise;if(response.error)throw Object.assign(new Error(response.error.message),response.error);return response.data;}
  function progressKey(c,row){return JSON.stringify(['withj-file-position',c.scope,row.id]);}
  audio.ontimeupdate=()=>{
    if(playing&&playingCtx){try{root.localStorage.setItem(progressKey(playingCtx,playing),String(audio.currentTime));}catch(_){/* optional resume */}}
    dialog.querySelectorAll('[data-file-seek]').forEach(slider=>{
      slider.disabled=slider.dataset.fileSeek!==playing?.id;slider.max=String(Number.isFinite(audio.duration)?audio.duration:1);slider.value=String(audio.currentTime);
    });
  };
  audio.onended=()=>{if(playing&&playingCtx){try{root.localStorage.removeItem(progressKey(playingCtx,playing));}catch(_){/* optional */}}};
  audio.onerror=()=>{if(playing)el('tripFilePlayerTitle').textContent='재생할 수 없는 음성이에요. MP3·M4A로 변환해 다시 올려 주세요.';};
  el('tripFilePlayerClose').onclick=stop;
  async function bytes(c,row){
    const saved=await cache.get(c.scope,row.id).catch(()=>null);
    if(saved)return saved;
    const blob=await result(TC_API.files.download(c.tripId,row.id));
    if(!c.stillCurrent())throw new Error('계정이나 여행이 바뀌었어요. 다시 열어 주세요.');
    try{await cache.save(c.scope,row.id,blob);}catch(_){status('파일은 열었지만 기기 저장 공간이 부족해 오프라인 보관은 못 했어요.',true);}
    return blob;
  }
  async function openFile(c,row){
    if(row.kind==='AUDIO'&&playing?.id===row.id){
      if(audio.paused)await audio.play();else audio.pause();return;
    }
    const blob=await bytes(c,row);if(!valid(c))return;
    if(row.kind==='AUDIO'){
      stop();playing=row;playingCtx=c;
      // Stop a local guide too: two voices must never play together.
      document.querySelectorAll('#audioGuideList audio').forEach(a=>a.pause());
      audioURL=URL.createObjectURL(blob);audio.src=audioURL;el('tripFilePlayerTitle').textContent=row.title;el('tripFilePlayer').hidden=false;
      audio.onloadedmetadata=()=>{try{const t=Number(root.localStorage.getItem(progressKey(c,row)))||0;if(t<audio.duration-2)audio.currentTime=t;}catch(_){/* optional */}};
      if(root.navigator.mediaSession){
        if(root.MediaMetadata)root.navigator.mediaSession.metadata=new root.MediaMetadata({title:row.title,artist:'With J'});
        for(const [action,handler] of [['play',()=>audio.play().catch(()=>{})],['pause',()=>audio.pause()],['seekto',e=>{if(Number.isFinite(e.seekTime))audio.currentTime=e.seekTime;}]]) {
          try{root.navigator.mediaSession.setActionHandler(action,handler);}catch(_){/* browser support varies */}
        }
      }
      await audio.play();
    }else{
      const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=row.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
  }
  async function action(c,fn){if(busy||!valid(c))return;controls(true);try{await fn();}catch(error){if(valid(c))status(error.message||'파일을 처리하지 못했어요.',true);}finally{if(valid(c))controls(false);}}
  async function render(c){
    const list=el('tripFileList');list.replaceChildren();
    const filtered=rows.filter(row=>row.kind===c.kind&&(c.kind!=='AUDIO'||row.placeKey===c.placeKey));
    if(!filtered.length)list.appendChild(node('p',c.kind==='AUDIO'?'이 장소에 공유한 음성이 없어요.':'아직 첨부한 문서가 없어요.','hint'));
    for(const [index,row] of filtered.entries()){
      const item=node('article',null,'audioGuideItem');item.appendChild(node('h3',row.title));
      const local=await cache.get(c.scope,row.id).catch(()=>null);if(!valid(c))return;
      const size=row.size<1024?row.size+' B':row.size<1024*1024?Math.ceil(row.size/1024)+' KB':(row.size/1024/1024).toFixed(1)+' MB';
      item.appendChild(node('p',size+' · '+(local?'오프라인 저장됨':'여행 멤버와 공유'),'hint'));
      const actions=node('div',null,'row tripFileActions');
      function button(label,fn){const b=node('button',label,'btn sm');b.type='button';b.dataset.fileAction='';b.onclick=()=>action(c,fn);actions.appendChild(b);return b;}
      button(row.kind==='AUDIO'?'듣기':'내려받기',()=>openFile(c,row));
      if(row.kind==='AUDIO'){
        button('일시정지',async()=>{if(playing?.id===row.id)audio.pause();});
        const seek=node('input');seek.type='range';seek.min='0';seek.max='1';seek.value='0';seek.step='1';
        seek.dataset.fileSeek=row.id;seek.disabled=playing?.id!==row.id;seek.setAttribute('aria-label',row.title+' 재생 위치');
        seek.oninput=()=>{if(playing?.id===row.id)audio.currentTime=Number(seek.value);};item.appendChild(seek);
      }
      button(local?'기기 사본 지우기':'오프라인 저장',async()=>{
        if(local){if(playing?.id===row.id)stop();await cache.remove(c.scope,row.id);}
        else {
          await bytes(c,row);
          await cache.saveList(c.scope,rows);
          if(!await cache.get(c.scope,row.id))throw new Error('기기에 저장하지 못했어요. 저장 공간과 브라우저 권한을 확인해 주세요.');
        }
        if(valid(c)){await render(c);status(local?'이 기기의 사본만 지웠어요.':'이 기기에 저장했어요. 인터넷 없이 열 수 있어요.');}
      });
      if(canEdit){
        button('제목 수정',async()=>{
          const title=root.prompt('표시할 제목',row.title);if(title===null||!title.trim())return;
          await result(TC_API.files.edit(c.tripId,row.id,{title:title.trim()}));if(valid(c))await refresh(c);
        });
        if(c.kind==='AUDIO'&&index>0)button('위로',async()=>{
          // The server swaps adjacent positions in one transaction.
          await result(TC_API.files.edit(c.tripId,row.id,{move:'UP'}));if(valid(c))await refresh(c);
        });
        button('공유 파일 삭제',async()=>{
          if(!root.confirm('“'+row.title+'” 파일을 여행에서 삭제할까요? 다른 기기에서 새로 내려받을 수 없게 돼요.'))return;
          await result(TC_API.files.remove(c.tripId,row.id));await cache.remove(c.scope,row.id).catch(()=>{});
          if(playing?.id===row.id)stop();if(valid(c))await refresh(c);
        });
      }
      item.appendChild(actions);list.appendChild(item);
    }
  }
  async function refresh(c){
    const seq=++serial;status('공유 파일을 불러오는 중…');controls(true);
    try{
      const response=await TC_API.files.list(c.tripId);if(!valid(c)||seq!==serial)return;
      if(response.error){
        if(![0,408,425,429,500,502,503,504].includes(response.error.status))throw new Error(response.error.message);
        const saved=await cache.list(c.scope);if(!saved)throw new Error('인터넷에 연결한 뒤 파일 목록을 먼저 열어 주세요.');
        rows=saved;canEdit=false;status('오프라인이에요. 미리 저장한 파일을 열 수 있어요.');
      }else{
        rows=response.data.files;canEdit=response.data.canEdit;status('여행 멤버만 열 수 있어요. 필요한 파일은 출발 전에 오프라인으로 저장해 주세요.');
        await cache.saveList(c.scope,rows).catch(()=>{});
      }
      if(valid(c)&&seq===serial)await render(c);
    }catch(error){if(valid(c)&&seq===serial){rows=[];canEdit=false;el('tripFileList').replaceChildren();status(error.message,true);}}
    finally{if(valid(c)&&seq===serial){el('tripFileUpload').hidden=!canEdit;controls(false);}}
  }
  function open(c){
    close();ctx=c;canEdit=false;rows=[];controls(false);
    el('tripFileTitle').textContent=c.kind==='AUDIO'?'함께 듣는 음성 가이드':'여행 티켓·문서';
    el('tripFileContext').textContent=c.label;
    el('tripFileInput').accept=c.kind==='AUDIO'?TCTripFiles.AUDIO_ACCEPT:TCTripFiles.DOCUMENT_ACCEPT;
    el('tripFileHint').textContent=c.kind==='AUDIO'?'MP3·M4A·WAV·OGG·FLAC · 파일당 25MB · 제목과 순서를 바꿀 수 있어요.':'PDF·JPEG·PNG·WebP·TXT · 파일당 10MB · 티켓·예약 확인서 등을 넣어 주세요.';
    el('tripFileList').replaceChildren();dialog.showModal();refresh(c);
    el('tripFileLocalAudio').hidden=!c.openLocal;
    const screen=el('travel');if(screen?.classList.contains('show')&&!screen.hasAttribute('inert')){travel=screen;travel.setAttribute('inert','');}
  }
  el('tripFileInput').onchange=event=>{
    const c=ctx,files=Array.from(event.target.files||[]);event.target.value='';
    if(!c||!files.length)return;
    action(c,async()=>{
      if(files.length>20)throw new Error('한 번에 최대 20개까지 골라 주세요.');
      let saved=0;const errors=[];
      for(const [index,file] of files.entries()){
        if(!valid(c))break;
        try{
          TCTripFiles.validate(file,c.kind);let data;
          for(let attempt=0;attempt<3;attempt++){
            if(!valid(c))break;
            status((index+1)+' / '+files.length+' · '+file.name+(attempt?' · 다시 시도 중…':' · 업로드 중…'));
            const response=await TC_API.files.upload(c.tripId,file,{kind:c.kind,placeKey:c.placeKey||'',name:file.name});
            if(!response.error){data=response.data;break;}
            if(attempt===2||![0,408,425,429,500,502,503,504].includes(response.error.status))throw new Error(response.error.message);
            await new Promise(resolve=>setTimeout(resolve,1000*Math.pow(2,attempt)));
          }
          if(!data)break;
          saved++;
          if(valid(c))await cache.save(c.scope,data.file.id,file).catch(()=>{});
        }catch(error){errors.push(file.name+': '+error.message);}
      }
      if(valid(c)){await refresh(c);status([saved?saved+'개 파일을 공유했어요.':'',...errors].filter(Boolean).join(' '),errors.length>0);}
    });
  };
  el('tripFileClose').onclick=close;
  el('tripFileLocalAudio').onclick=()=>{const c=ctx;if(c?.openLocal){close();c.openLocal();}};
  el('tripFileRefresh').onclick=()=>{if(ctx&&!busy)refresh(ctx);};
  dialog.addEventListener('close',()=>{if(ctx){ctx=null;++serial;}if(travel){travel.removeAttribute('inert');travel=null;}});
  root.addEventListener('pagehide',stop);
  root.TC_FILE_UI={open,close,reset:()=>{close();stop();},pause:()=>audio.pause(),check:()=>{
    if(ctx&&!ctx.stillCurrent())close();
    if(playingCtx&&!playingCtx.stillCurrent())stop();
  }};
})(window);
