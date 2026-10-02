import assets from './generated-assets.js';
import {MemberError,memberSession,sharedReady,loginMember,logoutMember,allowSharedRequest} from './member.js';
import {accountUser,requireAccount,signOutAccount} from './account-server.js';
import {historyRoute} from './history-server.js';
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
async function readJson(request,max=350000){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new MemberError('输入格式不正确',415);
 if(Number(request.headers.get('content-length'))>max)throw new MemberError('请求过大',413);
 const reader=request.body?.getReader();if(!reader)throw new MemberError('请求为空',400);
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new MemberError('请求过大',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{const result=JSON.parse(new TextDecoder().decode(bytes));if(!result||typeof result!=='object'||Array.isArray(result))throw new Error();return result;}catch{throw new MemberError('输入格式不正确',400);}
}
export async function handle(request,upstream=fetch,env={}){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/')){
  const asset=assets[url.pathname==='/profile'?'/':url.pathname];if(!asset)return new Response('Not found',{status:404});if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
  return new Response(request.method==='HEAD'?null:asset.text,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(self)', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://api.openai.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
 }
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return reply({error:{message:'不允许跨站请求'}},403);
 if(request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({error:{message:'不允许跨站请求'}},403);
 try{
  if(url.pathname==='/api/account'&&request.method==='GET')return reply({user:await accountUser(request,env),methods:{phone:false,email:false,wechat:false}});
  if(url.pathname==='/api/account/logout'&&request.method==='POST'){
   await readJson(request,4096);return reply({ok:true},200,{'Set-Cookie':await signOutAccount(request,env)});
  }
  if(/^\/api\/account\/login\/(phone|email|wechat)$/.test(url.pathname))return reply({error:{message:'该登录方式尚未接入，请稍后再试。'}},503);
  if(url.pathname==='/api/history'||url.pathname.startsWith('/api/history/')){
   const user=await requireAccount(request,env);
   if(request.headers.get('X-Account-ID')&&request.headers.get('X-Account-ID')!==user.id)throw new MemberError('登录账户已变化，请刷新页面后继续。',409);
   const data=request.method==='PUT'?await readJson(request,url.pathname.includes('/materials/')?1000000:8000000):undefined;
   return reply(await historyRoute(request,env,user,url.pathname,data));
  }
  if(url.pathname==='/api/member/status'&&request.method==='GET')return reply({member:!!await memberSession(request,env),sharedReady:sharedReady(env)});
  if(url.pathname==='/api/member/login'&&request.method==='POST'){
   const data=await readJson(request,4096);const cookie=await loginMember(request,env,data.code);return reply({member:true,sharedReady:sharedReady(env)},200,{'Set-Cookie':cookie});
  }
  if(url.pathname==='/api/member/logout'&&request.method==='POST'){
   await readJson(request,4096);return reply({member:false,sharedReady:sharedReady(env)},200,{'Set-Cookie':await logoutMember(request,env)});
  }
  if(!['/api/openai/responses','/api/openai/token'].includes(url.pathname))return reply({error:{message:'Not found'}},404);
  if(request.method!=='POST')return reply({error:{message:'Method not allowed'}},405);
  const shared=request.headers.get('X-Access-Mode')==='member';let auth=request.headers.get('Authorization');
  if(!shared&&!/^Bearer sk-[\w-]{10,500}$/.test(auth||''))return reply({error:{message:'请输入会员码或自己的 OpenAI API Key'}},401);
  const data=await readJson(request);let endpoint,payload;
  if(url.pathname.endsWith('/token')){
   endpoint='realtime/client_secrets';payload={expires_after:{anchor:'created_at',seconds:60},session:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'gpt-live-transcribe',languages:['en'],delay:'low',prompt:'An English classroom lecture. Course: '+String(data.title||'').slice(0,120)},turn_detection:null}}}};
  }else{
   if(typeof data.input!=='string'||typeof data.instructions!=='string')return reply({error:{message:'输入格式不正确'}},400);
   if(data.input.length+data.instructions.length>80000)return reply({error:{message:'输入内容过长，请减少参考资料后重试。'}},413);
   endpoint='responses';payload={model:'gpt-4.1-mini',input:data.input,instructions:data.instructions,store:false,max_output_tokens:Math.max(1,Math.min(Math.floor(Number(data.max_output_tokens))||4000,4000))};
  }
  if(shared)auth='Bearer '+await allowSharedRequest(request,env,endpoint==='responses'?'text':'token',(data.input?.length||0)+(data.instructions?.length||0));
  const response=await upstream('https://api.openai.com/v1/'+endpoint,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  const result=await response.json();
  if(shared&&!response.ok)return reply({error:{message:response.status===429?'共享 API 额度或速率受限，请联系管理员。':'共享 API 暂时不可用，请联系管理员检查连接。'}},response.status===401||response.status===403?503:response.status);
  // Never forward an upstream error containing a long-lived credential.
  if(!response.ok&&result.error?.message)result.error.message=String(result.error.message).replace(/sk-[\w-]+/g,'[已隐藏]');
  return reply(result,response.status);
 }catch(error){return reply({error:{message:error instanceof MemberError?error.message:'请求处理失败或服务暂不可用，请稍后重试。'}},error instanceof MemberError?error.status:503);}
}
export default {fetch(request,env){return handle(request,fetch,env);}};
