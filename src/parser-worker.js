import {extractMaterial} from './material-parser.js';
import {Buffer} from 'buffer';
self.onmessage=async({data})=>{try{self.postMessage({result:await extractMaterial(Buffer.from(data.buffer),data.name)});}catch(e){self.postMessage({error:e.message});}};
