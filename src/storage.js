const dbPromise=()=>new Promise((resolve,reject)=>{const req=indexedDB.open('classroom-notes',1);req.onupgradeneeded=()=>{req.result.createObjectStore('sessions',{keyPath:'id'});req.result.createObjectStore('materials',{keyPath:'key'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('无法打开浏览器存储，请检查隐私模式或存储权限'));});
let db;
async function transaction(store,mode,operation){db ||= await dbPromise();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),request=operation(tx.objectStore(store));let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('浏览器保存失败，存储空间可能不足，请先导出笔记'));tx.onabort=()=>reject(new Error('浏览器保存失败，请重试'));});}
export const saveSession=s=>transaction('sessions','readwrite',store=>store.put(structuredClone(s)));
export async function getSession(id){const s=await transaction('sessions','readonly',store=>store.get(id));if(!s)throw new Error('当前浏览器中没有这节课');return s;}
export const listSessions=async()=>(await transaction('sessions','readonly',store=>store.getAll())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(({id,title,createdAt,status,segments,demo})=>({id,title,createdAt,status,count:segments.length,demo}));
export const saveMaterial=(sessionId,m)=>transaction('materials','readwrite',store=>store.put({...m,key:sessionId+':'+m.id}));
export async function getMaterial(sessionId,id){const m=await transaction('materials','readonly',store=>store.get(sessionId+':'+id));if(!m)throw new Error('当前课堂的资料不存在');return m;}
export const removeMaterial=(sessionId,id)=>transaction('materials','readwrite',store=>store.delete(sessionId+':'+id));
