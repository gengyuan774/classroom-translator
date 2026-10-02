import {authHeaders} from './access.js';
import {Buffer} from 'buffer';
import {getSession,saveSession} from './storage.js';
import {AudioTurns,translateSegment} from './core.js';
import {busy,getKey,complete} from './local-api.js';
export class BrowserLive{
 constructor(){this.readyState=0;this.bufferedAmount=0;this.paused=true;this.pending=0;this.meta=[];this.queue=Promise.resolve();this.jobs=new Set();this.closed=false;this.closing=false;setTimeout(()=>{if(!this.closed){this.readyState=1;this.onopen?.();}},0);}
 emit(value){this.onmessage?.({data:JSON.stringify(value)});}
 persist(){return saveSession(this.session).catch(e=>{this.emit({type:'warning',message:e.message});});}
 warn(message){if(this.session){this.session.warnings.push(message);this.persist();}this.emit({type:'warning',message});}
 send(data){
  if(this.closed)return;
  if(data instanceof ArrayBuffer){if(!this.paused&&this.upstream?.readyState===1&&!this.closing){this.turns.push(Buffer.from(data));this.bufferedAmount=this.upstream.bufferedAmount;}return;}
  let e;try{e=JSON.parse(data);}catch{return;}
  this.command(e).catch(error=>{this.emit({type:'fatal',message:error.message});});
 }
 async command(e){
  if(e.type==='start'){
   if(this.session)return;getKey();if(busy.has(e.id))throw new Error('当前课堂正在处理，请稍候');
   this.session=await getSession(e.id);busy.add(e.id);this.session.summary='';this.started=Date.now();this.base=(this.session.segments.at(-1)?.offset||0)+1000;await this.connect();
  }
  if(e.type==='pause'){this.paused=true;this.turns?.flush();this.session.status='paused';await this.persist();this.emit({type:'paused'});}
  if(e.type==='resume'){
   if(this.upstream?.readyState===1&&Date.now()-this.connectedAt<54*60*1000){this.paused=false;this.session.status='recording';await this.persist();this.emit({type:'ready'});}
   else {this.paused=true;if(this.pending)this.warn('重新连接前部分语音未识别完成，记录可能存在缺失。');this.pending=0;this.meta=[];this.started=Date.now();this.base=(this.session.segments.at(-1)?.offset||0)+1000;await this.connect();}
  }
  if(e.type==='finish'&&!this.closing){this.closing=true;this.paused=true;this.turns?.flush();this.session.status='finishing';await this.persist();this.emit({type:'status',message:'正在收齐最后的字幕…'});this.finishTimer=setTimeout(()=>this.finalize(true),20000);this.finalize();}
 }
 async connect(){
  if(this.upstream){this.upstream.onclose=null;this.upstream.close();}clearTimeout(this.limitTimer);clearTimeout(this.connectTimer);
  const response=await fetch('/api/openai/token',{method:'POST',headers:{...authHeaders(getKey()),'Content-Type':'application/json'},body:JSON.stringify({title:this.session.title}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||data.error||'无法创建实时转写连接');
  const secret=data.value||data.client_secret?.value;if(!secret)throw new Error('没有取得实时连接凭据');
  const upstream=new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription',['realtime','openai-insecure-api-key.'+secret]);this.upstream=upstream;this.connectedAt=Date.now();let bytes=0;
  const send=e=>{if(upstream.readyState===1)upstream.send(JSON.stringify(e));};
  this.turns=new AudioTurns(b=>{bytes+=b.length;send({type:'input_audio_buffer.append',audio:b.toString('base64')});},()=>{this.meta.push({offset:Math.max(this.base,this.base+Date.now()-this.started-bytes/48)});bytes=0;this.pending++;send({type:'input_audio_buffer.commit'});});
  this.connectTimer=setTimeout(()=>{this.paused=true;this.emit({type:'fatal',message:'实时连接超时，请检查网络后重试'});upstream.close();},20000);
  upstream.onopen=()=>send({type:'session.update',session:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'gpt-live-transcribe',languages:['en'],delay:'low',prompt:'An English classroom lecture. Course: '+this.session.title},turn_detection:null}}}});
  upstream.onmessage=({data})=>this.handle(JSON.parse(data)).catch(e=>this.warn(e.message));
  upstream.onerror=()=>this.emit({type:'fatal',message:'实时连接失败，请检查网络及 API 权限'});
  upstream.onclose=()=>{clearTimeout(this.connectTimer);clearTimeout(this.limitTimer);if(this.closed)return;if(this.closing)this.finalize(true);else {this.paused=true;this.warn('实时连接已断开，断开期间的语音未记录。点击继续录音重新连接。');this.emit({type:'disconnected'});}};
 }
 async handle(e){
  const s=this.session;if(this.closed||!s)return;
  if(e.type==='session.updated'||e.type==='transcription_session.updated'){
   clearTimeout(this.connectTimer);this.paused=false;s.status='recording';await this.persist();this.emit({type:'session',session:s});this.emit({type:'ready'});
   this.limitTimer=setTimeout(()=>{this.paused=true;this.turns.flush();s.status='paused';this.persist();this.emit({type:'limit',message:'本次连接已达 55 分钟，请点击继续录音建立新连接。'});},55*60*1000);
  }
  if(e.type==='input_audio_buffer.committed'){const meta=this.meta.shift()||{offset:this.base+Date.now()-this.started};if(!s.segments.some(x=>x.id===e.item_id))s.segments.push({id:e.item_id,...meta,source:'',translation:'',state:'transcribing'});await this.persist();}
  if(e.type==='conversation.item.input_audio_transcription.delta')this.emit({type:'delta',id:e.item_id,delta:e.delta});
  if(e.type==='conversation.item.input_audio_transcription.completed'){
   let row=s.segments.find(x=>x.id===e.item_id);if(!row){row={id:e.item_id,offset:this.base+Date.now()-this.started,translation:''};s.segments.push(row);}if(row.finalReceived)return;row.finalReceived=true;row.source=e.transcript||'';row.state='translating';this.pending=Math.max(0,this.pending-1);
   const job=this.queue.then(async()=>{try{if(row.source.trim()){const index=s.segments.indexOf(row);Object.assign(row,await translateSegment(s,getKey(),row.source,s.segments.slice(Math.max(0,index-2),index).map(x=>x.source).join('\n')));}row.state='translated';}catch(e){row.state='failed';row.error=e.message;this.warn('部分片段翻译失败，英文原文已保存。');}await this.persist();this.emit({type:'session',session:s});});
   this.queue=job.catch(()=>{});this.jobs.add(job);job.then(()=>this.jobs.delete(job),()=>this.jobs.delete(job));await this.persist();this.emit({type:'session',session:s});if(this.closing)this.finalize();
  }
  if(e.type==='conversation.item.input_audio_transcription.failed'){this.pending=Math.max(0,this.pending-1);this.warn('有一段语音转写失败，课堂记录存在缺失。');if(this.closing)this.finalize();}
  if(e.type==='error'){this.paused=true;this.warn(String(e.error?.message||'实时识别出错').replace(/sk-[\w-]+/g,'[已隐藏]'));this.emit({type:'fatal',message:'实时识别出现错误，请检查提示后重新连接。'});}
 }
 async finalize(timeout=false){
  if(!this.closing||this.finalizing||(!timeout&&this.pending>0))return;this.finalizing=true;clearTimeout(this.finishTimer);clearTimeout(this.limitTimer);clearTimeout(this.connectTimer);
  if(timeout&&this.pending)this.warn('结束时部分语音转写尚未完成，可能缺少最后一段。');
  if(this.upstream){this.upstream.onclose=null;this.upstream.close();}
  this.emit({type:'status',message:'正在完成翻译并生成总结…'});await Promise.allSettled([...this.jobs]);this.session.endedAt=new Date().toISOString();
  try{await complete(this.session);}catch(e){this.warn(e.message+'；原文已保存，可稍后重新生成总结。');}
  this.emit({type:'finished',session:this.session});this.close();
 }
 close(){if(this.closed)return;this.closed=true;this.readyState=3;clearTimeout(this.connectTimer);clearTimeout(this.limitTimer);clearTimeout(this.finishTimer);if(this.upstream){this.upstream.onclose=null;this.upstream.close();}if(this.session){busy.delete(this.session.id);if(!this.finalizing){this.session.status='interrupted';this.persist();}}this.onclose?.();}
}
