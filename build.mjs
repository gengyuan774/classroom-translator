import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
await mkdir('dist/client',{recursive:true});await mkdir('dist/server',{recursive:true});
for(const name of await readdir('public'))await copyFile('public/'+name,'dist/client/'+name);
await build({entryPoints:['src/app.js'],outfile:'dist/client/app.js',external:['/pdf-export.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
await build({entryPoints:['src/pdf-export.js'],outfile:'dist/client/pdf-export.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
await build({entryPoints:['src/parser-worker.js'],outfile:'dist/client/parser-worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/client/pdf.worker.min.mjs');
const assets={};for(const name of await readdir('dist/client')){
 const bytes=await readFile('dist/client/'+name),binary=name.endsWith('.ttf');
 assets[name==='index.html'?'/':'/'+name]={...(binary?{base64:bytes.toString('base64')}:{text:bytes.toString('utf8')}),type:binary?'font/ttf':name.endsWith('.js')||name.endsWith('.mjs')?'application/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.txt')?'text/plain; charset=utf-8':'text/html; charset=utf-8'};
}
await writeFile('src/generated-assets.js','export default '+JSON.stringify(assets)+';');
await build({entryPoints:['src/worker.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'neutral',target:'es2022',minify:true,legalComments:'none'});
console.log('Browser app and Cloudflare Worker built.');
