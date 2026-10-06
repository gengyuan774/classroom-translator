import {MemberError} from './errors.js';
const COOKIE='__Host-classroom_account';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const database=env=>{if(!env.DB)throw new MemberError('账户服务暂不可用，请稍后重试。');return env.DB;};
function token(request){const value=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return /^[a-f0-9]{64}$/.test(value||'')?value:null;}
const sessionCookie=(value,maxAge=30*86400)=>`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export async function accountUser(request,env){
 const value=token(request);if(!value)return null;
 return await database(env).prepare('SELECT a.id, a.provider, a.label FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(await hash(value),Date.now()).first();
}
export async function requireAccount(request,env){const user=await accountUser(request,env);if(!user)throw new MemberError('请先登录个人账户。',401);return user;}
export async function signOutAccount(request,env){const value=token(request);if(value)await database(env).prepare('DELETE FROM account_sessions WHERE token_hash = ?').bind(await hash(value)).run();return sessionCookie('',0);}
// Server-only integration point. Call ONLY after a real provider has verified its identity.
// Phone login invokes this only after SMS provider approval.
export async function createVerifiedAccountSession(env,{provider,subject,label}){
 if(!['phone','email','wechat'].includes(provider)||typeof subject!=='string'||!subject||subject.length>512)throw new MemberError('登录身份无效。',400);
 const subjectHash=await hash(provider+':'+subject);const id=crypto.randomUUID();
 await database(env).prepare('INSERT INTO accounts (id, provider, subject_hash, label, created_at, phone_e164) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider, subject_hash) DO NOTHING').bind(id,provider,subjectHash,String(label||'已登录用户').slice(0,120),Date.now(),provider==='phone'?subject:null).run();
 const user=await database(env).prepare('SELECT id, provider, label FROM accounts WHERE provider = ? AND subject_hash = ?').bind(provider,subjectHash).first();
 const value=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 await database(env).batch([
  database(env).prepare("INSERT INTO account_memberships (account_id, tier, expires_at, updated_at) VALUES (?, 'none', NULL, ?) ON CONFLICT(account_id) DO NOTHING").bind(user.id,Date.now()),
  database(env).prepare('DELETE FROM account_sessions WHERE expires_at <= ?').bind(Date.now()),
  database(env).prepare('INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)').bind(await hash(value),user.id,Date.now()+30*86400000)
 ]);
 return {user,cookie:sessionCookie(value)};
}
