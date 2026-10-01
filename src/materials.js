import {getMaterial} from './storage.js';
export async function activeMaterials(s){return Promise.all((s.materials||[]).filter(m=>m.enabled!==false).map(m=>getMaterial(s.id,m.id)));}
function tokens(text){const s=text.toLowerCase();return [...new Set([...(s.match(/[a-z][a-z0-9-]{2,}/g)||[]).filter(w=>!['the','and','for','that','this','with','from','are','you','have','will','what','about'].includes(w)),...(s.match(/[\u3400-\u9fff]{2,}/g)||[]).flatMap(w=>Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)))])];}
export async function referenceContext(session,query,max=12000){
 const materials=await activeMaterials(session),terms=tokens(query),candidates=[];
 for(const m of materials)for(const page of m.pages){for(let i=0;i<page.text.length;i+=2200){const text=page.text.slice(i,i+2400),lower=text.toLowerCase();const score=terms.reduce((n,t)=>n+(lower.includes(t)?Math.min(t.length,10):0),0);candidates.push({id:m.id,name:m.name,label:page.label,text,score});}}
 candidates.sort((a,b)=>b.score-a.score);
 let text='',references=[];for(const p of candidates){const block=`[资料：${p.name}，${p.label}]\n${p.text}\n`;if(text.length+block.length>max)continue;text+=block;references.push({id:p.id,name:p.name,label:p.label});if(references.length>=6)break;}
 references=references.filter((r,i,a)=>a.findIndex(x=>x.id===r.id&&x.label===r.label)===i);
 return {text,references};
}
export function sourceList(session){return (session.materials||[]).filter(m=>m.enabled!==false).map(m=>({id:m.id,name:m.name,pageCount:m.pageCount,warnings:m.warnings||[]}));}
