import test from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {handle} from '../src/worker.js';
import {hashPassword,verifyPassword} from '../src/password-server.js';
import {environment,req} from './server-fixture.mjs';
const password='A long test password 123!',noExternal=()=>{throw Error('External calls forbidden');};
const call=(env,path,body,cookie='')=>handle(req(path,body,cookie),noExternal,env);
async function register(env,username='testuser'){const r=await call(env,'/api/account/register/password',{username,password});assert.equal(r.status,200);return {user:(await r.json()).user,cookie:r.headers.get('Set-Cookie')};}
test('scrypt hashes use random salts, match independent crypto and reject wrong passwords',async()=>{
 const a=await hashPassword(password),b=await hashPassword(password);assert.notEqual(a,b);assert.ok(!a.includes(password));const [,salt,hash]=a.split('$');assert.equal(scryptSync(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex'),hash);assert.equal(await verifyPassword(password,a),true);assert.equal(await verifyPassword('wrong password',a),false);
});
test('registration persists one account and no plaintext; login restores same account, membership and history',async()=>{
 const {env,sql}=environment();env.BUCKET={};const a=await register(env,' TestUser ');assert.equal(a.user.label,'testuser');assert.equal(a.user.membership.tier,'none');assert.match(a.cookie,/HttpOnly; Secure; SameSite=Strict/);
 const stored=sql.prepare('SELECT * FROM account_passwords').get();assert.equal(stored.username,'testuser');assert.ok(!JSON.stringify(stored).includes(password));assert.equal(stored.account_id,a.user.id);
 const duplicate=await call(env,'/api/account/register/password',{username:'TESTUSER',password:'Another long password'});assert.equal(duplicate.status,409);assert.equal(sql.prepare('SELECT count(*) AS n FROM accounts').get().n,1);
 await call(env,'/api/member/login',{code:'test-member-code'},a.cookie);
 const id=crypto.randomUUID();sql.prepare('INSERT INTO account_classes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(a.user.id,id,'保存的课堂','2026-10-06','completed',2,0,'test',1);
 await call(env,'/api/account/logout',{},a.cookie);assert.equal((await (await call(env,'/api/account',undefined,a.cookie)).json()).user,null);
 const r=await call(env,'/api/account/login/password',{username:'TESTUSER',password});assert.equal(r.status,200);const data=await r.json();assert.equal(data.user.id,a.user.id);assert.equal(data.user.membership.tier,'regular');assert.ok(!JSON.stringify(data).includes(stored.password_hash));
 const cookie=r.headers.get('Set-Cookie');const history=await (await call(env,'/api/history',undefined,cookie)).json();assert.equal(history[0].title,'保存的课堂');
 const b=await register(env,'differentuser');assert.equal((await (await call(env,'/api/history',undefined,b.cookie)).json()).length,0);
});
test('wrong credentials, missing users, forged cookies and cross-origin requests never authenticate',async()=>{
 const {env}=environment();await register(env);
 for(const body of [{username:'testuser',password:'wrong password'},{username:'missinguser',password}]){const r=await call(env,'/api/account/login/password',body);assert.equal(r.status,401);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal((await r.json()).error.message,'账号或密码不正确。');}
 assert.equal((await handle(req('/api/account/register/password',{username:'eviluser',password},'',{Origin:'https://evil.test'}),noExternal,env)).status,403);
 assert.equal((await (await call(env,'/api/account',undefined,'__Host-classroom_account='+'a'.repeat(64))).json()).user,null);
});
test('invalid inputs and throttled requests do not create accounts or password records',async()=>{
 const {env,sql}=environment();for(const body of [{username:'abc',password},{username:'<script>',password},{username:'normal',password:'short'},{username:'normal',password:'x'.repeat(129)}])assert.equal((await call(env,'/api/account/register/password',body)).status,400);
 await register(env);for(let i=0;i<10;i++)await call(env,'/api/account/register/password',{username:'testuser',password});assert.equal((await call(env,'/api/account/login/password',{username:'testuser',password})).status,429);assert.equal(sql.prepare('SELECT count(*) AS n FROM account_passwords').get().n,1);
});
