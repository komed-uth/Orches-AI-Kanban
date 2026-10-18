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

test('tasks validate references and protect execution metadata while preserving ordinary edits', async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'orches-task-'));const application=await createApplication({dataDir});const server=application.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;let cookie;
 const request=async(path,method='GET',body)=>{const res=await fetch(base+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return [res.status,await res.json(),res];};
 try{let [status,body,res]=await request('/api/setup','POST',{username:'owner',password:'long-password'});cookie=res.headers.get('set-cookie').split(';')[0];const [,snapshot]=await request('/api/snapshot');const projectId=snapshot.projects[0].id;
 [status,body]=await request('/api/tasks','POST',{projectId,title:'Sound effect',discipline:'audio',priority:'high',statusId:'backlog',conversationId:'attack'});assert.equal(status,201);const id=body.task.id;assert.equal(body.task.conversationId,undefined);
 [status,body]=await request(`/api/tasks/${id}`,'PATCH',{description:'Click audio',statusId:'ready',acceptedBy:'attack'});assert.equal(status,200);assert.equal(body.task.statusId,'ready');assert.equal(body.task.acceptedBy,undefined);
 assert.equal((await request(`/api/tasks/${id}`,'PATCH',{statusId:'done'}))[0],409);
 assert.equal((await request(`/api/tasks/${id}`,'PATCH',{statusId:'missing'}))[0],400);
 assert.equal((await request(`/api/tasks/${id}`))[1].task.description,'Click audio');
 }finally{await application.close();await rm(dataDir,{recursive:true,force:true});}
});

test('invitations are single use, members cannot configure host, and replay follows authenticated task changes',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'orches-team-'));const app=await createApplication({dataDir});const server=app.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,method='GET',body,cookie)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{const owner=await request('/api/setup','POST',{username:'owner',password:'long-password'});const invite=await request('/api/invitations','POST',{expiresInHours:1},owner.cookie);assert.equal(invite.status,201);
 const joined=await request('/api/join','POST',{token:invite.body.token,username:'member',password:'long-password'});assert.equal(joined.status,201);assert.equal(joined.body.user.role,'member');
 assert.equal((await request('/api/join','POST',{token:invite.body.token,username:'second',password:'long-password'})).status,409);
 assert.equal((await request('/api/settings','PATCH',{capacity:5},joined.cookie)).status,403);
 const board=await request('/api/snapshot','GET',null,owner.cookie);const cursor=board.body.cursor;const task=board.body.tasks[0];await request(`/api/tasks/${task.id}`,'PATCH',{title:'Shared change',assigneeId:joined.body.user.id},joined.cookie);
 const response=await fetch(base+`/api/events?after=${cursor}`,{headers:{cookie:owner.cookie}});const reader=response.body.getReader();const {value}=await reader.read();const text=new TextDecoder().decode(value);assert.match(text,/task.updated/);assert.match(text,new RegExp(task.id));await reader.cancel();
 assert.equal((await request('/api/snapshot','GET',null,owner.cookie)).body.tasks.find(x=>x.id===task.id).title,'Shared change');
 }finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
});
