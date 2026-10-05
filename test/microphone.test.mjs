import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseLocalMicrophone,openLocalMicrophone,isMobileDevice} from '../src/microphone.js';
const device=(deviceId,label)=>({kind:'audioinput',deviceId,label});
const phone=device('phone','Gengyuan’s iPhone Microphone'),mac=device('mac','MacBook Air Microphone');
function stream(id,label){const t={label,enabled:true,readyState:'live',getSettings:()=>({deviceId:id}),stop(){this.readyState='ended';}};return {track:t,getTracks:()=>[t],getAudioTracks:()=>[t]};}
test('computer built-in input wins over default iPhone, USB, virtual and aliases',()=>{
 const list=[device('default','Default - iPhone'),phone,device('usb','USB Microphone'),device('loop','BlackHole Virtual Microphone'),mac];
 assert.equal(chooseLocalMicrophone(list).deviceId,'mac');
 assert.equal(chooseLocalMicrophone([device('builtin','内置麦克风'),phone]).deviceId,'builtin');
 assert.equal(chooseLocalMicrophone([device('default','Default - MacBook microphone'),phone]),null);
 assert.equal(chooseLocalMicrophone([phone]),null);
});
test('permission already granted: opens only the exact computer microphone',async()=>{
 const calls=[],s=stream('mac',mac.label);
 const result=await openLocalMicrophone({enumerateDevices:async()=>[phone,mac],getUserMedia:async c=>{calls.push(c);return s;}},{mobile:false});
 assert.equal(result,s);assert.equal(calls.length,1);assert.deepEqual(calls[0].audio.deviceId,{exact:'mac'});assert.equal(calls[0].video,false);
});
test('hidden labels: temporary permission stream is muted and stopped before local acquisition',async()=>{
 const probe=stream('phone',phone.label),local=stream('mac',mac.label);let count=0,calls=0;
 const result=await openLocalMicrophone({enumerateDevices:async()=>++count===1?[device('','')]:[phone,mac],getUserMedia:async c=>{if(++calls===1)return probe;assert.equal(probe.track.enabled,false);assert.equal(probe.track.readyState,'ended');assert.deepEqual(c.audio.deviceId,{exact:'mac'});return local;}},{mobile:false});
 assert.equal(result,local);
});
test('missing or lost local device never falls back to the phone or system default',async()=>{
 let calls=0;
 await assert.rejects(()=>openLocalMicrophone({enumerateDevices:async()=>[phone],getUserMedia:async()=>{calls++;}},{mobile:false}),/本机麦克风/);assert.equal(calls,0);
 await assert.rejects(()=>openLocalMicrophone({enumerateDevices:async()=>[phone,mac],getUserMedia:async()=>{calls++;throw Object.assign(new Error(),{name:'OverconstrainedError'});}},{mobile:false}),/本机麦克风/);assert.equal(calls,1);
 const wrong=stream('phone',phone.label);
 await assert.rejects(()=>openLocalMicrophone({enumerateDevices:async()=>[mac],getUserMedia:async()=>wrong},{mobile:false}),/本机麦克风/);assert.equal(wrong.track.readyState,'ended');
});
test('permission probe is cleaned up on failure and permission denial is preserved',async()=>{
 const probe=stream('phone',phone.label);let n=0;
 await assert.rejects(()=>openLocalMicrophone({enumerateDevices:async()=>{if(++n===1)return[];throw new Error('Enumeration failed');},getUserMedia:async()=>probe},{mobile:false}),/Enumeration/);
 assert.equal(probe.track.readyState,'ended');
 await assert.rejects(()=>openLocalMicrophone({enumerateDevices:async()=>[],getUserMedia:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}},{mobile:false}),{name:'NotAllowedError'});
});
test('on the phone itself, its built-in microphone remains eligible',()=>{
 assert.equal(isMobileDevice({userAgent:'Mozilla iPhone',maxTouchPoints:5}),true);
 assert.equal(isMobileDevice({userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0}),false);
 assert.equal(chooseLocalMicrophone([phone],{mobile:true}).deviceId,'phone');
});
