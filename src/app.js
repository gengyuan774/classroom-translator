import {renderNotes} from '../public/format.js';
import {localApi,downloadNotes} from './local-api.js';
import {BrowserLive} from './live.js';
const $=id=>document.getElementById(id);
let config, current=null, ws=null, stream=null, context=null, capture=null, muted=null, mode='idle', startedAt=0, elapsed=0, tick;
let materialBusy=false;
let flushResolver, wakeLock, partials=new Map(), lastEnded=false;
const escape=s=>String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=ms=>{const s=Math.max(0,Math.floor(ms/1000));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':');};
function notice(text){$('message').textContent=text;$('message').hidden=!text;}
async function api(path,options={}){return localApi(path,options);}
function controls(next){
 mode=next;const recording=mode==='recording',busy=['connecting','finishing'].includes(mode),live=['recording','paused'].includes(mode);
 $('start').hidden=live || mode==='finishing';$('start').disabled=busy;$('start').textContent=mode==='connecting'?'正在连接…':current?.segments.length&&!current.demo?'继续这节课':'● 开始上课';
 $('pause').hidden=!live;$('pause').textContent=mode==='paused'?'▶ 继续录音':'Ⅱ 暂停';$('finish').hidden=!live && mode!=='finishing';$('finish').disabled=mode==='finishing';
 $('new-class').disabled=busy||live||materialBusy;$('demo').disabled=busy||live||materialBusy;$('title').disabled=busy||live||!!current;
 $('status-dot').classList.toggle('live',recording);document.querySelector('.meter').classList.toggle('live',recording);
 $('status').textContent=({idle:'准备就绪',connecting:'连接中',recording:'正在听课',paused:'已暂停',finishing:'正在整理课堂',ended:'课堂已结束'})[mode];
 $('status-detail').textContent=recording?'麦克风已开启 · 正在接收英语语音':mode==='paused'?'点击继续录音，接着记录课堂':mode==='finishing'?'请保持页面打开，笔记正在生成':'使用电脑麦克风 · 英语 → 中文';
 $('retry-summary').disabled=busy||live||materialBusy;updateMaterialControls();
}
function render(){
 if(!current)return;
 $('breadcrumb-title').textContent=current.title;$('title').value=current.title;$('segment-count').textContent=`${current.segments.length} 段`;
 if(current.segments.length){
 const container=$('transcript');const nearBottom=container.scrollHeight-container.scrollTop-container.clientHeight<90;
 container.innerHTML=current.segments.map(s=>`<article class="segment"><time>${time(s.offset)}</time><p class="source">${escape(s.source || '正在识别…')}</p><p class="${s.translation?'translation':'pending'}">${escape(s.translation || (s.error?'翻译未完成':'正在翻译…'))}</p>${s.error?`<p class="error">${escape(s.error)}</p>`:''}</article>`).join('');
 if($('autoscroll').checked && nearBottom)container.scrollTop=container.scrollHeight;
 }
 $('summary').hidden=!current.summary;$('summary-empty').hidden=!!current.summary;$('summary').innerHTML=renderNotes(current.summary);
 $('summary-badge').textContent=current.demo?'示例笔记':current.summary?'已生成':current.status==='summary_failed'?'需重试':current.status==='summarizing'?'生成中':'待生成';
 $('export-md').disabled=!current.segments.length&&!current.summary;$('export-html').disabled=$('export-md').disabled;
 $('retry-summary').hidden=(!current.segments.some(s=>s.source)&&!current.materials?.some(m=>m.enabled!==false))||['recording','connecting','finishing'].includes(mode);$('retry-summary').textContent=current.segments.some(s=>s.source)?'重新生成总结':'生成资料预习总结';renderMaterials();if(current.summaryStale)$('summary-badge').textContent='资料已更新 · 待重新总结';
 $('save-state').textContent=current.demo?'演示数据 · 不调用 API':'已保存在当前浏览器';
 const warnings=current.warnings || [];if(warnings.length)notice(warnings.at(-1));
}
async function history(){
 const list=await api('/api/sessions');$('history-count').textContent=list.length;$('history-select').innerHTML='<option value="">历史课堂</option>'+list.map(s=>`<option value="${s.id}">${escape(s.title)}</option>`).join('');
 $('history').innerHTML=list.length?list.map(s=>`<button class="history-item ${s.id===current?.id?'active':''}" data-id="${s.id}"><strong>${s.demo?'◌':'▤'} ${escape(s.title)}</strong><small>${new Date(s.createdAt).toLocaleDateString('zh-CN')} · ${s.count} 段${s.demo?' · 示例':''}</small></button>`).join(''):'<div class="history-empty">每一节课，都值得留下。<br>你的课堂记录会出现在这里。</div>';
}
function blank(){if(materialBusy)return;current=null;renderMaterials();partials.clear();$('transcript').innerHTML=initialEmpty;$('title').value='';$('breadcrumb-title').textContent='新的开始';$('segment-count').textContent='0 段';$('summary').hidden=true;$('summary-empty').hidden=false;$('summary-badge').textContent='待生成';$('export-md').disabled=true;$('export-html').disabled=true;$('retry-summary').hidden=true;$('timer').textContent='00:00:00';$('partial').hidden=true;$('save-state').textContent='字幕将自动保存在本机';elapsed=0;notice('');controls('idle');history().catch(e=>notice(e.message));}
async function releaseAudio(){
 stream?.getTracks().forEach(t=>t.stop());stream=null;
 capture?.disconnect();muted?.disconnect();capture=null;muted=null;
 if(context && context.state!=='closed')await context.close();context=null;
 clearInterval(tick);await wakeLock?.release().catch(()=>{});wakeLock=null;
 document.querySelectorAll('.meter i').forEach(i=>i.style.height='');
}
function send(value){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));}
async function flush(){
 if(!capture || context?.state!=='running')return;
 await new Promise(resolve=>{const timer=setTimeout(()=>{flushResolver=null;resolve();},1500);flushResolver=()=>{clearTimeout(timer);resolve();};capture.port.postMessage('flush');});
}
async function begin(){
 if(!config.hasKey){$('settings').showModal();return;}
 notice('');lastEnded=false;controls('connecting');
 try{
   stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   context=new AudioContext({sampleRate:24000});await context.resume();
   if(context.sampleRate!==24000)throw new Error('当前浏览器不支持所需的音频采样率，请使用 Chrome。');
   await context.audioWorklet.addModule('/pcm-worklet.js');
   capture=new AudioWorkletNode(context,'pcm-capture');muted=context.createGain();muted.gain.value=0;
   context.createMediaStreamSource(stream).connect(capture);capture.connect(muted).connect(context.destination);
   capture.port.onmessage=({data})=>{
     if(data.flushed){flushResolver?.();flushResolver=null;return;}
     if(data.audio && ws?.readyState===WebSocket.OPEN && mode==='recording'){
       if(ws.bufferedAmount>512000){pauseRecording();notice('网络发送拥堵，已暂停录音。请检查连接后继续。');return;}
       ws.send(data.audio);
       const samples=new Int16Array(data.audio);let energy=0;for(const x of samples)energy+=(x/32768)**2;const level=Math.min(1,Math.sqrt(energy/samples.length)*8);
       document.querySelectorAll('.meter i').forEach((bar,i)=>bar.style.height=(4+level*(10+Math.sin(i*2.1)*8))+'px');
     }
   };
   if(!current)current=await api('/api/sessions',{method:'POST',body:JSON.stringify({title:$('title').value.trim()||'课堂 '+new Date().toLocaleDateString('zh-CN')})});
   render();await history();
   ws=new BrowserLive();
   ws.onopen=()=>send({type:'start',id:current.id});
   ws.onmessage=async({data})=>{
     const e=JSON.parse(data);
     if(e.type==='ready'){
       capture?.port.postMessage('resume');stream?.getAudioTracks().forEach(t=>t.enabled=true);controls('recording');startedAt=Date.now();clearInterval(tick);tick=setInterval(()=>{$('timer').textContent=time(elapsed+Date.now()-startedAt);},1000);
       try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}
     }
     if(e.type==='delta'){partials.set(e.id,(partials.get(e.id)||'')+e.delta);renderPartial();}
     if(e.type==='session'){current=e.session;for(const s of current.segments)if(s.source)partials.delete(s.id);renderPartial();render();}
     if(e.type==='warning')notice(e.message);
     if(e.type==='status'){$('status-detail').textContent=e.message;}
     if(e.type==='paused'){$('status-detail').textContent='麦克风已暂停 · 字幕已保存';}
     if(['disconnected','limit','fatal'].includes(e.type)){
       if(mode==='recording'){elapsed+=Date.now()-startedAt;clearInterval(tick);}
       stream?.getAudioTracks().forEach(t=>t.enabled=false);
       if(e.type==='fatal'&&mode==='connecting'){await releaseAudio();ws?.close();controls('idle');}
       else {capture?.port.postMessage('flush');controls('paused');}
       notice(e.message||'连接已断开。已保存收到的字幕，点击继续录音重连。');
     }
     if(e.type==='finished'){
       lastEnded=true;current=e.session;await releaseAudio();partials.clear();renderPartial();controls('ended');render();await history();
       if(current.summary && $('auto-export').checked)download('md');
       if(current.summary)notice('课堂已整理完成，笔记已保存在当前浏览器。'+($('auto-export').checked?' 已发起下载；如未看到文件，可点击下方导出按钮。':''));
     }
   };
   ws.onerror=()=>notice('连接失败，请检查网络后重试。');
   ws.onclose=async()=>{
     if(!lastEnded && ['recording','connecting','paused','finishing'].includes(mode)){
       if(mode==='recording')elapsed+=Date.now()-startedAt;
       await releaseAudio();controls('idle');notice('连接中断，已收到的字幕保留在本机。可继续这节课，或重新生成总结。');
       try{current=await api('/api/sessions/'+current.id);render();}catch{}
     }
   };
 }catch(e){await releaseAudio();controls('idle');notice(e.name==='NotAllowedError'?'未获得麦克风权限，请在浏览器地址栏中允许麦克风，然后重新开始。':e.message);}
}
function renderPartial(){const text=[...partials.values()].join(' ');$('partial').textContent=text?'正在识别 · '+text:'';$('partial').hidden=!text;}
async function pauseRecording(){
 if(mode==='recording'){
   $('pause').disabled=true;await flush();$('pause').disabled=false;send({type:'pause'});elapsed+=Date.now()-startedAt;clearInterval(tick);stream?.getAudioTracks().forEach(t=>t.enabled=false);controls('paused');
 }else if(mode==='paused'){
   notice('');if(ws?.readyState===WebSocket.OPEN){controls('connecting');send({type:'resume'});}else await begin();
 }
}
async function finish(){
 if(!current)return;
 $('finish').disabled=true;$('pause').disabled=true;if(mode==='recording'){await flush();elapsed+=Date.now()-startedAt;}$('pause').disabled=false;
 controls('finishing');await releaseAudio();send({type:'finish'});
}
function download(format){if(current)downloadNotes(current,format);}
function materialLocked(){return materialBusy||['recording','paused','connecting','finishing'].includes(mode);}
function updateMaterialControls(){
 const locked=materialLocked();$('material-add').disabled=locked;$('try-open').disabled=locked||!!current?.demo;
 $('start').disabled=locked&&mode!=='recording'&&mode!=='paused';
 document.querySelectorAll('[data-material-action]').forEach(b=>b.disabled=locked);
 $('material-drop').classList.toggle('locked',locked);
}
function renderMaterials(){
 const materials=current?.materials||[];$('material-count').textContent=`${materials.length} 份`;
 $('material-list').innerHTML=materials.map(m=>`<div class="material-item"><label><input type="checkbox" data-material-action="toggle" data-id="${m.id}" ${m.enabled!==false?'checked':''} aria-label="参考 ${escape(m.name)}"><span><strong>${escape(m.name)}</strong><small>${m.pageCount} 页/段 · ${m.characters.toLocaleString()} 字符${m.enabled===false?' · 已停用':''}</small></span></label><div><button data-material-action="preview" data-id="${m.id}">预览</button><button data-material-action="remove" data-id="${m.id}" aria-label="移除 ${escape(m.name)}">移除</button></div>${m.warnings?.length?`<p>${escape(m.warnings.join(' '))}</p>`:''}</div>`).join('');
 updateMaterialControls();
}
async function ensureClass(){
 if(!current){current=await api('/api/sessions',{method:'POST',body:JSON.stringify({title:$('title').value.trim()||'课堂 '+new Date().toLocaleDateString('zh-CN')})});render();await history();}
 return current;
}
async function uploadMaterials(files){
 if(materialLocked()||!files.length)return;
 if(current?.demo){notice('演示课堂使用固定内容，请新建课堂后导入自己的资料。');return;}
 materialBusy=true;controls(mode);const errors=[];
 try{
   await ensureClass();
   for(let i=0;i<files.length;i++){
     const file=files[i];$('material-progress').hidden=false;$('material-progress').textContent=`正在导入 ${i+1}/${files.length}：${file.name}…`;
     try{if(file.size>20*1024*1024)throw new Error('文件超过 20 MB');current=await api(`/api/sessions/${current.id}/materials`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});render();}catch(e){errors.push(`${file.name}：${e.message}`);}
   }
   await history();notice(errors.length?errors.join('；'):'资料已导入。可预览识别到的内容，或点击“试译与总结”检查效果。');
 }catch(e){notice(e.message);}finally{materialBusy=false;$('material-progress').hidden=true;$('material-files').value='';controls(mode);renderMaterials();}
}
$('material-add').onclick=()=>$('material-files').click();
$('material-files').onchange=e=>uploadMaterials([...e.target.files]);
$('material-drop').ondragover=e=>{e.preventDefault();if(!materialLocked())$('material-drop').classList.add('dragging');};
$('material-drop').ondragleave=()=>$('material-drop').classList.remove('dragging');
$('material-drop').ondrop=e=>{e.preventDefault();$('material-drop').classList.remove('dragging');uploadMaterials([...e.dataTransfer.files]);};
$('material-list').onclick=async e=>{
 const button=e.target.closest('[data-material-action]');if(!button||materialLocked())return;
 const action=button.dataset.materialAction,id=button.dataset.id;
 if(action==='preview'){
   try{const m=await api(`/api/sessions/${current.id}/materials/${id}`);$('preview-title').textContent=m.name;$('preview-warning').textContent=m.warnings.join(' ');$('preview-content').innerHTML=m.pages.map(p=>`<section><h3>${escape(p.label)}</h3><pre>${escape(p.text||'此页没有可提取的文字')}</pre></section>`).join('');$('material-preview').showModal();}catch(e){notice(e.message);}return;
 }
 materialBusy=true;controls(mode);
 try{current=await api(`/api/sessions/${current.id}/materials/${id}`,action==='remove'?{method:'DELETE'}:{method:'PATCH',body:JSON.stringify({enabled:button.checked})});render();notice(current.summaryStale?'资料已更新，请重新生成总结以应用新资料。':'参考资料已更新。');}catch(e){notice(e.message);}finally{materialBusy=false;controls(mode);renderMaterials();}
};
$('preview-close').onclick=()=>$('material-preview').close();
function showTrial(result){
 $('trial-result').hidden=!result;if(!result)return;
 $('trial-translation').textContent=result.translation;$('trial-references').textContent=result.references?.length?'检索到的参考段落：'+result.references.map(r=>r.name+' · '+r.label).join('；'):'未使用参考资料';$('trial-summary').innerHTML=renderNotes(result.summary);
}
$('try-open').onclick=()=>{
 $('trial-status').hidden=true;$('trial-input').value=current?.lastTrial?.source||'';showTrial(current?.lastTrial);
 const names=(current?.materials||[]).filter(m=>m.enabled!==false).map(m=>m.name);$('trial-context').textContent=names.length?'参考：'+names.join('、'):'当前未导入参考资料';$('trial-dialog').showModal();
};
$('trial-close').onclick=()=>{if(!materialBusy)$('trial-dialog').close();};
$('trial-dialog').addEventListener('cancel',e=>{if(materialBusy)e.preventDefault();});
$('trial-run').onclick=async()=>{
 if(materialBusy)return;
 const text=$('trial-input').value.trim();if(!text){$('trial-status').hidden=false;$('trial-status').textContent='先输入一段英语课堂内容。';return;}
 if(!config.hasKey){$('trial-dialog').close();$('settings').showModal();return;}
 materialBusy=true;controls(mode);$('trial-run').disabled=true;$('trial-close').disabled=true;$('trial-input').disabled=true;$('trial-status').hidden=false;$('trial-status').textContent='正在参考资料生成译文与总结…';showTrial(null);
 try{await ensureClass();const result=await api(`/api/sessions/${current.id}/try`,{method:'POST',body:JSON.stringify({text})});current.lastTrial=result;showTrial(result);$('trial-status').textContent='试译完成，结果已保存在这节课中。测试内容未加入课堂字幕。';}catch(e){$('trial-status').textContent=e.message;}finally{materialBusy=false;controls(mode);$('trial-run').disabled=false;$('trial-close').disabled=false;$('trial-input').disabled=false;}
};
const initialEmpty=$('transcript').innerHTML;
$('new-class').onclick=blank;$('start').onclick=begin;$('pause').onclick=pauseRecording;$('finish').onclick=finish;
$('mobile-settings').onclick=$('settings-open').onclick=$('setup-open').onclick=()=>{$('settings-error').textContent='';$('settings').showModal();};
$('settings-close').onclick=()=>{$('api-key').value='';$('settings').close();};
$('settings-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/config',{method:'POST',body:JSON.stringify({key:$('api-key').value})});config.hasKey=true;$('api-key').value='';$('settings').close();$('setup-hint').hidden=true;notice('连接设置已保存。开始录音时将验证 API 权限。');}catch(e){$('settings-error').textContent=e.message;}};
$('demo').onclick=async()=>{try{current=await api('/api/sessions',{method:'POST',body:JSON.stringify({demo:true})});controls('ended');render();$('start').hidden=true;notice('这是演示课堂：使用示例字幕与笔记，不采集麦克风，不调用 API。');await history();}catch(e){notice(e.message);}};
async function openHistory(id){if(!id)return;if(materialBusy||['recording','paused','connecting','finishing'].includes(mode)){notice('请先完成当前操作或结束课堂，再打开其他记录。');return;}try{current=await api('/api/sessions/'+id);$('transcript').innerHTML=initialEmpty;controls(current.status==='ready'?'idle':'ended');elapsed=0;notice('');render();if(current.demo)$('start').hidden=true;await history();}catch(e){notice(e.message);}};
$('history').onclick=e=>openHistory(e.target.closest('[data-id]')?.dataset.id);
$('history-select').onchange=e=>openHistory(e.target.value);
$('retry-summary').onclick=async()=>{if(!current)return;if(!config.hasKey&&(!current.demo||current.materials?.length)){$('settings').showModal();return;}controls('finishing');notice('正在重新整理课堂笔记…');try{current=await api(`/api/sessions/${current.id}/summary`,{method:'POST'});controls('ended');render();if(current.demo)$('start').hidden=true;if($('auto-export').checked)download('md');notice('总结已生成，完整笔记已保存在当前浏览器。');}catch(e){controls('ended');notice(e.message);render();}};
$('export-md').onclick=()=>download('md');$('export-html').onclick=()=>download('html');
window.addEventListener('beforeunload',e=>{if(materialBusy||['recording','paused','connecting','finishing'].includes(mode)){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&mode==='recording')try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}});
try{config=await api('/api/config');$('setup-hint').hidden=config.hasKey;$('model-info').textContent=`实时转写：${config.transcriptionModel}　翻译 / 总结：${config.textModel}`;await history();renderMaterials();}catch(e){notice('无法打开浏览器存储：'+e.message);$('start').disabled=true;}
