import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LANGUAGES,language} from '../src/languages.js';
import {localApi} from '../src/local-api.js';
import {getSession,saveSession} from '../src/storage.js';
import {handle} from '../src/worker.js';
import {translateSegment,exportMarkdown} from '../src/core.js';
import {BrowserLive} from '../src/live.js';
const create=code=>localApi('/api/sessions',{method:'POST',body:JSON.stringify({title:'语言测试',sourceLanguage:code})});
const patch=(id,code)=>localApi('/api/sessions/'+id,{method:'PATCH',body:JSON.stringify({sourceLanguage:code})});
test('all language choices reach transcription; automatic detection removes the hint',async()=>{
 for(const {code} of LANGUAGES){
  let payload;
  const response=await handle(new Request('https://example.test/api/openai/token',{method:'POST',headers:{Authorization:'Bearer sk-simulated-only-not-a-real-key','Content-Type':'application/json'},body:JSON.stringify({sourceLanguage:code})}),async(url,init)=>{payload=JSON.parse(init.body);return Response.json({value:'temporary'});});
  assert.equal(response.status,200);
  const transcription=payload.session.audio.input.transcription;
  assert.deepEqual(transcription.languages,code==='auto'?undefined:[code]);
 }
 const invalid=await handle(new Request('https://example.test/api/openai/token',{method:'POST',headers:{Authorization:'Bearer sk-simulated-only-not-a-real-key','Content-Type':'application/json'},body:JSON.stringify({sourceLanguage:'invalid'})}),()=>{throw new Error('Must not call upstream');});
 assert.equal(invalid.status,400);
});
test('new choices persist while existing English records retain their original language',async()=>{
 assert.equal((await create()).sourceLanguage,'auto');
 const s=await create('en');delete s.sourceLanguage;
 s.segments=[{id:'old',source:'Original English',translation:'原有译文',offset:0}];await saveSession(s);
 assert.equal(language((await getSession(s.id)).sourceLanguage).code,'en');
 await patch(s.id,'ja');const saved=await getSession(s.id);
 assert.equal(saved.sourceLanguage,'ja');assert.equal(saved.segments[0].sourceLanguage,'en');
 assert.match(exportMarkdown(saved),/英语 → 中文/);
 await assert.rejects(()=>patch(s.id,'invalid'),/支持的语言/);
 assert.equal((await getSession(s.id)).sourceLanguage,'ja');
});
test('translation uses the selected language and always requests Simplified Chinese',async()=>{
 const s=await create('ja');let instructions,input;
 const result=await translateSegment(s,'mock','機会費用','',async(k,i,t)=>{instructions=i;input=t;return '机会成本';});
 assert.equal(result.translation,'机会成本');assert.match(input,/日语/);assert.match(instructions,/中文输入保持简体中文/);
 assert.match(exportMarkdown(s),/日语 → 中文/);
});
test('paused language changes wait for upstream acknowledgement and preserve in-flight segment language',async()=>{
 const live=new BrowserLive(),sent=[],events=[];
 live.session=await create('en');live.connectedAt=Date.now();live.appliedLanguage='en';
 live.upstream={readyState:1,send:data=>sent.push(JSON.parse(data)),close(){}};
 live.onmessage=e=>events.push(JSON.parse(e.data));live.meta=[{sourceLanguage:'en',offset:0}];
 try{
  live.paused=false;await assert.rejects(()=>live.changeLanguage('ja'),/先暂停/);
  live.paused=true;await live.changeLanguage('ja');
  await live.handle({type:'input_audio_buffer.committed',item_id:'previous'});
  assert.equal(live.session.segments[0].sourceLanguage,'en');
  await live.command({type:'resume'});
  assert.equal(live.paused,true);assert.equal(live.appliedLanguage,'en');
  assert.deepEqual(sent.at(-1).session.audio.input.transcription.languages,['ja']);
  await live.handle({type:'session.updated'});assert.equal(live.paused,false);assert.equal(live.appliedLanguage,'ja');
  await live.command({type:'pause'});await live.changeLanguage('auto');await live.command({type:'resume'});
  assert.deepEqual(sent.at(-1).session.audio.input.transcription.languages,[]);
  assert.equal(live.paused,true);await live.handle({type:'session.updated'});
  assert.equal((await getSession(live.session.id)).sourceLanguage,'auto');
  assert.equal(events.filter(e=>e.type==='ready').length,2);
 }finally{live.close();}
});
