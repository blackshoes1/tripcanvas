'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const copy=require('../j-copy');
const adapt=require('../adaptive');
const {build}=require('../scripts/j-copy');
const source=JSON.parse(fs.readFileSync('copy/j-source.json','utf8'));
const guides=JSON.parse(fs.readFileSync('copy/j-tones.json','utf8'));
const variants=JSON.parse(fs.readFileSync('copy/j-variants.json','utf8'));

test('원본/가이드 변경은 재생성을 요구하고 변수 누락은 실패한다',()=>{
  assert.equal(build(source,guides,variants).pending.length,0);
  const changed=structuredClone(source);
  changed['pulse.noPlan'].text+='.';
  assert.deepEqual(build(changed,guides,variants).pending.map(r=>r.key),['pulse.noPlan']);
  assert.equal(build(source,{...guides,CASUAL:{...guides.CASUAL,label:'친구'}},variants).pending.length,Object.keys(source).length);
  const broken=structuredClone(variants);
  broken['departure.slack'].CASUAL='지금 출발하면 여유가 있어';
  assert.match(build(source,guides,broken).errors.join('\n'),/departure.slack/);
});

test('변수의 장소명·중괄호·치환 문자는 원문 그대로 들어간다',()=>{
  const place='카페 {minutes} $& <script>';
  assert.equal(copy.text('pulse.next',{place},'CASUAL'),place+'까지 이어가면 돼.');
  assert.throws(()=>copy.text('departure.slack',{},'CASUAL'),/Missing J copy parameter/);
  assert.equal(copy.text('pulse.noPlan',{},'unknown'),copy.text('pulse.noPlan'));
});

test('말투는 제안 ID·수락 동작·순위·알림 중복 키를 바꾸지 않는다',()=>{
  const trip={id:'t',start:'2026-10-05',days:[{startAt:'09:00',spots:[
    {name:'카페',lat:37.5,lng:127,stayMin:90},
    {name:'예약 식당',lat:37.5,lng:127,bookAt:'10:00',stayMin:60}
  ]},{spots:[]}]};
  const outcomes=copy.choices.map(({id})=>{
    const state=adapt.buildTripState(trip,{todayISO:'2026-10-05',nowMin:540,jTone:id});
    const result=adapt.buildSuggestions(trip,state);
    const departure=adapt.departurePlan(state,state.nextItem,0);
    const notifications=adapt.notificationPlan(state,{departure,replan:result.replan,suggestions:result.suggestions,travelMode:true});
    return {result,identities:{suggestions:result.suggestions.map(s=>({id:s.id,key:s.key,action:s.action,impact:s.impact})),
      rank:result.ranked.map(r=>({id:r.id,score:r.score,arriveMin:r.arriveMin})),replan:result.replan,
      notifications:notifications.map(n=>({dedupeKey:n.dedupeKey,priority:n.priority,kind:n.kind}))}};
  });
  assert.ok(outcomes[0].result.suggestions.length);
  assert.notEqual(outcomes[0].result.suggestions[0].title,outcomes[1].result.suggestions[0].title);
  assert.deepEqual(outcomes[0].identities,outcomes[1].identities);
  assert.deepEqual(outcomes[0].identities,outcomes[2].identities);
});

test('조사는 말투와 별개로 이름에 맞춘다',()=>{
  for(const name of ['북촌','카페','Dinner']) for(const {id} of copy.choices){
    const note=adapt.replanDropNote([name],true,id);
    assert.ok(note.startsWith(name+adapt.josa(name,'은','는')));
  }
});
