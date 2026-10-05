import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {exportPdf} from '../src/pdf-export.js';
import {notesFile,downloadFilename} from '../src/download.js';
import {handle} from '../src/worker.js';

const fontBytes=await readFile(new URL('../public/export-font.ttf',import.meta.url));
const session={title:'经济学：课堂笔记',createdAt:'2026-10-05T10:00:00Z',sourceLanguage:'en',summary:'## 核心知识点\n机会成本是放弃的最佳替代方案的价值。\n- 保留数字：3.14，公式：x² + y² = z²。',materials:[],warnings:[],segments:[{offset:0,source:'Opportunity cost is the value of the next best alternative.',translation:'机会成本是放弃的最佳替代方案的价值。'}]};
test('PDF download is a real document with correct extension, MIME and Chinese title',async()=>{
 const file=await notesFile(session,'pdf',{pdfExporter:s=>exportPdf(s,{fontBytes})});
 assert.equal(file.name,'经济学：课堂笔记.pdf');assert.equal(file.blob.type,'application/pdf');
 const data=new Uint8Array(await file.blob.arrayBuffer());assert.equal(new TextDecoder().decode(data.slice(0,5)),'%PDF-');
 const pdf=await PDFDocument.load(data);assert.equal(pdf.getTitle(),session.title);assert.equal(pdf.getPageCount(),1);
});
test('long bilingual notes paginate and are not truncated',async()=>{
 const long={...session,segments:Array.from({length:100},(_,i)=>({offset:i*1000,source:'A long lecture sentence with details and an unbroken identifier '+('abcdef'.repeat(20)),translation:'课堂中文详细内容，关键概念与例子。'.repeat(8)}))};
 const result=await exportPdf(long,{fontBytes});const pdf=await PDFDocument.load(result);assert.ok(pdf.getPageCount()>10);
 assert.ok(result.length>20000);
});
test('font is served as unmodified binary; existing formats keep their true types',async()=>{
 const response=await handle(new Request('https://example.test/export-font.ttf'));
 assert.equal(response.headers.get('Content-Type'),'font/ttf');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(fontBytes));
 const html=await notesFile(session,'html'),md=await notesFile(session,'md');
 assert.match(html.blob.type,/text\/html/);assert.match(await html.blob.text(),/<!doctype html>/);assert.match(md.blob.type,/text\/markdown/);
 assert.equal(downloadFilename('../lecture.mp4\u202e','pdf'),'-lecture.mp4.pdf');
 await assert.rejects(()=>notesFile(session,'mp4'),/不支持/);
 await assert.rejects(()=>notesFile(session,'pdf',{pdfExporter:()=>{throw new Error('字体加载失败');}}),/字体加载失败/);
});
