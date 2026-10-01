import assets from './generated-assets.js';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handle(request,upstream=fetch){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/')){
  const asset=assets[url.pathname];if(!asset)return new Response('Not found',{status:404});if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
  return new Response(request.method==='HEAD'?null:asset.text,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'microphone=(self)', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://api.openai.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
 }
 if(!['/api/openai/responses','/api/openai/token'].includes(url.pathname))return reply({error:'Not found'},404);
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return reply({error:'不允许跨站请求'},403);
 const auth=request.headers.get('Authorization');if(!/^Bearer sk-[\w-]{10,500}$/.test(auth||''))return reply({error:'请填写你自己的 OpenAI API Key'},401);
 try{
  if(Number(request.headers.get('content-length'))>350000)return reply({error:'请求过大'},413);
  const reader=request.body?.getReader();if(!reader)return reply({error:'请求为空'},400);const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>350000){await reader.cancel();return reply({error:'请求过大'},413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const data=JSON.parse(new TextDecoder().decode(bytes));
  let endpoint,payload;
  if(url.pathname.endsWith('/token')){endpoint='realtime/client_secrets';payload={expires_after:{anchor:'created_at',seconds:600},session:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'gpt-live-transcribe',languages:['en'],delay:'low',prompt:'An English classroom lecture. Course: '+String(data.title||'').slice(0,120)},turn_detection:null}}}};}
  else{if(typeof data.input!=='string'||typeof data.instructions!=='string')return reply({error:'输入格式不正确'},400);endpoint='responses';payload={model:'gpt-4.1-mini',input:data.input,instructions:data.instructions,store:false,max_output_tokens:Math.max(1,Math.min(Number(data.max_output_tokens)||4000,4000))};}
  const response=await upstream('https://api.openai.com/v1/'+endpoint,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  const result=await response.json();return reply(result,response.status);
 }catch{return reply({error:{message:'请求处理失败或超时，请检查网络后重试。'}},502);}
}
export default {fetch(request){return handle(request);}};
