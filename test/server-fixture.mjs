import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function environment(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const DB={prepare(query){return {bind(...args){const st=sql.prepare(query);return {async first(){return st.get(...args)||null;},async all(){return {results:st.all(...args)};},async run(){return st.run(...args);}};}};},async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,env:{DB,MEMBER_CODE:'test-member-code',MEMBER_SESSION_SECRET:'test-signing-secret',OPENAI_API_KEY:'sk-test-server-only-secret',MEMBER_DAILY_TEXT_LIMIT:'2'}};
}
export function req(path,body,cookie='',headers={}){return new Request('https://example.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://example.test',Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});}
