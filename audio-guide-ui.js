/* global TCAudioGuides */
// Local audio belongs to this browser/account, never to the synced trip document.
(function(root){
  'use strict';
  const el=id=>document.getElementById(id);
  let context=null, sequence=0, store=null, urls=[], busy=false, travel=null;
  const bg=el('audioGuideBg');
  function release(){
    el('audioGuideList').querySelectorAll('audio').forEach(audio=>{
      audio.pause(); audio.removeAttribute('src'); audio.load();
    });
    urls.forEach(url=>URL.revokeObjectURL(url)); urls=[];
    el('audioGuideList').replaceChildren();
  }
  function close(){
    ++sequence; context=null; busy=false; release();
    if(travel){travel.removeAttribute('inert');travel=null;}
    el('audioGuideFiles').value=''; bg.classList.remove('show');
  }
  function current(ctx){
    if(context!==ctx||!bg.classList.contains('show')) return false;
    if(!ctx.stillCurrent(selected(ctx)?.key)){close();return false;}
    return true;
  }
  function controls(disabled){
    busy=disabled;
    el('audioGuideFiles').disabled=disabled;
    el('audioGuidePlaceSelect').disabled=disabled;
    el('audioGuideList').querySelectorAll('button').forEach(button=>{button.disabled=disabled;});
  }
  function status(message,error=false){
    const box=el('audioGuideStatus');box.textContent=message;box.classList.toggle('audioGuideError',error);
  }
  function selected(ctx){return ctx.places[Number(el('audioGuidePlaceSelect').value)];}
  function message(error){return error?.name==='AudioGuideError'?error.message:'음성을 저장하거나 읽지 못했어요. 다시 시도해 주세요.';}
  function node(tag,text,className){
    const item=document.createElement(tag); if(text) item.textContent=text;
    if(className) item.className=className; return item;
  }
  async function refresh(ctx){
    const seq=++sequence, place=selected(ctx);
    release(); el('audioGuidePlace').textContent=place.label;
    status('음성을 불러오는 중…'); controls(true);
    try{
      const rows=await store.list(ctx.scope,place.key);
      if(!current(ctx)||seq!==sequence)return;
      status(rows.length?`${rows.length}개의 음성 · 재생 버튼을 눌러 들어 보세요.`:'아직 연결한 음성이 없어요. 아래에서 파일을 선택해 주세요.');
      rows.forEach(row=>{
        const item=node('article',null,'audioGuideItem');
        item.appendChild(node('h3',row.name));
        item.appendChild(node('p',`${(row.size/1024/1024).toFixed(1)} MB · 이 기기에 저장됨`,'hint'));
        const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';
        audio.setAttribute('aria-label',row.name+' 음성 가이드');
        const url=URL.createObjectURL(row.blob);urls.push(url);audio.src=url;
        audio.onplay=()=>{root.TC_FILE_UI?.pause();el('audioGuideList').querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});};
        audio.onerror=()=>{
          if(!current(ctx)||seq!==sequence)return;
          status('이 파일을 재생하지 못했어요. MP3 또는 M4A로 변환해 다시 추가해 주세요.',true);
        };
        item.appendChild(audio);
        const remove=node('button','음성 삭제','btn sm');remove.type='button';
        remove.setAttribute('aria-label',row.name+' 음성 삭제');
        remove.onclick=async()=>{
          if(busy||!current(ctx))return;
          if(!root.confirm(`“${row.name}” 음성을 이 기기에서 삭제할까요? 원본 파일은 남아요.`))return;
          controls(true);audio.pause();
          try{
            await store.remove(ctx.scope,place.key,row.id);
            if(current(ctx))await refresh(ctx);
          }catch(error){if(current(ctx))status(message(error),true);}
          finally{if(current(ctx))controls(false);}
        };
        item.appendChild(remove);el('audioGuideList').appendChild(item);
      });
    }catch(error){if(current(ctx)&&seq===sequence)status(message(error),true);}
    finally{if(current(ctx)&&seq===sequence)controls(false);}
  }
  function open(ctx){
    close(); context=ctx;
    store=store||TCAudioGuides.createStore();
    const select=el('audioGuidePlaceSelect');select.replaceChildren();
    ctx.places.forEach((place,i)=>{
      const option=node('option',place.label);option.value=String(i);select.appendChild(option);
    });
    select.value=String(ctx.selected);el('audioGuideFiles').accept=TCAudioGuides.ACCEPT;
    controls(false);bg.classList.add('show');
    const screen=el('travel');
    if(screen?.classList.contains('show')&&!screen.hasAttribute('inert')){travel=screen;travel.setAttribute('inert','');}
    refresh(ctx);
  }
  el('audioGuideClose').onclick=close;
  el('audioGuidePlaceSelect').onchange=()=>{if(context&&!busy)refresh(context);};
  el('audioGuideFiles').onchange=async event=>{
    const ctx=context, files=Array.from(event.target.files||[]);event.target.value='';
    if(!ctx||busy||!files.length||!current(ctx))return;
    const place=selected(ctx);controls(true);status('선택한 장소에 음성을 저장하는 중…');
    let saved=0;const errors=[];
    try{
      for(const file of files){
        if(!current(ctx))break;
        try{await store.add(ctx.scope,place.key,file);saved++;}
        catch(error){errors.push(`${file.name}: ${message(error)}`);}
      }
      if(!current(ctx))return;
      await refresh(ctx);
      if(current(ctx))status([saved?`${saved}개의 음성을 연결했어요.`:'',...errors].filter(Boolean).join(' '),errors.length>0);
    }finally{if(current(ctx))controls(false);}
  };
  // Escape/backdrop closing also releases Blob URLs and stops audio.
  new MutationObserver(()=>{if(context&&!bg.classList.contains('show'))close();}).observe(bg,{attributes:true,attributeFilter:['class']});
  root.addEventListener('pagehide',close);
  root.TC_AUDIO_UI={open,close,check:()=>{if(context)current(context);}};
})(window);
