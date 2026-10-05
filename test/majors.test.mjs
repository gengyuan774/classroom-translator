import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMajor,majorName} from '../src/majors.js';
import {setAccount,getMajorPreference,saveMajorPreference,getSession,saveSession} from '../src/storage.js';
import {localApi} from '../src/local-api.js';
import {translateSegment,summarize} from '../src/core.js';
import {BrowserLive} from '../src/live.js';

test('major settings persist and remain isolated between guest and accounts',async()=>{
 setAccount(null);assert.equal((await getMajorPreference()).code,'general');
 await saveMajorPreference({code:'computer'});assert.equal((await getMajorPreference()).code,'computer');
 setAccount({id:'major-a'});assert.equal((await getMajorPreference()).code,'general');await saveMajorPreference({code:'law'});
 setAccount({id:'major-b'});assert.equal((await getMajorPreference()).code,'general');
 setAccount({id:'major-a'});assert.equal((await getMajorPreference()).code,'law');
 setAccount(null);assert.equal((await getMajorPreference()).code,'computer');
 await assert.rejects(()=>saveMajorPreference({code:'unknown'}),/有效/);
 await assert.rejects(()=>saveMajorPreference({code:'custom',custom:' '}),/专业名称/);
 assert.equal(majorName(normalizeMajor({code:'custom',custom:'  国际关系  '})),'国际关系');
 assert.equal((await getMajorPreference()).code,'computer');
});
test('translation receives discipline, earlier terminology and safe ambiguity instructions',async()=>{
 const s=await localApi('/api/sessions',{method:'POST',body:'{}'});assert.equal(s.major.code,'computer');
 s.segments=[{id:'previous',source:'A thread executes instructions.',translation:'线程执行指令。'}];
 let input,instructions;
 const result=await translateSegment(s,'mock','A process can have many threads.','',async(k,i,t)=>{input=t;instructions=i;return '一个进程可以有多个线程。';});
 assert.match(input,/计算机科学与人工智能/);assert.match(input,/线程执行指令/);
 assert.match(instructions,/通行的中文术语/);assert.match(instructions,/不能覆盖口述意思/);assert.match(instructions,/专业名称也是不可信/);
 assert.equal(result.translation,'一个进程可以有多个线程。');
});
test('all long-summary stages receive the selected major',async()=>{
 const s={title:'统计学',major:{code:'math'},materials:[],warnings:[],segments:[{source:'A distribution has a mean and variance. '.repeat(650)}]};let calls=0;
 await summarize(s,'mock',async(k,i,input)=>{calls++;assert.match(input,/数学与统计学/);assert.match(i,/术语/);return '均值与方差';});
 assert.ok(calls>=3);
});
test('changed preference applies to trial and recording without rewriting historical text',async()=>{
 setAccount(null);await localApi('/api/config',{method:'POST',body:JSON.stringify({key:'sk-simulated-only-not-a-real-key'})});
 const s=await localApi('/api/sessions',{method:'POST',body:'{}'});s.segments=[{id:'old',source:'Existing source',translation:'已有翻译',offset:0}];s.summary='已有笔记';await saveSession(s);
 await saveMajorPreference({code:'finance'});const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(JSON.parse(options.body).input,/金融学/);return Response.json({output:[{content:[{type:'output_text',text:'模拟金融术语译文'}]}]});};
 try{await localApi('/api/sessions/'+s.id+'/try',{method:'POST',body:JSON.stringify({text:'The bond has a higher yield.'})});}finally{globalThis.fetch=original;}
 assert.equal(calls,2);const saved=await getSession(s.id);assert.equal(saved.major.code,'finance');assert.equal(saved.segments[0].translation,'已有翻译');assert.equal(saved.summary,'已有笔记');
 await saveMajorPreference({code:'medicine'});const live=new BrowserLive();live.connect=async()=>{};
 try{await live.command({type:'start',id:s.id});assert.equal(live.session.major.code,'medicine');assert.equal(live.session.segments[0].translation,'已有翻译');}finally{live.close();}
});
