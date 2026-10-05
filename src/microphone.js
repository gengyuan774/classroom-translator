const AUDIO={channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true};
const alias=id=>!id||id==='default'||id==='communications';
const remote=/iphone|ipad|android|continuity|接力|连续互通|連續互通|连系互通|連繫互通|手机|手機|droidcam|iriun|epoccam|camo/i;
const virtual=/virtual|loopback|blackhole|soundflower|stereo mix|立体声混音|虚拟|虛擬/i;
const builtIn=/built[ -]?in|internal|内置|內置|内建|內建|macbook|imac|microphone array|麦克风阵列|麥克風陣列/i;
const localInput=/microphone|麦克风|麥克風|usb|headset|耳机|耳機|airpods|realtek/i;
export function isMobileDevice(nav){return nav.userAgentData?.mobile===true||/Android|iPhone|iPad|iPod/i.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);}
export function chooseLocalMicrophone(devices,{mobile=false}={}){
 return devices.filter(d=>d.kind==='audioinput'&&!alias(d.deviceId)&&d.label&&!virtual.test(d.label)&&(!remote.test(d.label)||mobile&&!/continuity|接力|互通|droidcam|iriun|epoccam|camo/i.test(d.label)))
  .map(d=>({device:d,rank:builtIn.test(d.label)||(mobile&&/iphone|ipad|android/i.test(d.label))?100:localInput.test(d.label)?30:0}))
  .filter(d=>d.rank>0).sort((a,b)=>b.rank-a.rank)[0]?.device||null;
}
const stop=stream=>stream?.getTracks().forEach(track=>track.stop());
const unavailable=()=>new Error('未找到可用的本机麦克风。请在电脑“声音 → 输入”中选择内置或已连接的麦克风，并允许浏览器访问后重试。');
export async function openLocalMicrophone(mediaDevices=navigator.mediaDevices,{mobile=isMobileDevice(navigator)}={}){
 if(!mediaDevices?.getUserMedia||!mediaDevices?.enumerateDevices)throw new Error('当前浏览器不支持麦克风访问，请使用 Chrome 或 Safari。');
 let devices=await mediaDevices.enumerateDevices(),selected=chooseLocalMicrophone(devices,{mobile});
 if(!selected&&!devices.some(d=>d.kind==='audioinput'&&d.label)){
  // Before permission, browsers hide hardware names. This permission-only stream
  // is muted and closed before any audio processing or network connection exists.
  const probe=await mediaDevices.getUserMedia({audio:AUDIO,video:false});
  try{probe.getAudioTracks().forEach(t=>t.enabled=false);devices=await mediaDevices.enumerateDevices();selected=chooseLocalMicrophone(devices,{mobile});}
  finally{stop(probe);}
 }
 if(!selected)throw unavailable();
 let stream;
 try{stream=await mediaDevices.getUserMedia({audio:{...AUDIO,deviceId:{exact:selected.deviceId}},video:false});}
 catch(error){if(['NotFoundError','OverconstrainedError','NotReadableError'].includes(error.name))throw unavailable();throw error;}
 const track=stream.getAudioTracks()[0],actualId=track?.getSettings().deviceId;
 if(!track||track.readyState==='ended'||(!mobile&&remote.test(track.label))||(actualId&&actualId!==selected.deviceId)){
  stop(stream);throw unavailable();
 }
 return stream;
}
