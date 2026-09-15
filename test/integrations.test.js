// test/integrations.test.js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createIntegrationRouter} from '../src/integrations.js';
test('application keys, explicit user consent, PKCE, isolation, rotation and revocation persist',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dropit-api-'));const app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));
 const own=randomUUID(),other=randomUUID();const data=[{id:own,owner:{sub:'alice'},expiresAt:Date.now()+86400000,slug:'alice-public',files:[{id:randomUUID(),name:'Alice.txt',size:20,mime:'text/plain'}]},{id:other,owner:{sub:'bob'},expiresAt:Date.now()+86400000,slug:'bob-public',files:[{id:randomUUID(),name:'Bob.txt',size:20}]}];
 const origin='http://localhost:14335';let module=createIntegrationRouter({dataDir:dir,baseUrl:origin,identityIssuer:'https://kyros.test',shares:()=>data,requireUser:(req,res,next)=>{if(!req.get('x-test-user'))return res.sendStatus(401);req.user={sub:req.get('x-test-user')};req.sid=req.get('x-test-user')==='dev-user'?'dev':'test-session';next()}});
 app.use((req,res,next)=>module.router(req,res,next));app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));const server=app.listen(14335,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 async function call(route,method='GET',body,headers={}){return fetch(origin+route,{method,redirect:'manual',headers:{origin,...headers,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})}
 try{assert.equal((await call('/api/integrations/clients')).status,401);assert.equal((await call('/api/integrations/clients','POST',{name:'x',redirect_uri:'https://liora.example/api/v1/integration-callback'},{'x-test-user':'dev-user'})).status,403);
 const c=await(await call('/api/integrations/clients','POST',{name:'Liora',redirect_uri:'https://liora.example/api/v1/integration-callback'},{'x-test-user':'alice'})).json();const headers={authorization:`Bearer ${c.api_key}`};assert.ok(c.api_key);assert.equal((await call('/api/integrations/files','GET',null,headers)).status,401);
 const verifier='a'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url'),state='s'.repeat(43);const url='/integrations/authorize?'+new URLSearchParams({client_id:c.id,redirect_uri:c.redirect_uri,code_challenge:challenge,state});
 const consent=await(await call(url,'GET',null,{'x-test-user':'alice'})).text();const nonce=consent.match(/name="nonce" value="([^"]+)"/)[1];
 assert.equal((await call('/integrations/authorize','POST',{nonce},{'x-test-user':'bob'})).status,400);
 const approved=await call('/integrations/authorize','POST',{nonce},{'x-test-user':'alice'});assert.equal(approved.status,303);const callback=new URL(approved.headers.get('location'));assert.equal(callback.searchParams.get('state'),state);
 const body={grant_type:'authorization_code',code:callback.searchParams.get('code'),redirect_uri:c.redirect_uri,code_verifier:verifier};assert.equal((await call('/api/integrations/token','POST',{...body,code_verifier:'b'.repeat(43)},headers)).status,400);
 const tokens=await(await call('/api/integrations/token','POST',body,headers)).json();assert.equal(tokens.sub,'alice');assert.equal(tokens.identity_issuer,'https://kyros.test');assert.equal((await call('/api/integrations/token','POST',body,headers)).status,400);
 const personal={...headers,'x-dropit-user-token':tokens.access_token,'x-user-id':'bob'};let files=await(await call('/api/integrations/files','GET',null,personal)).json();assert.deepEqual(files.data.map(f=>f.name),['Alice.txt']);assert.equal((await call(`/api/integrations/shares/${other}/link`,'POST',{},personal)).status,404);assert.equal((await(await call(`/api/integrations/shares/${own}/link`,'POST',{},personal)).json()).public,true);
 module.close();module=createIntegrationRouter({dataDir:dir,baseUrl:origin,identityIssuer:'https://kyros.test',shares:()=>data,requireUser:(req,res,next)=>{req.user={sub:'alice'};req.sid='test';next()}});assert.equal((await call('/api/integrations/files','GET',null,personal)).status,200);
 const fresh=await(await call('/api/integrations/token','POST',{grant_type:'refresh_token',refresh_token:tokens.refresh_token},headers)).json();assert.ok(fresh.access_token);assert.equal((await call('/api/integrations/files','GET',null,personal)).status,401);assert.equal((await call('/api/integrations/token','POST',{grant_type:'refresh_token',refresh_token:tokens.refresh_token},headers)).status,401);
 await call('/api/integrations/revoke','POST',{refresh_token:fresh.refresh_token},headers);assert.equal((await call('/api/integrations/files','GET',null,{...headers,'x-dropit-user-token':fresh.access_token})).status,401);
 await call(`/api/integrations/clients/${c.id}`,'DELETE',undefined,{'x-test-user':'alice'});assert.equal((await call('/api/integrations/capabilities','GET',null,headers)).status,401);
 }finally{await new Promise(r=>server.close(r));module.close();await rm(dir,{recursive:true,force:true});}
});
