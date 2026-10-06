import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../src/worker.js';
import {consume} from '../src/member.js';
import {createVerifiedAccountSession} from '../src/account-server.js';
import {environment,req} from './server-fixture.mjs';
const mock=async()=>Response.json({output:[{content:[{type:'output_text',text:'测试译文'}]}]});
async function account(env,subject='13800138000'){const result=await createVerifiedAccountSession(env,{provider:'phone',subject:'+86'+subject,label:'测试用户'});return result.cookie.split(';')[0];}
async function login(env){const cookie=await account(env);const res=await handle(req('/api/member/login',{code:'test-member-code'},cookie),mock,env);assert.equal(res.status,200);return cookie;}
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
test('account logout and membership expiration revoke access, while repeated redemption never extends it',async()=>{
 const {env,sql}=environment();const status=cookie=>handle(req('/api/member/status',undefined,cookie),mock,env).then(r=>r.json());
 const cookie=await login(env);assert.equal((await status(cookie)).member,true);
 const first=sql.prepare('SELECT expires_at FROM account_memberships').get().expires_at;
 await login(env);assert.equal(sql.prepare('SELECT expires_at FROM account_memberships').get().expires_at,first);
 await handle(req('/api/account/logout',{},cookie),mock,env);assert.equal((await status(cookie)).member,false);
 const next=await login(env);sql.exec('UPDATE account_memberships SET expires_at=0; UPDATE member_redemptions SET expires_at=0');assert.equal((await status(next)).member,false);
 assert.equal((await handle(req('/api/member/login',{code:'test-member-code'},next),mock,env)).status,409);
});
test('redemption is account-owned and does not downgrade premium membership',async()=>{
 const {env,sql}=environment(),cookie=await account(env),other=await account(env,'13900139000');
 assert.equal((await handle(req('/api/member/login',{code:'wrong'},cookie),mock,env)).status,401);
 await handle(req('/api/member/login',{code:'test-member-code',tier:'premium',expiresAt:9999999999999},cookie),mock,env);
 assert.equal(sql.prepare('SELECT tier FROM account_memberships WHERE tier != ?').get('none').tier,'regular');
 assert.equal((await (await handle(req('/api/member/status',undefined,other),mock,env)).json()).member,false);
 sql.prepare("UPDATE account_memberships SET tier='premium', expires_at=? WHERE tier='regular'").run(Date.now()+30*86400000);
 await handle(req('/api/member/login',{code:'test-member-code'},cookie),mock,env);
 assert.equal(sql.prepare("SELECT tier FROM account_memberships WHERE tier='premium'").get().tier,'premium');
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
 let last;for(let i=0;i<16;i++)last=await handle(req('/api/member/login',{code:'wrong'},cookie),mock,env);assert.equal(last.status,429);
});

test('seven day expiry is fixed at first redemption, including configuration rotation and later retries',async t=>{
 const {env,sql}=environment(),cookie=await account(env),now=Date.now();t.mock.method(Date,'now',()=>now);
 const first=await (await handle(req('/api/member/login',{code:'test-member-code'},cookie),mock,env)).json();assert.equal(first.membership.expiresAt,now+7*86400000);
 t.mock.method(Date,'now',()=>now+86400000);env.MEMBER_SESSION_SECRET='rotated-secret';
 const again=await (await handle(req('/api/member/login',{code:'test-member-code'},cookie),mock,env)).json();assert.equal(again.membership.expiresAt,first.membership.expiresAt);assert.equal(sql.prepare('SELECT count(*) AS n FROM member_redemptions').get().n,1);
 t.mock.method(Date,'now',()=>now+7*86400000);
 let called=false;const response=await handle(req('/api/openai/responses',{input:'hello',instructions:'translate'},cookie,{'X-Access-Mode':'member'}),async()=>{called=true;return mock();},env);assert.equal(response.status,401);assert.equal(called,false);
 assert.equal((await handle(req('/api/member/login',{code:'test-member-code'},cookie),mock,env)).status,409);
});
