import {saveSession,getSession,listSessions,saveMaterial,getMaterial,removeMaterial} from './storage.js';
import {summarize,translateSegment} from './core.js';
import {getKey,accessConfig,setOwnKey} from './access.js';
import {validLanguage,setSessionLanguage} from './languages.js';
export {getKey} from './access.js';
export const busy=new Set();
export async function complete(s){
 try{s.status='summarizing';await saveSession(s);s.summary=await summarize(s,getKey());s.status='completed';delete s.summaryError;await saveSession(s);return s;}
 catch(e){s.status='summary_failed';s.summaryError=e.message;await saveSession(s);throw e;}
}
async function parsedFile(file,name){
 if(file.size>20*1024*1024)throw new Error('每份资料最大 20 MB');
 const buffer=await file.arrayBuffer();return new Promise((resolve,reject)=>{const worker=new Worker('/parser-worker.js',{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(new Error('资料解析超时，请拆分后导入'));},45000);worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(new Error(data.error)):resolve(data.result);};worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(new Error('资料解析失败，请尝试较小文件或转成 PDF'));};worker.postMessage({buffer,name},[buffer]);});
}
const demoSummary='## 课堂概览\n本节示例介绍机会成本：做出一种选择时，放弃的最佳替代方案的价值。\n## 核心知识点\n- 选择意味着取舍。\n- 机会成本可以包含金钱和时间。\n## 重要术语\n- Opportunity cost：机会成本\n## 作业\n示例中未提及。';
export async function localApi(route,options={}){
 const method=options.method||'GET';const data=typeof options.body==='string'?JSON.parse(options.body):{};
 if(route==='/api/config'){
  if(method==='POST')return setOwnKey(data.key);
  return accessConfig();
 }
 if(route==='/api/sessions'){
  if(method==='GET')return listSessions();
  const sourceLanguage=data.demo===true?'en':(data.sourceLanguage??'auto');if(!validLanguage(sourceLanguage))throw new Error('请选择支持的语言');
  const s={id:crypto.randomUUID(),title:String(data.title||'未命名课堂').slice(0,120),createdAt:new Date().toISOString(),status:'ready',segments:[],materials:[],warnings:[],summary:'',sourceLanguage,demo:data.demo===true};
  if(s.demo){s.title='经济学入门 · 演示课堂';s.status='completed';s.summary=demoSummary;s.segments=[{id:'demo',source:'Opportunity cost is the value of the next best alternative that you give up.',translation:'机会成本是你放弃的最佳替代方案的价值。',offset:0}];}
  await saveSession(s);return s;
 }
 const match=route.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(summary|try|materials)(?:\/([a-f0-9-]{36}))?)?$/);
 if(!match)throw new Error('未找到操作');
 const [,id,action,materialId]=match;
 if(busy.has(id)&&method!=='GET')throw new Error('请先完成当前课堂操作');
 const s=await getSession(id);
 if(!action){if(method==='PATCH'){if(s.demo)throw new Error('演示课堂使用固定英语内容');setSessionLanguage(s,data.sourceLanguage);await saveSession(s);}return s;}
 if(action==='materials'&&method==='GET'){if(!materialId)return s.materials; if(!s.materials.some(m=>m.id===materialId))throw new Error('这份资料不属于当前课堂');return getMaterial(id,materialId);}
 busy.add(id);
 try{
  if(action==='materials'){
   if(method==='POST'){
    if(s.materials.length>=10)throw new Error('每节课最多 10 份资料');
    const name=decodeURIComponent(options.headers['X-File-Name']).split(/[\\/]/).at(-1).replace(/[\x00-\x1f]/g,'').slice(0,180);const file=options.body;
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(s.materials.some(m=>m.hash===hash))throw new Error('这份资料已经导入当前课堂');
    const parsed=await parsedFile(file,name);if(s.materials.reduce((n,m)=>n+m.characters,0)+parsed.characters>500000)throw new Error('本节资料文字超过 50 万字符');
    const mid=crypto.randomUUID();await saveMaterial(id,{id:mid,name,...parsed});s.materials.push({id:mid,name,hash,bytes:file.size,characters:parsed.characters,pageCount:parsed.pageCount,warnings:parsed.warnings,enabled:true,importedAt:new Date().toISOString()});
   }else{
    const m=s.materials.find(m=>m.id===materialId);if(!m)throw new Error('资料不存在');
    if(method==='PATCH')m.enabled=data.enabled===true;
    if(method==='DELETE'){s.materials=s.materials.filter(m=>m.id!==materialId);await removeMaterial(id,materialId);}
   }
   s.lastTrial=null;if(s.summary)s.summaryStale=true;await saveSession(s);return s;
  }
  if(action==='summary'){if(s.demo&&!s.materials.length)return s;return await complete(s);}
  if(action==='try'){
   const source=String(data.text||'').trim();if(!source||source.length>6000)throw new Error('请输入 1–6000 字符的课堂片段');
   const trial={...s,segments:[{id:'trial',offset:0,source}],warnings:[]};const result=await translateSegment(trial,getKey(),source);const summary=await summarize(trial,getKey());s.lastTrial={source,...result,summary,createdAt:new Date().toISOString()};await saveSession(s);return s.lastTrial;
  }
 }finally{busy.delete(id);}
}
