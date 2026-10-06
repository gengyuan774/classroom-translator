import {MemberError} from './errors.js';
import {consume} from './member.js';
import {createVerifiedAccountSession} from './account-server.js';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const phoneReady=env=>!!(env.DB&&env.SMS_PROVIDER==='twilio-verify'&&/^AC[\da-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID||'')&&/^VA[\da-f]{32}$/i.test(env.TWILIO_VERIFY_SERVICE_SID||'')&&env.TWILIO_AUTH_TOKEN);
function ready(env){if(!phoneReady(env))throw new MemberError('短信服务待接入，暂时无法发送验证码或登录。');}
export function normalizePhone(value){
 if(typeof value!=='string'||value.length>30)throw new MemberError('请输入有效手机号，境外号码请加国家区号。',400);
 let phone=value.replace(/[\s()-]/g,'');if(/^1[3-9]\d{9}$/.test(phone))phone='+86'+phone;
 if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new MemberError('请输入有效手机号，境外号码请加国家区号（如 +44）。',400);
 return phone;
}
async function limited(env,key,limit,period){try{await consume(env,'sms:'+key,limit,period);}catch(e){if(e.status===429)throw new MemberError('验证码操作过于频繁，请稍后再试。',429);throw e;}}
async function provider(env,path,body,upstream){
 let response;try{response=await upstream('https://verify.twilio.com/v2/Services/'+env.TWILIO_VERIFY_SERVICE_SID+'/'+path,{method:'POST',headers:{Authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString(),signal:AbortSignal.timeout(15000)});}catch{throw new MemberError('短信服务暂不可用，请稍后再试。');}
 if(!response.ok){if(path==='VerificationCheck'&&[400,404].includes(response.status))throw new MemberError('验证码无效或已过期，请重新获取。',400);if(response.status===429)throw new MemberError('短信服务繁忙，请稍后重试。',429);throw new MemberError('短信服务暂不可用，请联系管理员。');}
 try{return await response.json();}catch{throw new MemberError('短信服务响应异常，请稍后重试。');}
}
export async function sendPhoneCode(request,env,data,upstream=fetch){
 ready(env);const phone=normalizePhone(data.phone),now=Date.now();
 const ip=await hash(request.headers.get('CF-Connecting-IP')||'unknown'),identity=await hash(phone);
 await limited(env,'ip:'+ip,5,600);await limited(env,'phone:'+identity,1,60);await limited(env,'phone-day:'+identity,10,86400);await limited(env,'global-day',100,86400);
 await env.DB.batch([env.DB.prepare('DELETE FROM phone_challenges WHERE expires_at <= ?').bind(now),env.DB.prepare('DELETE FROM usage_buckets WHERE expires_at <= ?').bind(now)]);
 const verification=await provider(env,'Verifications',{To:phone,Channel:'sms'},upstream);
 if(verification.status!=='pending'||verification.to!==phone||!/^VE[\da-f]{32}$/i.test(verification.sid||''))throw new MemberError('短信发送未确认，请稍后重新获取。');
 const id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO phone_challenges (id, phone_e164, verification_sid, attempts, expires_at) VALUES (?, ?, ?, 0, ?)').bind(id,phone,verification.sid,now+10*60000).run();
 return {challengeId:id,retryAfter:60,expiresIn:600};
}
export async function verifyPhoneCode(request,env,data,upstream=fetch){
 ready(env);
 if(typeof data.challengeId!=='string'||!/^[a-f0-9-]{36}$/i.test(data.challengeId)||typeof data.code!=='string'||!/^\d{4,10}$/.test(data.code))throw new MemberError('请先获取验证码，并输入收到的短信验证码。',400);
 await limited(env,'check-ip:'+await hash(request.headers.get('CF-Connecting-IP')||'unknown'),20,600);
 const challenge=await env.DB.prepare('UPDATE phone_challenges SET attempts = attempts + 1 WHERE id = ? AND expires_at > ? AND attempts < 5 RETURNING phone_e164, verification_sid').bind(data.challengeId,Date.now()).first();
 if(!challenge)throw new MemberError('验证码已过期或尝试次数过多，请重新获取。',400);
 const verification=await provider(env,'VerificationCheck',{VerificationSid:challenge.verification_sid,Code:data.code},upstream);
 if(verification.status!=='approved'||verification.to!==challenge.phone_e164||verification.sid!==challenge.verification_sid)throw new MemberError('验证码不正确，请重新输入。',400);
 // One successful verification can issue one session; replay cannot log in again.
 const claimed=await env.DB.prepare('DELETE FROM phone_challenges WHERE id = ? AND expires_at > ? RETURNING id').bind(data.challengeId,Date.now()).first();
 if(!claimed)throw new MemberError('验证码已使用或已过期，请重新获取。',400);
 return createVerifiedAccountSession(env,{provider:'phone',subject:challenge.phone_e164,label:challenge.phone_e164.slice(0,-7)+'****'+challenge.phone_e164.slice(-3)});
}
