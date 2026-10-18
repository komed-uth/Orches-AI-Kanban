import express from 'express';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createStore } from './store.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const defaultStatuses=()=>['Backlog','Ready','In Progress','Review','Done','Blocked'].map((name,i)=>({id:['backlog','ready','progress','review','done','blocked'][i],name,kind:['backlog','ready','execution','review','done','blocked'][i]}));
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const publicUser=({id,username,role})=>({id,username,role});
const passwordHash=password=>{const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;};
const validPassword=(password,hash)=>{const [salt,digest]=hash.split(':');return timingSafeEqual(Buffer.from(digest,'hex'),scryptSync(password,salt,64));};
const credentials=body=>{if(typeof body.username!=='string'||!/^[\w.-]{2,40}$/.test(body.username)||typeof body.password!=='string'||body.password.length<10||body.password.length>256)fail(400,'Use a 2–40 character username and password of at least 10 characters.');};
function projectDefaults(record){return {...record,statuses:defaultStatuses(),rule:{enabled:false,triggerStatus:'ready',reviewStatus:'review',instructions:'',buildCommand:record.buildCommand??'',testCommand:record.testCommand??'node --test'}};}
function seed(store,dataDir){
 if(store.state.projects.length)return;
 const path=join(resolve(dataDir),'sample-project');mkdirSync(path,{recursive:true});
 if(existsSync(join(root,'sample-game')))cpSync(join(root,'sample-game'),path,{recursive:true});
 else {writeFileSync(join(path,'README.md'),'# Sample game\nA small game project.\n');writeFileSync(join(path,'game.mjs'),'export const score = 0;\n');}
 const git=(args)=>execFileSync('git',['-C',path,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(!existsSync(join(path,'.git'))){git(['init']);git(['add','.']);git(['-c','user.name=Orches Sample','-c','user.email=sample@localhost','commit','-m','Seed sample game']);}
 store.transaction(state=>{const project=projectDefaults({id:randomUUID(),name:'Sample game',path,revision:git(['rev-parse','HEAD']),buildCommand:'',testCommand:'node --test'});state.projects.push(project);for(const title of ['Add a score counter','Add keyboard controls'])state.tasks.push({id:randomUUID(),projectId:project.id,title,description:'An independent sample programming task.',acceptanceCriteria:'Add the feature and automated tests.',discipline:'programming',priority:'medium',assigneeId:null,statusId:'backlog',messages:[]});});
}
export async function createApplication({dataDir=resolve('.orches-data'),runnerFactory,schedulerFactory}={}){
 const store=createStore(dataDir);seed(store,dataDir);
 let scheduler;
 if(schedulerFactory)scheduler=await schedulerFactory({store,dataDir,runnerFactory});
 else if(existsSync(join(root,'server/scheduler.mjs'))) {try {const {createScheduler}=await import('./scheduler.mjs');scheduler=await createScheduler({store,dataDir,runnerFactory});}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}}
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'1mb'}));
 const streams=new Map(); const servers=new Set(); const originalListen=app.listen.bind(app);app.listen=(...args)=>{const server=originalListen(...args);servers.add(server);server.on('close',()=>servers.delete(server));return server;};
 const sessionOf=req=>{const token=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('orches_session='))?.slice(15);return store.state.sessions.find(x=>x.token===token&&x.expiresAt>Date.now());};
 const signedIn=(req,res,next)=>{const session=sessionOf(req);const user=store.state.users.find(x=>x.id===session?.userId);if(!user)return res.status(401).json({error:'Sign in required.'});req.user=user;req.session=session;next();};
 const owner=(req,res,next)=>req.user.role==='owner'?next():res.status(403).json({error:'Owner access required.'});
 const signIn=(user,res)=>{const session={token:randomBytes(32).toString('hex'),userId:user.id,expiresAt:Date.now()+7*86400000};store.transaction(s=>s.sessions.push(session));res.cookie('orches_session',session.token,{httpOnly:true,sameSite:'strict',maxAge:7*86400000,path:'/'});};
 app.get('/api/setup',(req,res)=>res.json({needsSetup:store.state.users.length===0}));
 app.post('/api/setup',(req,res)=>{credentials(req.body);if(store.state.users.length)fail(409,'Owner has already been created.');const user={id:randomUUID(),username:req.body.username,passwordHash:passwordHash(req.body.password),role:'owner'};store.transaction(s=>s.users.push(user));signIn(user,res);res.status(201).json({user:publicUser(user)});});
 app.post('/api/login',(req,res)=>{credentials(req.body);const user=store.state.users.find(x=>x.username===req.body.username);if(!user||!validPassword(req.body.password,user.passwordHash))fail(401,'Invalid username or password.');signIn(user,res);res.json({user:publicUser(user)});});
 app.post('/api/logout',signedIn,(req,res)=>{store.transaction(s=>{s.sessions=s.sessions.filter(x=>x.token!==req.session.token);});for(const response of streams.get(req.session.token)??[])response.end();streams.delete(req.session.token);res.clearCookie('orches_session',{path:'/'});res.json({ok:true});});
 app.use('/api',signedIn);
 app.get('/api/me',(req,res)=>res.json({user:publicUser(req.user)}));
 app.get('/api/snapshot',(req,res)=>{const {projects,tasks,runs,settings,events}=store.state;res.json({user:publicUser(req.user),users:store.state.users.map(publicUser),projects,tasks,runs,settings,events,cursor:events.at(-1)?.id??0});});
 app.get('/api/events',(req,res)=>{const after=Number(req.headers['last-event-id']??req.query.after??0);if(!Number.isSafeInteger(after)||after<0)fail(400,'Invalid event cursor.');res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();const send=event=>res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);const unsubscribe=store.subscribe(send);for(const event of store.state.events)if(event.id>after)send(event);const token=req.session.token;if(!streams.has(token))streams.set(token,new Set());streams.get(token).add(res);const heartbeat=setInterval(()=>{if(!sessionOf(req))res.end();else res.write(': heartbeat\n\n');},15000);req.on('close',()=>{clearInterval(heartbeat);unsubscribe();streams.get(token)?.delete(res);});});
 app.get('/api/projects',(req,res)=>res.json({projects:store.state.projects}));
 app.get('/api/tasks/:id',(req,res)=>{const task=store.state.tasks.find(x=>x.id===req.params.id);if(!task)fail(404,'Task not found.');res.json({task,runs:store.state.runs.filter(x=>x.taskId===task.id)});});
 app.get('/api/settings',(req,res)=>res.json({settings:store.state.settings}));
 if(existsSync(join(root,'dist'))) {app.use(express.static(join(root,'dist')));app.get(/^(?!\/api).*/,(req,res)=>res.sendFile(join(root,'dist/index.html')));}
 else app.get('/',(req,res)=>res.type('html').send('<!doctype html><html><body><h1>Orches AI Kanban</h1><p>Run npm run build to build the browser application.</p></body></html>'));
 app.use('/api',(req,res)=>res.status(404).json({error:'API operation not found.'}));
 app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status??(error.type==='entity.parse.failed'?400:500)).json({error:error.status?error.message:'The operation failed. Check server logs.'});if(!error.status)console.error(error);});
 return {app,store,scheduler,async close(){await scheduler?.close();for(const responses of streams.values())for(const res of responses)res.end();await Promise.all([...servers].map(s=>new Promise(r=>s.close(r))));store.close();}};
}
