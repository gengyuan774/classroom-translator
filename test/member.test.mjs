import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle} from '../src/worker.js';
import {consume} from '../src/member.js';

function environment(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_small_gwen_stacy.sql',import.meta.url),'utf8'));
 const DB={
  prepare(query){return {bind(...args){const statement=sql.prepare(query);return {async first(){return statement.get(...args)||null;},async run(){return statement.run(...args);}};}};},
  async batch(items){for(const item of items)await item.run();}
 };
 return {sql,env:{DB,MEMBER_CODE:'test-member-code',MEMBER_SESSION_SECRET:'test-signing-secret',OPENAI_API_KEY:'sk-test-server-only-secret',MEMBER_DAILY_TEXT_LIMIT:'2'}};
}
function req(path,body,cookie='',headers={}){return new Request('https://example.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://example.test',Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});}
const mock=async()=>Response.json({output:[{content:[{type:'output_text',text:'测试译文'}]}]});
async function login(env){const res=await handle(req('/api/member/login',{code:'test-member-code'}),mock,env);assert.equal(res.status,200);const cookie=res.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);return cookie.split(';')[0];}
test('shared API requires a valid server session; client headers cannot unlock it',async()=>{
 const {env}=environment();const body={input:'hello',instructions:'translate'};
 for(const cookie of ['', '__Host-classroom_member=forged']){assert.equal((await handle(req('/api/openai/responses',body,cookie,{'X-Access-Mode':'member'}),mock,env)).status,401);}
 assert.equal((await handle(req('/api/member/login',{code:'wrong'}),mock,env)).status,401);
 const cross=await handle(req('/api/member/login',{code:'test-member-code'},'',{Origin:'https://evil.test'}),mock,env);assert.equal(cross.status,403);
});
test('member routes use the server key without returning it; personal keys still work',async()=>{
 const {env}=environment();const cookie=await login(env);let authorization;
 const upstream=async(url,init)=>{authorization=init.headers.Authorization;return mock();};
 const res=await handle(req('/api/openai/responses',{input:'hello',instructions:'translate'},cookie,{'X-Access-Mode':'member'}),upstream,env);
 assert.equal(res.status,200);assert.equal(authorization,'Bearer '+env.OPENAI_API_KEY);assert.ok(!(await res.text()).includes(env.OPENAI_API_KEY));
 const personal=await handle(req('/api/openai/responses',{input:'hello',instructions:'translate'},'',{Authorization:'Bearer sk-personal-test-key'}),upstream,env);assert.equal(personal.status,200);assert.equal(authorization,'Bearer sk-personal-test-key');
 const failed=await handle(req('/api/openai/responses',{input:'hello',instructions:'translate'},cookie,{'X-Access-Mode':'member'}),async()=>Response.json({error:{message:env.OPENAI_API_KEY}},{status:401}),env);assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes(env.OPENAI_API_KEY));
});
test('logout, expiration and password rotation revoke access',async()=>{
 const {env,sql}=environment();const status=cookie=>handle(req('/api/member/status',undefined,cookie),mock,env).then(r=>r.json());
 const cookie=await login(env);assert.equal((await status(cookie)).member,true);
 env.MEMBER_CODE='rotated';assert.equal((await status(cookie)).member,false);env.MEMBER_CODE='test-member-code';
 await handle(req('/api/member/logout',{},cookie),mock,env);assert.equal((await status(cookie)).member,false);
 const next=await login(env);sql.exec('UPDATE member_sessions SET expires_at=0');assert.equal((await status(next)).member,false);
});
test('missing shared key is reported honestly and never falls back to an unauthenticated call',async()=>{
 const {env}=environment();delete env.OPENAI_API_KEY;const cookie=await login(env);
 const status=await handle(req('/api/member/status',undefined,cookie),mock,env);assert.deepEqual(await status.json(),{member:true,sharedReady:false});
 let called=false;const response=await handle(req('/api/openai/token',{title:'课堂'},cookie,{'X-Access-Mode':'member'}),async()=>{called=true;return mock();},env);assert.equal(response.status,503);assert.equal(called,false);
});
test('durable counters bound requests across sessions and limit password attempts',async()=>{
 const {env}=environment();const cookie=await login(env),second=await login(env);
 const run=c=>handle(req('/api/openai/responses',{input:'hello',instructions:'translate'},c,{'X-Access-Mode':'member'}),mock,env);
 assert.equal((await run(cookie)).status,200);assert.equal((await run(second)).status,200);assert.equal((await run(cookie)).status,429);
 const results=await Promise.allSettled(Array.from({length:12},()=>consume(env,'parallel-test',3,60)));assert.equal(results.filter(x=>x.status==='fulfilled').length,3);
 let last;for(let i=0;i<16;i++)last=await handle(req('/api/member/login',{code:'wrong'}),mock,env);assert.equal(last.status,429);
});
