import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../src/worker.js';
import {normalizePhone} from '../src/phone-server.js';
import {environment,req} from './server-fixture.mjs';
const sid='VE'+'a'.repeat(32),phone='+8613800138000';
function smsEnvironment(){const result=environment();Object.assign(result.env,{SMS_PROVIDER:'twilio-verify',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_VERIFY_SERVICE_SID:'VA'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'test-sms-secret'});return result;}
function provider(url,init){assert.ok(url.startsWith('https://verify.twilio.com/v2/Services/VA'));assert.match(init.headers.Authorization,/^Basic /);const body=new URLSearchParams(init.body);if(url.endsWith('/Verifications')){assert.equal(body.get('To'),phone);assert.equal(body.get('Channel'),'sms');return Promise.resolve(Response.json({status:'pending',sid,to:phone}));}assert.equal(body.get('VerificationSid'),sid);return Promise.resolve(Response.json({status:body.get('Code')==='123456'?'approved':'pending',sid,to:phone}));}
async function send(env){const response=await handle(req('/api/account/phone/send',{phone:'13800138000'}),provider,env);assert.equal(response.status,200);return (await response.json()).challengeId;}
const verify=(env,id,code='123456',upstream=provider)=>handle(req('/api/account/login/phone',{challengeId:id,code}),upstream,env);
test('SMS is unavailable without configuration; no fake login or accounts are created',async()=>{
 const {env,sql}=environment();let called=false;const upstream=()=>{called=true;throw Error();};
 for(const path of ['/api/account/phone/send','/api/account/login/phone'])assert.equal((await handle(req(path,{phone,code:'123456',challengeId:crypto.randomUUID()}),upstream,env)).status,503);
 assert.equal(called,false);assert.equal(sql.prepare('SELECT count(*) AS n FROM accounts').get().n,0);
 assert.equal(normalizePhone('138 0013 8000'),phone);assert.equal(normalizePhone('+44 7700 900123'),'+447700900123');assert.throws(()=>normalizePhone('nonsense'));
});
test('verified phone registers one account, persists membership and creates a secure revocable session',async()=>{
 const {env,sql}=smsEnvironment(),id=await send(env);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM accounts').get().n,0);
 const response=await verify(env,id);assert.equal(response.status,200);const cookie=response.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 const data=await response.json();assert.equal(data.user.membership.tier,'none');assert.ok(!JSON.stringify(data).includes(phone));
 assert.equal(sql.prepare('SELECT phone_e164 FROM accounts').get().phone_e164,phone);
 assert.equal((await verify(env,id)).status,400);
 assert.equal((await (await handle(req('/api/account',undefined,cookie),provider,env)).json()).user.id,data.user.id);
 // Simulate another SMS challenge to the same verified identity after resend cooldown.
 sql.exec('DELETE FROM usage_buckets');const next=await send(env);const again=await (await verify(env,next)).json();assert.equal(again.user.id,data.user.id);assert.equal(sql.prepare('SELECT count(*) AS n FROM accounts').get().n,1);
 await handle(req('/api/account/logout',{},cookie),provider,env);assert.equal((await (await handle(req('/api/account',undefined,cookie),provider,env)).json()).user,null);
});
test('wrong, expired, mismatched and over-attempted verifications cannot create accounts',async()=>{
 const {env,sql}=smsEnvironment(),id=await send(env);
 for(let n=0;n<5;n++)assert.equal((await verify(env,id,'000000')).status,400);
 assert.equal((await verify(env,id)).status,400);
 sql.exec('DELETE FROM usage_buckets');const expired=await send(env);sql.exec('UPDATE phone_challenges SET expires_at=0');assert.equal((await verify(env,expired)).status,400);
 sql.exec('DELETE FROM usage_buckets');const mismatch=await send(env);assert.equal((await verify(env,mismatch,'123456',async()=>Response.json({status:'approved',sid,to:'+8613900139000'}))).status,400);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM accounts').get().n,0);
});
test('SMS rate limits and cross-origin protection run before provider calls, and errors hide secrets',async()=>{
 const {env}=smsEnvironment();await send(env);let calls=0;const upstream=async()=>{calls++;return Response.json({error:env.TWILIO_AUTH_TOKEN},{status:401});};
 assert.equal((await handle(req('/api/account/phone/send',{phone}),upstream,env)).status,429);assert.equal(calls,0);
 assert.equal((await handle(req('/api/account/phone/send',{phone},'',{Origin:'https://evil.test'}),upstream,env)).status,403);assert.equal(calls,0);
 const error=await handle(req('/api/account/phone/send',{phone:'+8613900139000'}),upstream,env);assert.equal(error.status,503);assert.ok(!(await error.text()).includes(env.TWILIO_AUTH_TOKEN));
});
