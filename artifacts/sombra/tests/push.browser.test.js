// Push reminders in a real browser, against the production build: 1.
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };

/** Serves the built app like the deployment does: real files, otherwise index.html. */
async function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let file = path.join(dist, decodeURIComponent(url.pathname));
    try { if (!(await stat(file)).isFile()) throw new Error("dir"); } catch { file = path.join(dist, "index.html"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

test("a push names the person on the phone, while the server only ever sees keys", { skip: !process.env.CHROME_BIN && "needs CHROME_BIN" }, async () => {
  await stat(path.join(dist, "index.html")).catch(() => { throw new Error("Build the app first: pnpm --filter @workspace/sombra run build"); });
  const server = await serveDist();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ permissions: ["notifications"] });
    await context.addInitScript(() => {
      localStorage.setItem("sombra.profile", JSON.stringify({ name: "Luis", language: "en", usualIntensity: "moderate", newToHeat: false, mode: "work" }));
      localStorage.setItem("sombra.welcome-dismissed", "true");
      localStorage.setItem("sombra.sign-in-prompt-dismissed", "true");
      localStorage.setItem("sombra.care-contacts", JSON.stringify([{ id: "c-rosa", name: "Grandma Rosa", phone: "", time: "09:00", lastChecked: null }]));
      localStorage.setItem("sombra.push", JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", token: "t".repeat(43) }));
    });
    const schedules = [];
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/push/schedule") {
        schedules.push(route.request().postData());
        return route.fulfill({ json: { ok: true, reminders: 1 } });
      }
      if (url.pathname === "/api/push/key") return route.fulfill({ json: { publicKey: "BPlaceholderKeyForTheTestOnly" } });
      if (url.pathname === "/api/conditions") return route.fulfill({ json: { alerts: [], air: null } });
      return route.fulfill({ status: 404, json: { error: "not mocked" } });
    });

    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    const registrationId = new Promise((resolve) => {
      cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
        const reg = registrations.find((r) => r.scopeURL.startsWith(origin) && !r.isDeleted);
        if (reg) resolve(reg.registrationId);
      });
    });

    await page.goto(`${origin}/app/check-on`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

    // 1. What leaves the phone.
    const deadline = Date.now() + 10_000;
    while (!schedules.length && Date.now() < deadline) await page.waitForTimeout(100);
    assert.ok(schedules.length, "the phone sent its schedule to the server");
    const sent = JSON.parse(schedules.at(-1));
    assert.deepEqual(sent.reminders, [{ kind: "care", key: "c-rosa", time: "09:00" }]);
    assert.doesNotMatch(schedules.at(-1), /Rosa|Grandma/, "names never leave the phone");

    // 2. A push arrives (the app could be closed; the service worker handles it).
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId: await registrationId,
      data: JSON.stringify({ type: "care", key: "c-rosa", stage: "first", lang: "en" }),
    });
    let shown = [];
    const until = Date.now() + 10_000;
    while (!shown.length && Date.now() < until) {
      shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, url: n.data && n.data.url })));
      if (!shown.length) await page.waitForTimeout(100);
    }
    assert.equal(shown.length, 1, "the notification was shown");
    assert.equal(shown[0].title, "Time to check on Grandma Rosa");
    assert.equal(shown[0].url, "/app/check-on");

    // An official heat warning push.
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin, registrationId: await registrationId,
      data: JSON.stringify({ type: "heat", event: "Extreme Heat Warning", ends: null, lang: "en" }),
    });
    await page.waitForFunction(async () => (await (await navigator.serviceWorker.ready).getNotifications()).some((n) => n.title === "Extreme Heat Warning"), null, { timeout: 10_000 });
  } finally {
    await browser.close();
    server.close();
  }
});
