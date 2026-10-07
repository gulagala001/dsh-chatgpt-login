import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createChatGPTService, modelsFromCatalog, RECORD_KEY, PROVIDER } from '../src/service.mjs';
import { createHandler } from '../src/index.mjs';

const payload={type:'oauth',access:'fixture-access-secret',refresh:'fixture-refresh-secret',expires:2000000000000,accountId:'fixture-account'};
const catalog={models:[{slug:'gpt-6.1-sol',display_name:'GPT',context_window:272000,input_modalities:['text','image'],supported_reasoning_levels:[{effort:'high'},{effort:'ultra'}]}, {slug:'gpt-future-model',visibility:'list'}, {slug:'gpt-hidden-available',visibility:'hide'}]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  const records=new Map(),writes=[];let revision=0,value={providers:{existing:{apiKeyEnv:'KEEP_KEY'}}};
  const services={
    credentials:{readRecord:async key=>records.get(key),describeRecord:async key=>({configured:records.has(key),kind:records.get(key)?.kind,writable:true}),deleteRecord:async key=>records.delete(key)},
    authorization:{describe:()=>({methods:[{id:'oauth'}]}),begin:options.begin??(async()=>({status:'cancelled'}))},
    settings:{writable:true,describe:()=>[{ns:'llm-pi-ai',value,revision}],replace:async(ns,next,expected)=>{
      if(options.conflict&&!writes.length){writes.push('conflict');value.providers.concurrent={models:[]};revision++;throw Object.assign(Error('conflict'),{code:'SETTINGS_CONFLICT'});}
      assert.equal(expected,revision);value=next;revision++;writes.push(next);
    }},
    llm:{listProviders:()=>Object.keys(value.providers).map(id=>({id})),listModels:async()=>value.providers[PROVIDER]?.models??[]},
    connection:{requestRejection:()=>undefined},
  };
  const ctx={get:name=>services[name]};
  const service=createChatGPTService(ctx,{loadCatalog:async()=>modelsFromCatalog(catalog),timeoutMs:3000,...options.service});
  return{ctx,service,records,writes,services,config:()=>value};
}

test('login automatically registers the whole account catalog, preserves other routes, and does not expose credentials',async t=>{
  let fx;fx=fixture({conflict:true,begin:async()=>{fx.records.set(RECORD_KEY,{kind:'grant',payload});return{status:'authorized'};}});t.after(()=>fx.service.close());
  await fx.service.start('browser');await tick();
  const state=await fx.service.status();assert.equal(state.configured,true);assert.equal(state.modelsCount,3);assert.equal(state.attempt.phase,'authorized');
  assert.deepEqual(fx.config().providers.existing,{apiKeyEnv:'KEEP_KEY'});assert.ok(fx.config().providers.concurrent);
  assert.deepEqual(fx.config().providers[PROVIDER].models.map(m=>m.id),catalog.models.map(m=>m.slug));
  assert.ok(!JSON.stringify(state).includes(payload.access));assert.ok(!JSON.stringify(state).includes(payload.refresh));
  fx.records.set('other/record',{kind:'grant',payload:{}});await fx.service.logout();assert.ok(!fx.records.has(RECORD_KEY));assert.ok(fx.records.has('other/record'));assert.ok(!fx.config().providers[PROVIDER]);
});

test('catalog handles new model ids, hidden-but-available models, duplicate ids and plan eligibility without a fixed whitelist',()=>{
  const rows=modelsFromCatalog({models:[...catalog.models,{slug:'gpt-future-model'},{slug:'plan-model',available_in_plans:['pro']},{slug:'not-supported',supported_in_api:false}]},'plus');
  assert.deepEqual(rows.map(m=>m.id),catalog.models.map(m=>m.slug));assert.deepEqual(rows[0].reasoningEfforts,{high:'high'});
});

test('OAuth prompts reject stale answers, accept callbacks, and allow only official authorization links',async t=>{
  let fx;fx=fixture({begin:async({interaction})=>{
    interaction.notify({message:'继续登录',url:'https://attacker.example/steal'});
    interaction.notify({message:'浏览器授权',url:'https://auth.openai.com/authorize?state=fixture'});
    const value=await interaction.prompt({kind:'secret',message:'授权码'});assert.equal(value,'one-time-code');fx.records.set(RECORD_KEY,{kind:'grant',payload});return{status:'authorized'};
  }});t.after(()=>fx.service.close());
  await fx.service.start();await tick();const state=await fx.service.status(),p=state.attempt.prompt;
  assert.equal(state.attempt.notices[0].url,undefined);assert.match(state.attempt.notices[1].url,/^https:\/\/auth.openai.com/);
  await assert.rejects(fx.service.start(),/正在进行/);await assert.rejects(fx.service.answer(state.attempt.id,'stale','one-time-code'),/已失效/);
  await fx.service.answer(state.attempt.id,p.id,'one-time-code');await tick();const settled=await fx.service.status();assert.equal(settled.attempt.phase,'authorized');assert.equal(settled.attempt.prompt,undefined);assert.ok(!JSON.stringify(settled).includes('one-time-code'));
});

test('cancellation and unload withdraw prompts and prevent a late grant',async()=>{
  const fx=fixture({begin:async({interaction,signal})=>{try{await interaction.prompt({kind:'text',message:'回调',signal});}catch{return{status:'cancelled'};}throw Error('cancel must withdraw the prompt');}});
  const state=await fx.service.start();await tick();await fx.service.cancel(state.attempt.id);assert.equal((await fx.service.status()).attempt.phase,'cancelled');assert.equal(fx.records.size,0);
  await fx.service.start();await tick();await fx.service.close();assert.equal((await fx.service.status()).attempt.prompt,undefined);await assert.rejects(fx.service.start(),/已停止/);
});

test('HTTP requires trusted DSH connections and same-origin mutations; status never caches or returns secrets',async t=>{
  const fx=fixture();t.after(()=>fx.service.close());const handler=createHandler(fx.ctx,fx.service);
  const request=async(input,headers={},denied)=>{
    const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);req.url='/dsh-chatgpt-login/api';req.method=input===undefined?'GET':'POST';req.headers={host:'localhost:3083',...headers};fx.services.connection.requestRejection=()=>denied;
    const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};await handler(req,res);return res;
  };
  assert.equal((await request({action:'login'},{},401)).status,401);assert.equal((await request({action:'login'},{origin:'https://attacker.example'})).status,403);
  fx.records.set(RECORD_KEY,{kind:'grant',payload});const response=await request();assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'no-store');assert.ok(!response.body.includes(payload.access));assert.ok(!response.body.includes(payload.refresh));
  assert.equal((await request({action:'select',model:'old-removed-feature'})).status,400);
});
