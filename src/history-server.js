import {MemberError} from './member.js';
import {validLanguage} from './languages.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const storage=env=>{if(!env.DB||!env.BUCKET)throw new MemberError('历史记录保存服务暂不可用，请稍后重试。');return env;};
async function record(env,owner,id){return env.DB.prepare('SELECT * FROM account_classes WHERE account_id = ? AND id = ?').bind(owner,id).first();}
async function readObject(env,key){const object=await env.BUCKET.get(key);if(!object)throw new MemberError('记录暂时无法读取，请稍后重试。');return object.json();}
const removeObject=(env,key)=>env.BUCKET.delete(key).catch(()=>{});
const pick=(source,keys)=>Object.fromEntries(keys.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
function cleanSession(s,id){
 if(s?.sourceLanguage!==undefined&&!validLanguage(s.sourceLanguage))throw new MemberError('请选择支持的语言。',400);
 if(!s||s.id!==id||typeof s.title!=='string'||s.title.length>120||!Number.isFinite(Date.parse(s.createdAt))||!Array.isArray(s.segments)||s.segments.length>30000||!Array.isArray(s.materials)||s.materials.length>10||!s.materials.every(m=>uuid(m.id))||!['ready','recording','paused','finishing','summarizing','completed','summary_failed','interrupted'].includes(s.status))throw new MemberError('课堂记录格式不正确。',400);
 if(!s.segments.every(r=>r&&typeof r.id==='string'&&typeof (r.source||'')==='string'&&typeof (r.translation||'')==='string'))throw new MemberError('课堂字幕格式不正确。',400);
 return pick(s,['id','title','createdAt','status','segments','materials','warnings','summary','demo','summarySources','summaryScope','summaryStale','summaryError','lastTrial','endedAt','sourceLanguage']);
}
export async function historyRoute(request,env,user,path,data){
 storage(env);const owner=user.id;
 if(path==='/api/history'&&request.method==='GET'){
  const rows=await env.DB.prepare('SELECT id, title, created_at AS createdAt, status, segment_count AS count, demo, revision FROM account_classes WHERE account_id = ? ORDER BY created_at DESC').bind(owner).all();
  return rows.results.map(x=>({...x,demo:!!x.demo}));
 }
 const match=path.match(/^\/api\/history\/([^/]+)(?:\/materials\/([^/]+))?$/);if(!match||!uuid(match[1])||(match[2]&&!uuid(match[2])))throw new MemberError('记录不存在。',404);
 const [,id,mid]=match;const existing=await record(env,owner,id);
 if(mid){
  if(!existing)throw new MemberError('记录不存在。',404);
  const material=await env.DB.prepare('SELECT object_key FROM account_materials WHERE account_id = ? AND class_id = ? AND id = ?').bind(owner,id,mid).first();
  if(request.method==='GET'){if(!material)throw new MemberError('资料不存在。',404);return readObject(env,material.object_key);}
  if(request.method==='DELETE'){
   await env.DB.prepare('DELETE FROM account_materials WHERE account_id = ? AND class_id = ? AND id = ?').bind(owner,id,mid).run();if(material)await removeObject(env,material.object_key);return {ok:true};
  }
  if(request.method==='PUT'){
   if(data?.id!==mid||typeof data.name!=='string'||!Array.isArray(data.pages)||data.pages.length>300||!data.pages.every(p=>typeof p.text==='string'&&typeof p.label==='string')||data.pages.reduce((n,p)=>n+p.text.length,0)>200000)throw new MemberError('资料格式不正确。',400);
   const key=`accounts/${owner}/materials/${id}/${mid}/${crypto.randomUUID()}.json`;
   await env.BUCKET.put(key,JSON.stringify(pick(data,['id','name','pages','warnings','characters','pageCount'])),{httpMetadata:{contentType:'application/json'}});
   try{await env.DB.prepare('INSERT INTO account_materials (account_id, class_id, id, object_key) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, class_id, id) DO UPDATE SET object_key = excluded.object_key').bind(owner,id,mid,key).run();}catch(e){await removeObject(env,key);throw e;}
   if(material)await removeObject(env,material.object_key);return {ok:true};
  }
 }else{
  if(request.method==='GET'){if(!existing)throw new MemberError('记录不存在。',404);return {session:await readObject(env,existing.object_key),revision:existing.revision};}
  if(request.method==='PUT'){
   const s=cleanSession(data?.session,id),revision=data.revision;
   if(!Number.isSafeInteger(revision)||revision<0||(existing?existing.revision:0)!==revision)throw new MemberError('这节课已在其他页面更新，请重新打开记录后继续。',409);
   const key=`accounts/${owner}/classes/${id}/${crypto.randomUUID()}.json`;
   await env.BUCKET.put(key,JSON.stringify(s),{httpMetadata:{contentType:'application/json'}});
   let updated;
   try{updated=await env.DB.prepare('INSERT INTO account_classes (account_id, id, title, created_at, status, segment_count, demo, object_key, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(account_id, id) DO UPDATE SET title=excluded.title, created_at=excluded.created_at, status=excluded.status, segment_count=excluded.segment_count, demo=excluded.demo, object_key=excluded.object_key, revision=account_classes.revision+1 WHERE account_classes.revision = ? RETURNING revision').bind(owner,id,s.title,s.createdAt,s.status,s.segments.length,s.demo?1:0,key,revision).first();}catch(e){await removeObject(env,key);throw e;}
   if(!updated){await removeObject(env,key);throw new MemberError('这节课已在其他页面更新，请重新打开记录后继续。',409);}
   if(existing)await removeObject(env,existing.object_key);return updated;
  }
 }
 throw new MemberError('不支持此操作。',405);
}
