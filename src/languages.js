export const LANGUAGES=[
 {code:'auto',label:'自动识别'}, {code:'en',label:'英语'}, {code:'ja',label:'日语'},
 {code:'ko',label:'韩语'}, {code:'fr',label:'法语'}, {code:'de',label:'德语'},
 {code:'es',label:'西班牙语'}, {code:'it',label:'意大利语'}, {code:'pt',label:'葡萄牙语'},
 {code:'ru',label:'俄语'}, {code:'ar',label:'阿拉伯语'}, {code:'hi',label:'印地语'},
 {code:'th',label:'泰语'}, {code:'vi',label:'越南语'}, {code:'id',label:'印尼语'}, {code:'yue',label:'粤语'}
];
export const validLanguage=code=>LANGUAGES.some(l=>l.code===code);
export const language=code=>LANGUAGES.find(l=>l.code===code)||LANGUAGES.find(l=>l.code==='en');
export const direction=code=>language(code).label+' → 中文';
export function setSessionLanguage(session,code){
 if(!validLanguage(code))throw new Error('请选择支持的语言');
 const previous=language(session.sourceLanguage).code;
 for(const row of session.segments)row.sourceLanguage??=previous;
 session.sourceLanguage=code;
}
export function sessionDirection(s){const codes=[...new Set(s.segments.filter(r=>r.source?.trim()).map(r=>language(r.sourceLanguage||s.sourceLanguage).code))];return (codes.length?codes.map(c=>language(c).label).join(' / '):language(s.sourceLanguage).label)+' → 中文';}
export function transcriptionConfig(code,title){
 const selected=language(code);
 return {model:'gpt-live-transcribe',...(selected.code==='auto'?{}:{languages:[selected.code]}),delay:'low',prompt:'A classroom lecture. Transcribe speech in its original language without translating it. Course: '+String(title||'').slice(0,120)};
}
