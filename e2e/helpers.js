async function prepare(context){
  await context.addInitScript(()=>{
    window.LZString={compressToEncodedURIComponent:x=>encodeURIComponent(x),decompressFromEncodedURIComponent:x=>decodeURIComponent(x)};
    window.Sortable={create:()=>({destroy(){}})};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}});
  });
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    const type=route.request().resourceType();
    return route.fulfill({status:200,contentType:type==='script'?'text/javascript':'application/json',body:type==='script'?'':'{}'});
  });
}

async function createTrip(page,name){
  await page.evaluate(value=>{window.prompt=()=>value;window.confirm=()=>true;},name);
  await page.locator('#newTripBtn').click({force:true});
  await page.locator('#tripName').fill(name);
  await page.locator('#tripTimeZone').fill('Asia/Seoul');
  await page.locator('#tripSave').click();
}

module.exports={prepare,createTrip};
