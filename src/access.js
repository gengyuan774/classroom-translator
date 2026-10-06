let ownKey='',member=false,ready=false;
export function authHeaders(credential){return credential==='member'?{'X-Access-Mode':'member'}:{Authorization:'Bearer '+credential};}
export function getKey(){if(ownKey)return ownKey;if(member&&ready)return 'member';throw new Error(member?'管理员尚未配置共享 API，请稍后再试。':'请先登录开通会员，或连接自己的 OpenAI API Key');}
export function accessConfig(){return {hasKey:!!ownKey||(member&&ready),member,sharedReady:ready,accessMode:ownKey?'key':member?'member':'none',transcriptionModel:'gpt-live-transcribe',textModel:'gpt-4.1-mini'};}
async function memberApi(path,body){const res=await fetch('/api/member/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw new Error(data.error?.message||'会员服务暂不可用');return data;}
export async function refreshAccess(){try{const data=await memberApi('status');member=data.member;ready=data.sharedReady;}catch{member=false;ready=false;}return accessConfig();}
export async function login(code){const data=await memberApi('login',{code});member=data.member;ready=data.sharedReady;ownKey='';return accessConfig();}
export function setOwnKey(key){if(typeof key!=='string'||!/^sk-[\w-]{10,500}$/.test(key.trim()))throw new Error('请输入有效格式的 OpenAI API Key');ownKey=key.trim();return accessConfig();}

export async function useMembership(){ownKey='';return refreshAccess();}
