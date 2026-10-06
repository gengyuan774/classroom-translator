import {scryptAsync} from '@noble/hashes/scrypt.js';
import {MemberError} from './errors.js';
import {consume} from './member.js';
import {issueAccountSession} from './account-server.js';
const encode=new TextEncoder(),hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value))));
const scheme='scrypt-16384-8-5-v1';
let activeHashes=0;
async function derive(password,salt){
 if(activeHashes>=2)throw new MemberError('登录服务繁忙，请稍后重试。');
 activeHashes++;try{return hex(await scryptAsync(encode.encode(password),encode.encode(salt),{N:16384,r:8,p:5,dkLen:32,maxmem:32*1024*1024}));}finally{activeHashes--;}
}
export async function hashPassword(password){const salt=hex(crypto.getRandomValues(new Uint8Array(16)));return scheme+'$'+salt+'$'+await derive(password,salt);}
export async function verifyPassword(password,stored){
 const parts=String(stored||'').split('$'),valid=parts[0]===scheme&&/^[a-f0-9]{32}$/.test(parts[1]||'')&&/^[a-f0-9]{64}$/.test(parts[2]||'');
 const actual=await derive(password,valid?parts[1]:'00000000000000000000000000000000'),expected=valid?parts[2]:'0'.repeat(64);
 let diff=0;for(let i=0;i<64;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return valid&&diff===0;
}
function credentials(data){
 const username=typeof data.username==='string'?data.username.trim().toLowerCase():'';
 if(!/^[a-z0-9_][a-z0-9_.-]{3,31}$/.test(username))throw new MemberError('账号需为 4–32 位英文字母、数字、下划线、点或短横线，不能以点或短横线开头。',400);
 if(typeof data.password!=='string'||data.password.length<8||data.password.length>128)throw new MemberError('密码需为 8–128 位，区分大小写。',400);
 return {username,password:data.password};
}
async function rate(request,env,username,register){
 if(!env.DB)throw new MemberError('账户服务暂不可用，请稍后重试。');
 const ip=await digest(request.headers.get('CF-Connecting-IP')||'unknown');
 try{await consume(env,'password-ip:'+ip,20,600);await consume(env,'password-user:'+await digest(username),10,600);if(register)await consume(env,'register-ip:'+ip,5,3600);}catch(e){if(e.status===429)throw new MemberError('注册或登录尝试过于频繁，请稍后再试。',429);throw e;}
}
export async function passwordAccount(request,env,data,register=false){
 const {username,password}=credentials(data);await rate(request,env,username,register);
 const existing=await env.DB.prepare('SELECT p.password_hash, a.id, a.provider, a.label FROM account_passwords p JOIN accounts a ON a.id = p.account_id WHERE p.username = ?').bind(username).first();
 if(!register){
  if(!await verifyPassword(password,existing?.password_hash)||!existing)throw new MemberError('账号或密码不正确。',401);
  return issueAccountSession(env,{id:existing.id,provider:existing.provider,label:existing.label});
 }
 if(existing)throw new MemberError('这个账号已注册，请直接登录或换一个账号。',409);
 const id=crypto.randomUUID(),now=Date.now(),passwordHash=await hashPassword(password);
 try{await env.DB.batch([
  env.DB.prepare('INSERT INTO accounts (id, provider, subject_hash, label, created_at) VALUES (?, ?, ?, ?, ?)').bind(id,'password',await digest('password:'+username),username,now),
  env.DB.prepare('INSERT INTO account_passwords (username, account_id, password_hash, created_at) VALUES (?, ?, ?, ?)').bind(username,id,passwordHash,now)
 ]);}catch(e){if(await env.DB.prepare('SELECT username FROM account_passwords WHERE username = ?').bind(username).first())throw new MemberError('这个账号已注册，请直接登录或换一个账号。',409);throw e;}
 return issueAccountSession(env,{id,provider:'password',label:username});
}
