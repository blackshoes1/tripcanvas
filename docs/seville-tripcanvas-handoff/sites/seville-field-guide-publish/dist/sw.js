const CACHE='our-seville-guide-v1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type!=='CACHE_GUIDE')return;
 event.waitUntil((async()=>{try{const response=await fetch('cache-files.json',{cache:'no-store'});if(!response.ok)throw new Error('manifest');const paths=await response.json();const cache=await caches.open(CACHE);for(const path of paths){const res=await fetch(new URL(path,self.registration.scope),{cache:'reload',credentials:'same-origin'});if(!res.ok||new URL(res.url).origin!==self.location.origin)throw new Error('asset');await cache.put(new URL(path,self.registration.scope),res);}await cache.put(new URL('offline-ready.json',self.registration.scope),new Response(JSON.stringify({ready:true,cache:CACHE}),{headers:{'Content-Type':'application/json'}}));event.ports[0]?.postMessage({ok:true});}catch{event.ports[0]?.postMessage({ok:false});}})());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin)return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);if(request.mode==='navigate'){try{const network=await fetch(request);if(network.ok&&new URL(network.url).origin===self.location.origin)return network;}catch{}return await cache.match(new URL('index.html',self.registration.scope))||Response.error();}return await cache.match(request)||fetch(request);})());
});
