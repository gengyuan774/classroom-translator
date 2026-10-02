const COOKIE='__Host-classroom_member';
const WEEK=7*86400;
const encode=new TextEncoder();
export class MemberError extends Error{constructor(message,status=503){super(message);this.status=status;}}
const db=env=>{if(!env.DB)throw new MemberError('会员服务暂不可用，请稍后重试。');return env.DB;};
export const sharedReady=env=>!!(env.OPENAI_API_KEY&&env.MEMBER_CODE&&env.MEMBER_SESSION_SECRET&&env.DB);
const configured=env=>{if(!env.MEMBER_CODE||!env.MEMBER_SESSION_SECRET)throw new MemberError('会员服务尚未配置，请联系管理员。');};
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(await crypto.subtle.digest('SHA-256',encode.encode(value)));
async function signature(env,value){configured(env);const key=await crypto.subtle.importKey('raw',encode.encode(env.MEMBER_SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encode.encode(value)));}
async function matches(a,b){const aa=await hash(a),bb=await hash(b);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa.charCodeAt(i)^bb.charCodeAt(i);return diff===0;}
function cookieToken(request){const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return /^[a-f0-9]{64}$/.test(token||'')?token:null;}
export function cookie(value,maxAge=WEEK){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;}
export async function memberSession(request,env){
 const token=cookieToken(request);if(!token||!env.MEMBER_CODE||!env.MEMBER_SESSION_SECRET)return null;
 const row=await db(env).prepare('SELECT token_hash, code_version, expires_at FROM member_sessions WHERE token_hash = ?').bind(await hash(token)).first();
 return row&&row.expires_at>Date.now()&&row.code_version===await signature(env,env.MEMBER_CODE)?row:null;
}
// SQLite performs the limit check and increment atomically, including across Worker instances.
export async function consume(env,id,limit,periodSeconds,amount=1){
 const now=Date.now(),window=Math.floor(now/(periodSeconds*1000));
 const result=await db(env).prepare('INSERT INTO usage_buckets (id, count, expires_at) SELECT ?, ?, ? WHERE ? <= ? ON CONFLICT(id) DO UPDATE SET count = count + excluded.count WHERE count + excluded.count <= ? RETURNING count').bind(id+':'+window,amount,(window+2)*periodSeconds*1000,amount,limit,limit).first();
 if(!result)throw new MemberError('共享服务已达到使用上限，请稍后重试或使用自己的 API Key。',429);
}
async function clientId(request,env){return signature(env,'ip:'+ (request.headers.get('CF-Connecting-IP')||'unknown'));}
export async function loginMember(request,env,code){
 configured(env);await consume(env,'login:'+await clientId(request,env),15,600);
 if(typeof code!=='string'||code.length>128||!await matches(code.trim(),env.MEMBER_CODE))throw new MemberError('会员码不正确，请重新输入。',401);
 const token=hex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await hash(token);
 await db(env).batch([
  db(env).prepare('DELETE FROM member_sessions WHERE expires_at <= ?').bind(Date.now()),
  db(env).prepare('DELETE FROM usage_buckets WHERE expires_at <= ?').bind(Date.now()),
  db(env).prepare('INSERT INTO member_sessions (token_hash, code_version, expires_at) VALUES (?, ?, ?)').bind(tokenHash,await signature(env,env.MEMBER_CODE),Date.now()+WEEK*1000)
 ]);
 return cookie(token);
}
export async function logoutMember(request,env){const token=cookieToken(request);if(token)await db(env).prepare('DELETE FROM member_sessions WHERE token_hash = ?').bind(await hash(token)).run();return cookie('',0);}
const limit=(env,key,fallback)=>{const n=Number(env[key]);return Number.isSafeInteger(n)&&n>0?n:fallback;};
export async function allowSharedRequest(request,env,kind,characters=0){
 if(!await memberSession(request,env))throw new MemberError('会员登录已失效，请重新输入会员码。',401);
 if(!sharedReady(env))throw new MemberError('会员已验证，管理员尚未配置共享 API，请稍后再试。');
 const id=await clientId(request,env);
 if(kind==='token'){
  await consume(env,'realtime-minute:'+id,3,60);
  await consume(env,'realtime-day',limit(env,'MEMBER_DAILY_REALTIME_LIMIT',12),86400);
 }else{
  await consume(env,'text-minute:'+id,60,60);
  await consume(env,'text-day',limit(env,'MEMBER_DAILY_TEXT_LIMIT',3000),86400);
  await consume(env,'text-characters-day',limit(env,'MEMBER_DAILY_CHARACTER_LIMIT',5000000),86400,characters);
 }
 return env.OPENAI_API_KEY;
}
