const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../trip-files');
const api=require('../api');
test('공유 파일은 음성과 문서의 형식 및 크기를 읽기 전에 검증한다',()=>{
  assert.doesNotThrow(()=>validate({name:'guide.m4a',size:25*1024*1024},'AUDIO'));
  assert.doesNotThrow(()=>validate({name:'ticket.PDF',size:10*1024*1024},'DOCUMENT'));
  assert.throws(()=>validate({name:'guide.mp3',size:25*1024*1024+1},'AUDIO'),/25MB/);
  assert.throws(()=>validate({name:'ticket.pdf',size:10*1024*1024+1},'DOCUMENT'),/10MB/);
  assert.throws(()=>validate({name:'ticket.html',size:100},'DOCUMENT'),/형식/);
  assert.throws(()=>validate({name:'ticket.pdf',size:0},'DOCUMENT'),/비어/);
});
test('공유 업로드는 원본 바이트와 계정 토큰을 보내고 토큰을 URL에 싣지 않는다',async()=>{
  const bytes=Buffer.from('%PDF-ticket');let sent;
  api.configure({baseUrl:'https://files.test',getToken:async()=> 'private-token',fetchImpl:async(url,options)=>{
    sent={url,options};return new Response(JSON.stringify({file:{id:'saved'}}));
  }});
  const response=await api.files.upload('trip/a',new File([bytes],'ticket.pdf'),{kind:'DOCUMENT',name:'ticket.pdf',placeKey:''});
  assert.equal(response.error,null);
  assert.deepEqual(Buffer.from(sent.options.body),bytes);
  assert.equal(sent.options.headers.authorization,'Bearer private-token');
  assert.ok(!sent.url.includes('private-token'));
});
test('파일을 읽는 동안 계정이 바뀌면 전송을 시작하지 않는다',async()=>{
  let token='first',sent=false;
  api.configure({getToken:async()=>token,fetchImpl:async()=>{sent=true;return new Response('{}');}});
  const response=await api.files.upload('trip',{arrayBuffer:async()=>{token='second';return new ArrayBuffer(2);}},{kind:'DOCUMENT',name:'ticket.pdf'});
  assert.equal(sent,false);assert.equal(response.error.status,401);
});
