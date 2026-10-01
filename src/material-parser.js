import {unzipSync, strFromU8} from 'fflate';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import path from 'path-browserify';
import {Buffer} from 'buffer';
export const MAX_FILE_BYTES=20*1024*1024;
const MAX_TEXT=200000, MAX_PAGES=300;
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false,processEntities:true});
function xml(text){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('资料包含不支持的 XML 声明');if(XMLValidator.validate(text)!==true)throw new Error('文档结构损坏，无法读取');return parser.parse(text);}
function nodes(tree,tag){const found=[];for(const item of tree||[])for(const [key,value] of Object.entries(item)){if(key===tag)found.push({children:value,attrs:item[':@']||{}});if(Array.isArray(value))found.push(...nodes(value,tag));}return found;}
function textContent(tree){return (tree||[]).map(item=>Object.entries(item).map(([key,value])=>key==='#text'?String(value):Array.isArray(value)?textContent(value):'').join('')).join('');}
function paragraphs(tree,prefix){return nodes(tree,prefix+':p').map(p=>nodes(p.children,prefix+':t').map(t=>textContent(t.children)).join('')).filter(Boolean).join('\n');}
function officeFiles(buffer){let total=0,count=0;return unzipSync(new Uint8Array(buffer),{filter:file=>{
 if(++count>5000)throw new Error('文档内部文件过多');
 const needed=/^(ppt\/(slides|notesSlides)\/[^/]+\.xml|ppt\/(slides|notesSlides)\/_rels\/[^/]+\.rels|ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml\.rels|word\/(document|footnotes|endnotes)\.xml)$/.test(file.name);
 if(needed){total+=file.originalSize;if(file.originalSize>8*1024*1024||total>24*1024*1024)throw new Error('文档解压后过大，请拆分后导入');}
 return needed;
}});}
function relationships(files,name){if(!files[name])return [];return nodes(xml(strFromU8(files[name])),'Relationship').map(x=>({id:x.attrs['@_Id'],target:x.attrs['@_Target'],type:x.attrs['@_Type'],external:x.attrs['@_TargetMode']==='External'}));}
function targetPath(base,target){return target?.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(base,target||''));}
export async function extractMaterial(buffer,name){
 if(!buffer.length)throw new Error('文件为空');if(buffer.length>MAX_FILE_BYTES)throw new Error('每份资料最大 20 MB');
 const ext=path.extname(name).toLowerCase();let pages=[],warnings=[];
 if(['.txt','.md','.markdown'].includes(ext)){
   let text;try{const encoding=buffer[0]===255&&buffer[1]===254?'utf-16le':buffer[0]===254&&buffer[1]===255?'utf-16be':'utf-8';text=new TextDecoder(encoding,{fatal:true}).decode(buffer);}catch{throw new Error('文本编码无法读取，请另存为 UTF-8 后导入');}
   if(text.includes('\0'))throw new Error('这不是可读取的文本文件');
   if(text.length>MAX_TEXT)throw new Error('文本超过 20 万字符，请拆分后导入');
   for(let i=0;i<text.length;i+=3000)pages.push({label:`第 ${Math.floor(i/3000)+1} 段`,text:text.slice(i,i+3000)});
 }else if(ext==='.pptx'||ext==='.docx'){
   let files;try{files=officeFiles(buffer);}catch(e){throw new Error('无法读取 Office 文档：'+e.message);}
   if(ext==='.pptx'){
     if(!files['ppt/presentation.xml'])throw new Error('文件不是有效的 PPTX，请使用 PowerPoint 重新保存');
     const rels=relationships(files,'ppt/_rels/presentation.xml.rels');
     const slides=nodes(xml(strFromU8(files['ppt/presentation.xml'])),'p:sldId').map(n=>rels.find(r=>r.id===n.attrs['@_r:id']&&!r.external)).map(r=>r&&targetPath('ppt',r.target));
     if(slides.length>MAX_PAGES)throw new Error('幻灯片超过 300 页，请拆分后导入');
     for(let i=0;i<slides.length;i++){
       const file=slides[i];if(!file||!files[file])throw new Error('PPTX 的幻灯片引用损坏');
       let text=paragraphs(xml(strFromU8(files[file])),'a');
       const rel=relationships(files,path.posix.join(path.posix.dirname(file),'_rels',path.posix.basename(file)+'.rels')).find(r=>r.type?.endsWith('/notesSlide')&&!r.external);
       if(rel){const notes=files[targetPath(path.posix.dirname(file),rel.target)];if(notes){const note=paragraphs(xml(strFromU8(notes)),'a');if(note.trim())text+='\n讲者备注：\n'+note;}}
       pages.push({label:`第 ${i+1} 页`,text});
     }
     warnings.push('已读取幻灯片文字和讲者备注；图片、图表及公式的视觉内容未解析。');
   }else{
     if(!files['word/document.xml'])throw new Error('文件不是有效的 DOCX');
     const text=['word/document.xml','word/footnotes.xml','word/endnotes.xml'].filter(n=>files[n]).map(n=>paragraphs(xml(strFromU8(files[n])),'w')).join('\n');
     for(let i=0;i<text.length;i+=3000)pages.push({label:`第 ${Math.floor(i/3000)+1} 段`,text:text.slice(i,i+3000)});
     warnings.push('已读取正文、表格文字和脚注；图片及公式的视觉内容未解析。');
   }
 }else if(ext==='.pdf'){
   if(!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('文件不是有效的 PDF');
   const {getDocument,GlobalWorkerOptions}=await import('pdfjs-dist/build/pdf.mjs');GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
   const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true,disableFontFace:true,verbosity:0});
   try{
     const doc=await task.promise;if(doc.numPages>MAX_PAGES)throw new Error('PDF 超过 300 页，请拆分后导入');
     for(let i=1;i<=doc.numPages;i++){
       const page=await doc.getPage(i), content=await page.getTextContent();
       pages.push({label:`第 ${i} 页`,text:content.items.filter(x=>'str' in x).map(x=>x.str+(x.hasEOL?'\n':' ')).join('')});page.cleanup();
       if(pages.reduce((n,p)=>n+p.text.length,0)>MAX_TEXT)throw new Error('资料文字超过 20 万字符，请拆分后导入');
     }
   }catch(e){if(e.name==='PasswordException')throw new Error('PDF 已加密，请先解锁再导入');throw e;}finally{await task.destroy();}
   warnings.push('仅读取 PDF 的文字层；扫描图片、图表和公式图片未解析。');
 }else if(ext==='.ppt'||ext==='.doc'){throw new Error('旧版 PPT/DOC 请先另存为 PPTX/DOCX 或 PDF 后导入');}
 else throw new Error('支持 PPTX、PDF、DOCX、TXT 和 Markdown 文件');
 pages=pages.map(p=>({...p,text:p.text.replace(/\r/g,'').trim()}));
 const missing=pages.filter(p=>!p.text).map(p=>p.label);
 if(missing.length)warnings.push(`未提取到文字：${missing.slice(0,15).join('、')}${missing.length>15?' 等':''}。这些页面可能只有图片。`);
 const characters=pages.reduce((n,p)=>n+p.text.length,0);
 if(!characters)throw new Error('未找到可提取的文字；若为扫描件或图片课件，请先 OCR 或导出带文字层的文件');
 if(characters>MAX_TEXT)throw new Error('资料文字超过 20 万字符，请拆分后导入');
 return {pages,warnings,characters,pageCount:pages.length};
}
