import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server/app.mjs';

test('owner setup, authenticated sample board and sessions survive restart without leaking credentials', async () => {
 const dataDir=await mkdtemp(join(tmpdir(),'orches-http-'));
 let application;
 async function open(){ application=await createApplication({dataDir}); const server=application.app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); return `http://127.0.0.1:${server.address().port}`; }
 try {
 let base=await open();
 assert.equal((await fetch(base+'/api/snapshot')).status,401);
 let response=await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'long-password'})});
 assert.equal(response.status,201); let cookie=response.headers.get('set-cookie').split(';')[0];
 response=await fetch(base+'/api/snapshot',{headers:{cookie}}); const board=await response.json();
 assert.equal(board.projects[0].statuses.length,6); assert.ok(board.tasks.length>=2); assert.equal(board.runs.length,0);
 assert.doesNotMatch(JSON.stringify(board),/passwordHash|sessionToken|long-password/);
 assert.equal((await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'other',password:'long-password'})})).status,409);
 await application.close(); base=await open();
 assert.equal((await fetch(base+'/api/snapshot',{headers:{cookie}})).status,200);
 await fetch(base+'/api/logout',{method:'POST',headers:{cookie}});
 assert.equal((await fetch(base+'/api/snapshot',{headers:{cookie}})).status,401);
 response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'long-password'})}); assert.equal(response.status,200);
 } finally {await application?.close(); await rm(dataDir,{recursive:true,force:true});}
});
