async function prepare(context,options={}){
  await context.addInitScript(({onboarded})=>{
    if(onboarded) localStorage.setItem('tripcanvas_onboarded_v1','1');
    window.LZString={compressToEncodedURIComponent:x=>encodeURIComponent(x),decompressFromEncodedURIComponent:x=>decodeURIComponent(x)};
    window.Sortable={create:()=>({destroy(){}})};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}});
  },{onboarded:options.onboarded!==false});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    const type=route.request().resourceType();
    return route.fulfill({status:200,contentType:type==='script'?'text/javascript':'application/json',body:type==='script'?'':'{}'});
  });
}

async function createTrip(page,name){
  await page.evaluate(value=>{window.prompt=()=>value;window.confirm=()=>true;},name);
  await clickMore(page,'#newTripBtn');
  await page.locator('#tripName').fill(name);
  await page.locator('#tripTimeZone').fill('Asia/Seoul');
  await page.locator('#tripSave').click();
}

async function clickMore(page,selector){
  if(!await page.locator('#hdrMenu').evaluate(el=>el.classList.contains('open'))) await page.locator('#moreBtn').click();
  await page.locator(selector).click();
}

module.exports={prepare,createTrip,clickMore};
