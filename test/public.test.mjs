import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import worker,{handle} from '../src/worker.js';
import {localApi,busy} from '../src/local-api.js';
import {saveSession,getSession,saveMaterial,getMaterial} from '../src/storage.js';
import {extractMaterial} from '../src/material-parser.js';
import {translateSegment,summarize,exportHtml,exportMarkdown} from '../src/core.js';
import {BrowserLive} from '../src/live.js';
const key='sk-simulated-only-not-a-real-key';
const create=()=>localApi('/api/sessions',{method:'POST',body:JSON.stringify({title:'模拟经济学'})});
const request=(path,body={},headers={})=>new Request('https://example.test'+path,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const answer=text=>Response.json({output:[{content:[{type:'output_text',text}]}]});

test('public assets and default Worker use runtime signature correctly',async()=>{
 const home=await worker.fetch(new Request('https://example.test/'),{},{});assert.equal(home.status,200);assert.match(await home.text(),/课堂/);
 const original=globalThis.fetch;globalThis.fetch=async()=>answer('成功');
 try{const r=await worker.fetch(request('/api/openai/responses',{input:'test',instructions:'test'}),{},{});assert.equal(r.status,200);}finally{globalThis.fetch=original;}
});
test('edge enforces caller key, same origin and fixed upstream model',async()=>{
 assert.equal((await handle(request('/api/openai/responses',{}, {Authorization:''}))).status,401);
 assert.equal((await handle(request('/api/openai/responses',{}, {Origin:'https://evil.test'}))).status,403);
 assert.equal((await handle(request('/api/arbitrary'))).status,404);
 let seen;
 const r=await handle(request('/api/openai/responses',{input:'lecture',instructions:'translate',model:'other',store:true,max_output_tokens:99999}),async(url,init)=>{seen={url,p:JSON.parse(init.body)};return answer('译文');});
 assert.equal(r.status,200);assert.equal(seen.url,'https://api.openai.com/v1/responses');assert.equal(seen.p.store,false);assert.equal(seen.p.model,'gpt-4.1-mini');assert.equal(seen.p.max_output_tokens,4000);
});
test('ephemeral credentials only configure transcription',async()=>{
 let payload;await handle(request('/api/openai/token',{title:'Economics',session:{type:'realtime'}}),async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/realtime/client_secrets');payload=JSON.parse(init.body);return Response.json({value:'ephemeral'});});
 assert.equal(payload.session.type,'transcription');assert.equal(payload.expires_after.seconds,600);assert.equal(payload.session.audio.input.format.rate,24000);
});
test('PPTX follows slide order and rejects old PPT or image-only content',async()=>{
 const zip=zipSync({'ppt/presentation.xml':strToU8('<p:presentation><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>'),'ppt/_rels/presentation.xml.rels':strToU8('<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>'),'ppt/slides/slide1.xml':strToU8('<p:sld><a:p><a:r><a:t>Second: trade-off</a:t></a:r></a:p></p:sld>'),'ppt/slides/slide2.xml':strToU8('<p:sld><a:p><a:r><a:t>First: opportunity cost</a:t></a:r></a:p></p:sld>')});
 const result=await extractMaterial(Buffer.from(zip),'lecture.pptx');assert.match(result.pages[0].text,/First/);assert.match(result.pages[1].text,/Second/);
 await assert.rejects(()=>extractMaterial(Buffer.from('x'),'old.ppt'),/PPTX/);await assert.rejects(()=>extractMaterial(Buffer.from(' '),'blank.txt'),/文字/);
});
test('class materials are isolated, reference-aware and escaped in export',async()=>{
 const s=await create(),other=await create(),mid=crypto.randomUUID();
 s.materials=[{id:mid,name:'课程.pptx',pageCount:1,enabled:true,warnings:[]}];s.segments=[{id:'a',offset:0,source:'opportunity cost',translation:'机会成本'}];
 await saveMaterial(s.id,{id:mid,name:'课程.pptx',pages:[{label:'第 1 页',text:'Opportunity cost means the next best alternative.'}]});await saveSession(s);
 await assert.rejects(()=>getMaterial(other.id,mid));
 let input;const translated=await translateSegment(s,key,'opportunity cost','',async(k,i,t)=>{input=t;return '机会成本';});assert.match(input,/next best alternative/);assert.equal(translated.references[0].name,'课程.pptx');
 const summary=await summarize(s,key,async(k,i,t)=>{assert.match(i,/资料补充/);assert.match(t,/课堂口述/);return '模拟总结';});s.summary=summary;s.title='<script>alert(1)</script>';
 assert.match(exportMarkdown(s),/课程.pptx/);assert.doesNotMatch(exportHtml(s),/<script>/);
 await localApi('/api/sessions/'+s.id+'/materials/'+mid,{method:'PATCH',body:JSON.stringify({enabled:false})});
 const disabled=await getSession(s.id);const out=await translateSegment(disabled,key,'opportunity cost','',async()=> '机会成本');assert.equal(out.references.length,0);
 assert.ok(!JSON.stringify(await getSession(s.id)).includes(key));
});
test('trial uses mock responses and never appends to classroom transcript',async()=>{
 await localApi('/api/config',{method:'POST',body:JSON.stringify({key})});const s=await create();const original=globalThis.fetch;
 globalThis.fetch=async()=>answer('模拟测试输出');
 try{const result=await localApi('/api/sessions/'+s.id+'/try',{method:'POST',body:JSON.stringify({text:'Opportunity cost is a trade-off.'})});assert.equal(result.translation,'模拟测试输出');assert.equal(result.summary,'模拟测试输出');assert.equal((await getSession(s.id)).segments.length,0);assert.equal(busy.has(s.id),false);}finally{globalThis.fetch=original;}
});
test('finish waits for final transcript and queued translation before summarizing',async()=>{
 const s=await create(),live=new BrowserLive(),events=[];live.session=s;live.base=0;live.started=Date.now();live.pending=1;live.closing=true;live.onmessage=e=>events.push(JSON.parse(e.data));
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return answer(calls===1?'最终译文':'最终总结');};
 try{await live.finalize();assert.equal(live.finalizing,undefined);await live.handle({type:'input_audio_buffer.committed',item_id:'last'});await live.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'last',transcript:'Final spoken sentence.'});
 for(let i=0;i<100&&!live.closed;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(live.closed,true);const saved=await getSession(s.id);assert.equal(saved.segments[0].translation,'最终译文');assert.equal(saved.summary,'最终总结');assert.equal(saved.status,'completed');assert.equal(events.at(-1).type,'finished');
 }finally{live.close();globalThis.fetch=original;}
});
