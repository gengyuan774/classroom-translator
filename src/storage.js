let account=null;
const connections=new Map(),queues=new Map();
const namespace=owner=>owner?'classroom-notes-account-'+owner:'classroom-notes';
function database(owner){const name=namespace(owner);if(!connections.has(name))connections.set(name,new Promise((resolve,reject)=>{const req=indexedDB.open(name,2);req.onupgradeneeded=()=>{for(const [store,keyPath] of [['sessions','id'],['materials','key'],['sync','id']])if(!req.result.objectStoreNames.contains(store))req.result.createObjectStore(store,{keyPath});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>{connections.delete(name);reject(new Error('无法打开浏览器存储，请检查隐私模式或存储权限'));};}));return connections.get(name);}
async function transaction(owner,store,mode,operation){const db=await database(owner);return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),request=operation(tx.objectStore(store));let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('浏览器保存失败，存储空间可能不足，请先导出笔记'));tx.onabort=()=>reject(new Error('浏览器保存失败，请重试'));});}
const cached=(owner,store,id)=>transaction(owner,store,'readonly',s=>s.get(id));
const put=(owner,store,value)=>transaction(owner,store,'readwrite',s=>s.put(structuredClone(value)));
export function setAccount(user){account=user?.id||null;}
export function accountId(){return account;}
export function storageDescription(){return account?'课堂记录保存到账户':'课堂记录保存在当前浏览器';}
function report(message){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('history-save-warning',{detail:message}));}
async function cloud(owner,path,{method='GET',body}={}){const response=await fetch('/api/history'+path,{method,credentials:'same-origin',headers:{'X-Account-ID':owner,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'账户历史记录暂不可用');return data;}
function serial(owner,id,operation){const key=owner+':'+id;const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(operation);queues.set(key,next);next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});return next;}
export function saveSession(s){const owner=account,snapshot=structuredClone(s);return serial(owner,s.id,async()=>{
 await put(owner,'sessions',snapshot);if(!owner)return;
 const state=await cached(owner,'sync',s.id)||{id:s.id,revision:0};await put(owner,'sync',{...state,pending:true});
 try{const result=await cloud(owner,'/'+s.id,{method:'PUT',body:{session:snapshot,revision:state.revision}});await put(owner,'sync',{id:s.id,revision:result.revision,pending:false});}
 catch(e){report('记录已暂存在此设备，账户同步未完成：'+e.message);throw e;}
 });}
export async function getSession(id){const owner=account;
 if(owner){const pending=await cached(owner,'sync',id);if(pending?.pending){report('这节课有尚未同步到账户的内容，已打开此设备的副本。');const local=await cached(owner,'sessions',id);if(local)return local;}
 const result=await cloud(owner,'/'+id);await put(owner,'sessions',result.session);await put(owner,'sync',{id,revision:result.revision,pending:false});return result.session;}
 const s=await cached(owner,'sessions',id);if(!s)throw new Error('当前浏览器中没有这节课');return s;
}
const metadata=({id,title,createdAt,status,segments,demo})=>({id,title,createdAt,status,count:segments.length,demo});
export async function listSessions(){const owner=account;
 const local=(await transaction(owner,'sessions','readonly',store=>store.getAll())).map(metadata);
 if(!owner)return local.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const remote=await cloud(owner,'');const pending=(await transaction(owner,'sync','readonly',store=>store.getAll())).filter(s=>s.pending).map(s=>s.id);
 return [...remote.filter(s=>!pending.includes(s.id)),...local.filter(s=>pending.includes(s.id))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function saveMaterial(sessionId,m){const owner=account;await put(owner,'materials',{...m,key:sessionId+':'+m.id});if(owner)await cloud(owner,'/'+sessionId+'/materials/'+m.id,{method:'PUT',body:m});}
export async function getMaterial(sessionId,id){const owner=account;if(owner){const result=await cloud(owner,'/'+sessionId+'/materials/'+id);await put(owner,'materials',{...result,key:sessionId+':'+id});return result;}const m=await cached(owner,'materials',sessionId+':'+id);if(!m)throw new Error('当前课堂的资料不存在');return m;}
export async function removeMaterial(sessionId,id){const owner=account;if(owner)await cloud(owner,'/'+sessionId+'/materials/'+id,{method:'DELETE'});return transaction(owner,'materials','readwrite',store=>store.delete(sessionId+':'+id));}
