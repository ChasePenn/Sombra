import test, { after } from "node:test";
import assert from "node:assert/strict";
import { emptySession, phoenixDate, applySessionAction } from "@workspace/heat-safety/session";
const originalWindow=globalThis.window,originalFetch=globalThis.fetch;
globalThis.window={localStorage:{getItem(k){return this[k]??null;},setItem(k,v){this[k]=String(v);},removeItem(k){delete this[k];}}};
const store=await import("../public/js/store.js");
const service=await import("../public/js/checkin-service.js");
after(()=>{globalThis.window=originalWindow;globalThis.fetch=originalFetch;});
test("guest activity, danger and offline check-ins persist without an AI dependency",async()=>{
  store.setAccountSession(null);
  globalThis.fetch=()=>{throw new Error("Offline");};
  let session=applySessionAction(emptySession("Luis"),"start");
  session=applySessionAction(session,"water");
  await store.saveSession(session);
  assert.equal((await store.getSessions())[0].waterLogs.length,1);
  const fine=await service.submitCheckin({session,symptoms:[],language:"en"});
  assert.equal(fine.result.level,"OK");assert.equal(fine.result.source,"template");assert.match(fine.result.message,/1 cups/);
  let calls=0;globalThis.fetch=()=>{calls++;throw new Error("Danger must not request personalization");};
  const danger=await service.submitCheckin({session,symptoms:["confused"],language:"es"});
  assert.equal(danger.result.level,"DANGER");assert.equal(calls,0);assert.equal((await store.getCheckins()).length,2);
});
test("account offline outbox is isolated, visible and replayed without losing check-in IDs",async()=>{
  store.setAccountSession("account-a");
  globalThis.fetch=()=>{throw new Error("Offline");};
  const session=emptySession("Ana",phoenixDate());
  await store.saveSession(session);
  const checkin=await store.saveCheckin({workerName:"Ana",time:new Date().toISOString(),level:"CAUTION",symptomsJson:["headache"],detailsJson:{note:"Private note"}});
  assert.equal(checkin.detailsJson.pendingSync,true);assert.equal(store.hasPendingActivity(),true);
  store.setAccountSession("account-b");await assert.rejects(store.getSessions(),/Could not reach/);assert.equal(store.hasPendingActivity(),false);
  store.setAccountSession("account-a");
  const posted=[];
  globalThis.fetch=async(path,opts={})=>{
    const input=opts.body?JSON.parse(opts.body):null;posted.push({path,input});
    return {ok:true,status:200,json:async()=>path.endsWith("/session")?{userId:"account-a"}:input};
  };
  await store.syncActivity();
  assert.equal(store.hasPendingActivity(),false);
  assert.equal(posted.find(p=>p.path.endsWith("/checkins")).input.id,checkin.id);
  assert.equal(store.getLocalSnapshot().sessions.some(s=>s.workerName === "Ana"),false);
});
test("an emergency selected while activity is still loading cannot erase existing work or water",async()=>{
  store.setAccountSession(null);
  globalThis.fetch=()=>{throw new Error("Offline");};
  let actual=applySessionAction(emptySession("Emergency test"),"start");
  actual=applySessionAction(actual,"water");
  await store.saveSession(actual);
  await service.submitCheckin({session:emptySession("Emergency test"),symptoms:["confused"],language:"en"});
  const saved=(await store.getSessions()).find(s=>s.workerName === "Emergency test");
  assert.equal(saved.startedAt,actual.startedAt);assert.equal(saved.waterLogs.length,1);
});
test("cancelling pending personalization cannot save an OK result after an emergency",async()=>{
  store.setAccountSession(null);
  const session=emptySession("Cancellation test");
  await store.saveSession(session);
  const before=(await store.getCheckins()).length;
  const controller=new AbortController();
  let requested;
  const reached=new Promise(resolve=>{requested=resolve;});
  globalThis.fetch=(_path,options)=>new Promise((_resolve,reject)=>{
    requested();options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
  });
  const pending=service.submitCheckin({session,symptoms:[],language:"en",signal:controller.signal});
  await reached;controller.abort();
  await assert.rejects(pending,/cancelled/);
  await service.submitCheckin({session,symptoms:["confused"],language:"en"});
  const history=await store.getCheckins();
  assert.equal(history.length,before+1);assert.equal(history[0].level,"DANGER");
});
test("uncached offline account activity is unavailable, not invented zeros, and symptoms still work",async()=>{
  store.setAccountSession("uncached-account");
  let aiCalls=0;
  globalThis.fetch=(path)=>{if(path === "/api/check-in") aiCalls++;throw new Error("Offline");};
  const session=await service.getWorkerSession("Uncached worker");
  assert.equal(session.activityAvailable,false);
  const result=await service.submitCheckin({session,symptoms:["headache"],language:"en"});
  assert.equal(result.result.level,"CAUTION");assert.match(result.result.message,/unavailable/);assert.doesNotMatch(result.result.message,/0 hours/);
  assert.equal(result.checkin.detailsJson.pendingSync,true);assert.equal(aiCalls,0);
  await assert.rejects(service.trackWorkerSession("Uncached worker","start"),/Reconnect/);
});
