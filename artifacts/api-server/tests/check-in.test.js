import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import express from "express";
import { build } from "esbuild";
import { personalize, validatePersonalization } from "../lib/ai.js";
import { emptySession, phoenixDate, sessionContext } from "@workspace/heat-safety/session";

const context = {...sessionContext(emptySession("Luis")),hoursWorked:2,waterCups:3,recommendedCups:6};
const output = {message:"Luis, you've worked 2 hours and logged 3 cups. Stop work and cool down in the shade.",follow_up_question:"Are you feeling better?",actions:["Rest in the shade","Drink water","Cool down","Ask for help"],recheck_in_minutes:90};
test("personalization validates structure, caps actions and clamps caution followup",()=>{
  assert.equal(validatePersonalization(output,"CAUTION").recheck_in_minutes,30);
  assert.equal(validatePersonalization(output,"OK").recheck_in_minutes,60);
  assert.equal(validatePersonalization({...output,recheck_in_minutes:2},"CAUTION").recheck_in_minutes,15);
  assert.equal(validatePersonalization(output,"CAUTION").actions.length,3);
  assert.equal(validatePersonalization({...output,level:"OK"},"CAUTION"),null);
  assert.equal(validatePersonalization({...output,message:"Keep working. You are fine."},"CAUTION"),null);
  assert.equal(validatePersonalization({...output,message:"One sentence."},"OK"),null);
});
test("danger never invokes the model; all failures return templates with real numbers",async()=>{
  let calls=0;
  const client={models:{generateContent:async()=>{calls++;throw new Error("private provider error");}}};
  assert.equal((await personalize({level:"DANGER",context,language:"en"},{client,model:"test"})).level,"DANGER");
  assert.equal(calls,0);
  const result=await personalize({level:"CAUTION",context,language:"en"},{client,model:"test"});
  assert.equal(result.source,"template");assert.match(result.message,/2 hours/);assert.match(result.message,/3 cups/);
  const invalid={models:{generateContent:async()=>({text:'{"level":"OK"}'})}};
  assert.equal((await personalize({level:"CAUTION",context,language:"en"},{client:invalid,model:"test"})).level,"CAUTION");
});
test("valid structured model output is used without giving the model ownership of severity",async()=>{
  const client={models:{generateContent:async(request)=>{
    const c=JSON.parse(request.contents);assert.equal(c.heat_risk_now,"unavailable");assert.equal(c.water_cups_logged,3);
    assert.equal(request.config.responseMimeType,"application/json");
    return {text:JSON.stringify({...output,actions:output.actions.slice(0,3)})};
  }}};
  const result=await personalize({level:"CAUTION",context,language:"en"},{client,model:"configured-model"});
  assert.equal(result.source,"ai");assert.equal(result.level,"CAUTION");assert.equal(result.recheck_in_minutes,30);
});
test("timeout aborts the request and returns a usable template",async()=>{
  let signal;
  const client={models:{generateContent:({config})=>{signal=config.abortSignal;return new Promise(()=>{});}}};
  const result=await personalize({level:"OK",context,language:"es"},{client,model:"test",timeoutMs:5});
  assert.equal(signal.aborted,true);assert.equal(result.source,"template");assert.match(result.message,/3 vasos/);
});

const directory=path.dirname(fileURLToPath(import.meta.url));
const bundlePath=path.join(directory,".check-in-test.mjs");
await build({stdin:{contents:'export {createCheckInRouter} from "../src/routes/check-in.ts"; export {pool} from "@workspace/db";',resolveDir:directory,loader:"ts"},bundle:true,platform:"node",format:"esm",outfile:bundlePath,external:["express","@clerk/express","@google/genai"],banner:{js:'import { createRequire } from "node:module"; const require=createRequire(import.meta.url);'},logLevel:"silent"});
const {createCheckInRouter,pool}=await import(pathToFileURL(bundlePath).href);
let clock=Date.now(), modelCalls=0;
const app=express();app.use(express.json());
app.use("/api",createCheckInRouter({getUserId:req=>req.headers["x-test-user"],now:()=>clock,store:{getSessions:async()=>[],getCheckins:async()=>[]},personalize:async({level})=>{modelCalls++;return {...output,actions:output.actions.slice(0,3),source:"ai",level:"OK",recheck_in_minutes:90};}}));
const server=app.listen(0,"127.0.0.1");await once(server,"listening");
const origin=`http://127.0.0.1:${server.address().port}`;
const body=(symptoms=[])=>({workerName:"Luis",symptoms,language:"en",session:emptySession("Luis",phoenixDate(clock))});
async function post(payload,user="test-user"){return fetch(`${origin}/api/check-in`,{method:"POST",headers:{"Content-Type":"application/json",...(user?{"x-test-user":user}:{})},body:JSON.stringify(payload)});}
after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();await unlink(bundlePath);});
test("endpoint reruns rules, keeps caution, rate-limits AI and bypasses AI for danger",async()=>{
  const caution=await (await post(body(["headache"]))).json();assert.equal(caution.level,"CAUTION");assert.equal(caution.recheck_in_minutes,30);assert.equal(modelCalls,1);
  const limited=await(await post(body())).json();assert.equal(limited.source,"template");assert.equal(modelCalls,1);
  const danger=await(await post(body(["confused"]))).json();assert.equal(danger.level,"DANGER");assert.equal(modelCalls,1);
  clock+=5001;
  assert.equal((await(await post(body(["weak"]))).json()).level,"CAUTION");assert.equal(modelCalls,2);
  assert.equal((await post(body(["not-a-symptom"]))).status,400);
});
test("anonymous callers receive signed HTTP-only identity cookies",async()=>{
  const response=await post(body(),null);
  assert.match(response.headers.get("set-cookie"),/sombra_checkin_guest=/);assert.match(response.headers.get("set-cookie"),/HttpOnly/);
  const cookie=response.headers.get("set-cookie").split(";")[0];
  const before=modelCalls;
  await fetch(`${origin}/api/check-in`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify(body())});
  assert.equal(modelCalls,before);
});
