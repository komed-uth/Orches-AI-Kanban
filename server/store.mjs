import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createStore(dataDir) {
 mkdirSync(dataDir,{recursive:true});
 const db=new DatabaseSync(join(dataDir,'orches.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
 const initial={users:[],sessions:[],invitations:[],projects:[],tasks:[],runs:[],events:[],settings:{capacity:3,executable:'codex',model:'',runner:'codex'}};
 let state=JSON.parse(db.prepare('SELECT body FROM documents WHERE id=1').get()?.body??JSON.stringify(initial));
 const listeners=new Set(); let depth=0; let pending=[];
 const persist=()=>db.prepare('INSERT INTO documents(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(state));
 const store={get state(){return state;},transaction(fn){
  if(depth) return fn(state);
  const previous=structuredClone(state); depth++; pending=[];
  try { const result=fn(state); persist(); depth--; const events=pending; pending=[]; for(const event of events) for(const handler of listeners) {try{handler(event);}catch{}} return result; }
  catch(error){state=previous;depth=0;pending=[];throw error;}
 },event(type,data={}) {let event; const append=()=>{event={...data,id:(state.events.at(-1)?.id??0)+1,type,createdAt:new Date().toISOString()};state.events.push(event);pending.push(event);}; if(depth)append();else store.transaction(append);return event;},subscribe(handler){listeners.add(handler);return()=>listeners.delete(handler);},close(){db.close();}};
 return store;
}
