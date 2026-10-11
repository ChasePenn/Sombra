import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { build } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(directory, ".account-test.mjs");
await build({
  stdin: {
    contents: 'export { createMeRouter } from "../src/routes/me.ts"; export { pool } from "@workspace/db";',
    resolveDir: directory,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundlePath,
  external: ["express", "@clerk/express"],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  logLevel: "silent",
});
const { createMeRouter, pool } = await import(pathToFileURL(bundlePath).href);
const subjects = [`test-a-${randomUUID()}`, `test-b-${randomUUID()}`];
let server;
let origin;
const deletedAuthUsers = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { warn() {}, error() {} };
    next();
  });
  app.use("/api", createMeRouter({
    // Test-only verified identity adapter. Production uses Clerk getAuth.
    getUserId: (req) => req.headers["x-test-subject"],
    deleteAuthUser: async (userId) => { deletedAuthUsers.push(userId); },
  }));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});

async function call(subject, route, method = "GET", body) {
  const response = await fetch(`${origin}/api/me/${route}`, {
    method,
    headers: {
      ...(subject ? { "x-test-subject": subject } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

after(async () => {
  if (origin) {
    for (const subject of subjects) await call(subject, "account", "DELETE");
  }
  if (server) {
    server.close();
    await once(server, "close");
  }
  await pool.end();
  await unlink(bundlePath);
});

test("worker activity is account-scoped and saved check-ins re-run safety rules idempotently",async()=>{
  const [a,b]=[`activity-a-${randomUUID()}`,`activity-b-${randomUUID()}`];
  subjects.push(a,b);
  const now=Date.now();
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Phoenix",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
  const session={workerName:"Safety test",date,startedAt:null,endedAt:null,breaks:[],waterLogs:[],planHours:[],siteType:"full_sun",remindersShown:[]};
  assert.equal((await call(a,"sessions","PUT",session)).status,200);
  assert.equal((await call(a,"sessions")).body[0].workerName,"Safety test");
  assert.equal((await call(b,"sessions")).body.length,0);
  const id=randomUUID();
  const payload={id,workerName:"Safety test",time:new Date(now).toISOString(),level:"OK",symptomsJson:["confused"],detailsJson:{language:"en",note:"Synthetic test note"}};
  const danger=await call(a,"checkins","POST",payload);
  assert.equal(danger.body.level,"DANGER");assert.equal(danger.body.detailsJson.response.level,"DANGER");
  await call(a,"checkins","POST",payload);
  assert.equal((await call(a,"checkins")).body.filter(c=>c.id===id).length,1);
  assert.equal((await call(b,"checkins")).body.length,0);
});

test("authenticated subject owns all data; browser-supplied IDs cannot read or change another account", async () => {
  const [a, b] = subjects;
  const profile = {
    name: "Account B",
    language: "en",
    usualIntensity: "moderate",
    newToHeat: false,
    notificationsEnabled: false,
  };
  assert.equal((await call(null, "profile")).status, 401);
  assert.equal((await call(b, "profile", "PUT", { ...profile, userId: a })).status, 200);
  assert.equal((await call(a, "profile")).body.profile, null);
  assert.equal((await call(b, "profile")).body.profile.name, "Account B");

  await call(b, "crew", "PUT", {
    crew: [{ name: "B crew", intensity: "hard", newToHeat: false }],
  });
  await call(a, "crew", "PUT", {
    ownerId: b,
    crew: [{ name: "A crew", intensity: "easy", newToHeat: true, ownerId: b }],
  });
  assert.deepEqual((await call(b, "crew")).body.map((member) => member.name), ["B crew"]);
  assert.deepEqual((await call(a, "crew")).body.map((member) => member.name), ["A crew"]);

  await call(b, "shifts", "POST", {
    userId: a,
    date: "2026-10-10",
    location: "B site",
    planJson: { forecast: { hours: [] } },
  });
  assert.equal((await call(a, "shifts")).body.length, 0);
  assert.equal((await call(b, "shifts")).body[0].location, "B site");
  await call(b, "checkins", "POST", {
    userId: a,
    workerName: "B worker",
    time: new Date().toISOString(),
    level: "checked-in",
    symptomsJson: [],
  });
  assert.equal((await call(a, "checkins")).body.length, 0);
  assert.equal((await call(b, "checkins")).body[0].workerName, "B worker");

  await call(a, "account", "DELETE", { userId: b });
  assert.ok(deletedAuthUsers.includes(a));
  assert.equal(deletedAuthUsers.includes(b), false, "a browser ID cannot delete another Clerk identity");
  assert.equal((await call(a, "crew")).body.length, 0);
  assert.equal((await call(b, "crew")).body[0].name, "B crew");
  assert.equal((await call(b, "profile")).body.profile.name, "Account B");
});

test("guest import is transactional and only imports once per account", async () => {
  const a = subjects[0];
  const snapshot = {
    profile: {
      name: "Guest",
      language: "es",
      usualIntensity: "easy",
      newToHeat: true,
      notificationsEnabled: false,
    },
    crew: [{ name: "Guest crew", intensity: "moderate", newToHeat: false }],
    shifts: [{ date: "2026-10-10", location: "Guest site", planJson: { hours: [] } }],
    checkins: [],
  };
  assert.equal((await call(a, "import", "POST", snapshot)).body.imported, true);
  const second = await call(a, "import", "POST", snapshot);
  assert.equal(second.body.imported, false);
  assert.equal(second.body.reason, "already-imported");
  assert.equal((await call(a, "crew")).body.length, 1);
  assert.equal((await call(a, "shifts")).body.length, 1);
});
