import { describe, it, expect } from 'vitest';
import { createHandlers, type Gateway, type TripRow } from '../handlers';
import { buildStayExtension, applyStayExtension } from '../../domain/stayExtension';

const now = new Date('2026-10-15T00:30:00Z'); // Seoul 09:30
function setup(role = 'OWNER') {
  let row: TripRow = { client_id:'trip',revision:2,updated_at:now.toISOString(),deleted_at:null,role,data:{
    id:'trip',name:'테스트',start:'2026-10-15',timeZone:'Asia/Seoul',days:[{startAt:'09:00',spots:[
      {name:'카페',stayMin:60,lat:37,lng:127},{name:'예약',stayMin:60,lat:37,lng:127,bookAt:'14:00'}
    ]}]
  }};
  let writes=0;
  const gateway: Gateway = {
    async getTrip(){return row;}, async listTrips(){return [row];},
    async saveTrip(_id,data,revision){
      if (revision!==row.revision) return {applied:false,conflict:true,revision:row.revision,data:null};
      row={...row,data,revision:revision+1}; writes++;
      return {applied:true,conflict:false,revision:row.revision,data};
    },
    async listDismissed(){return [];},async listAccepted(){return [];},async recordFeedback(){},
    async listPriceObservations(){return [];},async savePriceObservation(){},
    async listSentNotificationKeys(){return [];},async recordNotifications(){},async saveDevice(){},
    async listMemories(){return [];},async saveMemory(){throw new Error('unused');},async removeDevice(){}
  };
  return {handlers:createHandlers({gatewayFor:token=>token==='ok'?gateway:null,now:()=>now}),get row(){return row;},get writes(){return writes;}};
}
const request=(body: unknown,token='ok')=>new Request('https://example.test/api/v1/trips/trip/stay-extension',{
  method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)
});
const body={expectedRevision:2,activityId:'d0s0',extraMinutes:30};

describe('stay extension API',()=>{
  it('preview is read-only, apply is CAS, a lost-response retry never extends twice',async()=>{
    const s=setup();
    const response=await s.handlers.stayExtension(request(body),'trip','preview');
    expect(response.status).toBe(200);
    const preview=await response.json();
    expect(preview.newDepartureMinutes).toBe(630);expect(s.writes).toBe(0);
    const applied=await s.handlers.stayExtension(request({...body,previewKey:preview.previewKey}),'trip','apply');
    expect(applied.status).toBe(200);expect(s.writes).toBe(1);
    expect(s.row.data.days?.[0].spots?.[0].stayMin).toBe(90);
    expect((await s.handlers.stayExtension(request({...body,previewKey:preview.previewKey}),'trip','apply')).status).toBe(409);
    expect(s.writes).toBe(1);
  });
  it('requires auth, edit role, revision, allowed duration and the exact preview',async()=>{
    expect((await setup().handlers.stayExtension(request(body,'bad'),'trip','preview')).status).toBe(401);
    expect((await setup('VIEWER').handlers.stayExtension(request(body),'trip','preview')).status).toBe(403);
    for(const invalid of [{...body,expectedRevision:undefined},{...body,extraMinutes:31},{...body,activityId:'d9s1'}])
      expect((await setup().handlers.stayExtension(request(invalid),'trip','apply')).status).toBe(400 + (invalid.activityId==='d9s1'?4:0));
    expect((await setup().handlers.stayExtension(request({...body,previewKey:'forged'}),'trip','apply')).status).toBe(409);
  });
  it('clones unknown document fields and never writes during computation',()=>{
    const s=setup(); const document={...s.row.data,future:{keep:true}};
    const preview=buildStayExtension({tripId:'trip',trip:document,revision:2,updatedAt:'',todayISO:'2026-10-15',nowMinutes:570},'d0s0',10)!;
    const next=applyStayExtension(document,preview);
    expect(next).toHaveProperty('future.keep',true);
    expect(document.days?.[0].spots?.[0].stayMin).toBe(60);
  });
});
