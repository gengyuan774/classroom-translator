import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {timestamp,referenceManifest} from './core.js';
import {sessionDirection} from './languages.js';

const PAGE=[595.28,841.89],MARGIN=46,WIDTH=PAGE[0]-MARGIN*2;
const ink=rgb(.12,.20,.17),muted=rgb(.35,.41,.38),green=rgb(.14,.31,.25);
const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/\t/g,'    ');
const plain=value=>clean(value).replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1');
let fontRequest;
async function loadFont(){
 if(!fontRequest)fontRequest=fetch('/export-font.ttf').then(async r=>{if(!r.ok)throw new Error('PDF 字体加载失败，请检查网络后重试。');return new Uint8Array(await r.arrayBuffer());}).catch(e=>{fontRequest=null;throw e;});
 return fontRequest;
}
export async function exportPdf(session,{fontBytes,onProgress=()=>{}}={}){
 const document=await PDFDocument.create();document.registerFontkit(fontkit);
 // Keep the full font: subsetting this composite CJK font drops visible glyphs in PDF readers.
 const font=await document.embedFont(fontBytes||await loadFont());
 const latin=await document.embedFont(StandardFonts.Helvetica);
 const symbols=await document.embedFont(StandardFonts.Symbol);
 const supported=new Set(font.getCharacterSet()),latinSupported=new Set(latin.getCharacterSet()),symbolSupported=new Set(symbols.getCharacterSet());
 document.setTitle(clean(session.title));document.setAuthor('课堂译记');document.setSubject('课堂总结与双语记录');
 let page,y,pages=0;
 const canvas=typeof window!=='undefined'?window.document.createElement('canvas'):null;
 const context=canvas?.getContext('2d');
 const useFont=char=>latinSupported.has(char.codePointAt(0))?latin:supported.has(char.codePointAt(0))?font:symbolSupported.has(char.codePointAt(0))?symbols:null;
 const hasMissing=text=>[...text].some(c=>!useFont(c));
 function measure(text,size){
  if(hasMissing(text)){
   if(!context)throw new Error('此文字需要浏览器字体支持');
   context.font=`${size}px sans-serif`;return context.measureText(text).width;
  }
  return [...text].reduce((n,c)=>n+useFont(c).widthOfTextAtSize(c,size),0);
 }
 async function draw(text,x,baseline,size,color=ink){
  if(!text)return;
  if(hasMissing(text)){
   const width=measure(text,size),scale=3;
   canvas.width=Math.ceil((width+4)*scale);canvas.height=Math.ceil(size*1.8*scale);
   context.scale(scale,scale);context.font=`${size}px sans-serif`;context.fillStyle='#263d34';context.textBaseline='alphabetic';context.fillText(text,0,size*1.3);
   const png=await document.embedPng(canvas.toDataURL('image/png'));
   page.drawImage(png,{x,y:baseline-size*.5,width:canvas.width/scale,height:canvas.height/scale});return;
  }
  let active=null,run='';
  const flush=()=>{if(run){page.drawText(run,{x,y:baseline,size,font:active,color});x+=active.widthOfTextAtSize(run,size);run='';}};
  for(const char of text){const next=useFont(char);if(next!==active){flush();active=next;}run+=char;}flush();
 }
 function newPage(){page=document.addPage(PAGE);y=PAGE[1]-MARGIN;pages++;onProgress(pages);}
 function ensure(height){if(y-height<MARGIN+20)newPage();}
 function lines(text,size,width){
  const output=[];
  for(const paragraph of clean(text).split(/\r?\n/)){
   let line='';
   // Wrap at word boundaries; long words and CJK still fit the page.
   const tokens=paragraph.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\s+|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)||[''];
   for(const token of tokens){
    if(measure(line+token,size)<=width){line+=token;continue;}
    if(line.trim()){output.push(line.trimEnd());line='';}
    if(!token.trim())continue;
    if(measure(token,size)<=width){line=token;continue;}
    for(const {segment:char} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(token)){
     if(line&&measure(line+char,size)>width){output.push(line);line='';}line+=char;
    }
   }
   output.push(line.trimEnd());
  }
  return output;
 }
 async function paragraph(text,{size=11,leading=18,color=ink,indent=0,gap=7,heading=false}={}){
  const wrapped=lines(text,size,WIDTH-indent);
  ensure(heading?leading*2+10:leading);
  for(const line of wrapped){ensure(leading);await draw(line,MARGIN+indent,y-size,size,color);y-=leading;}
  y-=gap;
 }
 async function heading(text,size=16){y-=8;await paragraph(text,{size,leading:size+10,color:green,gap:8,heading:true});}
 async function markdown(text){
  for(const line of clean(text).split(/\r?\n/)){
   if(!line.trim()){y-=4;continue;}
   if(/^```/.test(line))continue;
   const h=line.match(/^#{1,6}\s+(.+)/);
   if(h)await heading(plain(h[1]),13);
   else await paragraph(plain(line).replace(/^[-*]\s+/,'• ').replace(/^>\s?/,''),{indent:/^\s*[-*]\s/.test(line)?10:0});
  }
 }
 newPage();await paragraph(clean(session.title)||'课堂笔记',{size:22,leading:32,color:green,gap:12,heading:true});
 const date=new Date(session.createdAt);await paragraph((Number.isNaN(date.getTime())?clean(session.createdAt):date.toLocaleString('zh-CN'))+'  |  '+sessionDirection(session)+(session.demo?'  |  演示课堂':''),{size:9,leading:15,color:muted});
 await heading('课堂总结');await markdown(session.summary||'尚未生成总结。');
 const references=referenceManifest(session);if(references){await heading('参考资料',13);await markdown(references.replace(/^参考资料：\n/,''));}
 if(session.warnings?.length){await heading('记录提示',13);for(const warning of session.warnings)await paragraph(clean(warning),{color:muted});}
 const segments=session.segments.filter(s=>s.source?.trim()||s.translation?.trim()||s.error);
 if(segments.length){await heading('原文与中文对照记录');for(const segment of segments){
  ensure(60);await paragraph(timestamp(segment.offset),{size:9,leading:14,color:muted,gap:4});
  if(segment.source?.trim())await paragraph(clean(segment.source),{color:muted});
  if(segment.translation?.trim())await paragraph(clean(segment.translation));
  if(segment.error)await paragraph('提示：'+clean(segment.error),{size:9,leading:15,color:muted});y-=6;
 }}
 const all=document.getPages();for(let index=0;index<all.length;index++){
  page=all[index];page.drawLine({start:{x:MARGIN,y:40},end:{x:PAGE[0]-MARGIN,y:40},thickness:.5,color:rgb(.83,.86,.83)});
  await draw('课堂译记',MARGIN,26,9,muted);const label=`${index+1} / ${all.length}`;await draw(label,PAGE[0]-MARGIN-measure(label,9),26,9,muted);
 }
 return document.save();
}
