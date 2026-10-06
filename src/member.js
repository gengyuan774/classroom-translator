import {MemberError} from './errors.js';
export {MemberError} from './errors.js';
import {accountUser,requireAccount} from './account-server.js';
const WEEK=7*86400;
const encode=new TextEncoder();
const db=env=>{if(!env.DB)throw new MemberError('会员服务暂不可用，请稍后重试。');return env.DB;};
export const sharedReady=env=>!!(env.OPENAI_API_KEY&&env.DB);
const configured=env=>{if(!env.MEMBER_CODE)throw new MemberError('会员服务尚未配置，请联系管理员。');};
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(await crypto.subtle.digest('SHA-256',encode.encode(value)));
async function matches(a,b){const aa=await hash(a),bb=await hash(b);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa.charCodeAt(i)^bb.charCodeAt(i);return diff===0;}
export async function membershipFor(env,accountId){
 const row=await db(env).prepare('SELECT tier, expires_at FROM account_memberships WHERE account_id = ?').bind(accountId).first();
 const active=!!row&&['regular','premium'].includes(row.tier)&&row.expires_at>Date.now();
 return {tier:active?row.tier:'none',active,expiresAt:row?.expires_at??null,expired:!!row&&row.tier!=='none'&&!active};
}
export async function memberSession(request,env){
 const user=await accountUser(request,env);if(!user)return null;
 const membership=await membershipFor(env,user.id);return membership.active?{...membership,accountId:user.id}:null;
}
// SQLite performs the limit check and increment atomically, including across Worker instances.
export async function consume(env,id,limit,periodSeconds,amount=1){
 const now=Date.now(),window=Math.floor(now/(periodSeconds*1000));
 const result=await db(env).prepare('INSERT INTO usage_buckets (id, count, expires_at) SELECT ?, ?, ? WHERE ? <= ? ON CONFLICT(id) DO UPDATE SET count = count + excluded.count WHERE count + excluded.count <= ? RETURNING count').bind(id+':'+window,amount,(window+2)*periodSeconds*1000,amount,limit,limit).first();
 if(!result)throw new MemberError('共享服务已达到使用上限，请稍后重试或使用自己的 API Key。',429);
}
export async function loginMember(request,env,code){
 const user=await requireAccount(request,env);configured(env);
 await consume(env,'redeem:'+user.id,15,600);
 if(typeof code!=='string'||code.length>128||!await matches(code.trim(),env.MEMBER_CODE))throw new MemberError('会员码不正确，请重新输入。',401);
 const now=Date.now(),version=await hash('member-code:'+env.MEMBER_CODE);
 // Persist the first expiry; retries and concurrent redemption never extend it.
 await db(env).batch([
  db(env).prepare('INSERT INTO member_redemptions (account_id, code_version, redeemed_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, code_version) DO NOTHING').bind(user.id,version,now,now+WEEK*1000),
  db(env).prepare(`INSERT INTO account_memberships (account_id, tier, expires_at, updated_at)
   SELECT account_id, 'regular', expires_at, ? FROM member_redemptions WHERE account_id = ? AND code_version = ? AND expires_at > ?
   ON CONFLICT(account_id) DO UPDATE SET tier = 'regular', expires_at = excluded.expires_at, updated_at = excluded.updated_at
   WHERE (account_memberships.tier != 'premium' OR account_memberships.expires_at <= ?) AND (account_memberships.expires_at IS NULL OR account_memberships.expires_at < excluded.expires_at)`).bind(now,user.id,version,now,now)
 ]);
 const membership=await membershipFor(env,user.id);
 if(!membership.active)throw new MemberError('此账户已领取过该会员码，7 天会员已到期。',409);
 return membership;
}
const limit=(env,key,fallback)=>{const n=Number(env[key]);return Number.isSafeInteger(n)&&n>0?n:fallback;};
export async function allowSharedRequest(request,env,kind,characters=0){
 const member=await memberSession(request,env);if(!member)throw new MemberError('请先登录并开通会员；已到期的会员无法使用共享服务。',401);
 if(!sharedReady(env))throw new MemberError('会员已验证，管理员尚未配置共享 API，请稍后再试。');
 const id=member.accountId;
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
