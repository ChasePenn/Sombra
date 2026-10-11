import assert from "node:assert/strict";
import { once } from "node:events";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { build } from "esbuild";
import test, { after } from "node:test";

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(dir, ".security.test-bundle.mjs");
await build({ entryPoints: [path.resolve(dir, "../src/middlewares/security.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
const { rateLimit, securityHeaders } = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
after(() => unlink(bundle).catch(() => {}));

async function serve(...middleware) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(...middleware);
  app.get("/x", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}/x` };
}

test("API responses carry safety headers, and HSTS only over HTTPS", async () => {
  const { server, url } = await serve(securityHeaders);
  try {
    const plain = await fetch(url);
    assert.equal(plain.headers.get("x-content-type-options"), "nosniff");
    assert.equal(plain.headers.get("x-frame-options"), "DENY");
    assert.match(plain.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(plain.headers.get("strict-transport-security"), null);
    const https = await fetch(url, { headers: { "X-Forwarded-Proto": "https" } });
    assert.match(https.headers.get("strict-transport-security"), /max-age=31536000/);
  } finally {
    server.close();
  }
});

test("rate limit allows the limit, then answers 429 with Retry-After, and resets", async () => {
  let clock = 1_000_000;
  const { server, url } = await serve(rateLimit({ limit: 3, windowMs: 60_000, now: () => clock }));
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await fetch(url)).status, 200);
    const blocked = await fetch(url);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
    // A different client address (as reported by the one trusted proxy) has its own count.
    assert.equal((await fetch(url, { headers: { "X-Forwarded-For": "203.0.113.7" } })).status, 200);
    clock += 60_000;
    assert.equal((await fetch(url)).status, 200, "the window resets after a minute");
  } finally {
    server.close();
  }
});
