import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveAudienceMode } from "../lib/modes.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(testDirectory, "../../..");
const browserPath = process.env.CHROME_BIN || "/repl/tools/bin/chromium";
// The planner opens in Work mode, which layers work.json over the shared workers.json copy.
const readMode = async (id) => JSON.parse(await readFile(new URL(`../config/modes/${id}.json`, import.meta.url), "utf8"));
const workerMode = resolveAudienceMode({
  "../config/modes/workers.json": await readMode("workers"),
  "../config/modes/work.json": await readMode("work"),
}, "work");

async function availablePort(excluded = new Set()) {
  while (true) {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (!excluded.has(port)) return port;
  }
}

async function waitForHttp(url, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Sombra dev server exited early.\n${logs()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_error) {
      // The development server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the Sombra dev server.\n${logs()}`);
}

async function waitForJson(url) {
  // Shared CI machines can take a while to start a browser.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (_error) {
      // Chromium has not opened its debugging endpoint yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Chromium's debugging endpoint.");
}

async function connectToPage(debugPort) {
  const deadline = Date.now() + 10000;
  let target;
  while (Date.now() < deadline) {
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    target = targets.find(({ type }) => type === "page");
    if (target?.webSocketDebuggerUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!target?.webSocketDebuggerUrl) throw new Error("Chromium did not create a page target.");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          "Browser evaluation failed.",
      );
    }
    return result.result?.value;
  };
  const close = () => socket.close();
  return { send, evaluate, close };
}

async function waitForDocument(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate("document.readyState === 'complete'")) return;
    } catch (_error) {
      // Navigation has not created the new page context yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for the Sombra page to finish loading.");
}

async function waitForCondition(page, expression) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Browser condition did not finish: ${expression}`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    const forceExited = once(child, "exit");
    child.kill("SIGKILL");
    await forceExited;
  }
}

function phoenixTomorrow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const [year, month, day] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
}

test("Tomorrow uses the Phoenix date, errors are shown, and saved details restore without stale heat guidance", async () => {
  const appPort = await availablePort();
  const debugPort = await availablePort(new Set([appPort]));
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "sombra-browser-"));
  let serverLogs = "";
  const server = spawn(process.execPath, [
    path.join(workspaceRoot, "artifacts/sombra/node_modules/vite/bin/vite.js"),
    "--config",
    "vite.config.ts",
    "--host",
    "0.0.0.0",
  ], {
    cwd: path.join(workspaceRoot, "artifacts/sombra"),
    env: { ...process.env, PORT: String(appPort), BASE_PATH: "/" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverLogs += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverLogs += chunk.toString(); });
  const browser = spawn(browserPath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-zygote",
    "--single-process",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ], { stdio: "ignore" });
  let page;

  try {
    await waitForHttp(`http://127.0.0.1:${appPort}/`, server, () => serverLogs);
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    page = await connectToPage(debugPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setTimezoneOverride", { timezoneId: "America/Los_Angeles" });
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const nativeFetch = window.fetch.bind(window);
        window.__shiftRequests = [];
        window.fetch = async (input, init = {}) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.startsWith("/api/weather/geocode?")) {
            if (window.__searchFailure) return new Response("Unavailable", { status: 503 });
            return new Response(JSON.stringify(window.__searchResults || []), {
              headers: { "Content-Type": "application/json" }
            });
          }
          if (url === "/api/weather/shift") {
            const payload = JSON.parse(init.body);
            window.__shiftRequests.push(payload);
            if (window.__mockInvalidDate) {
              return new Response(JSON.stringify({
                error: "Shift date must be today or tomorrow in Phoenix local time."
              }), { status: 400, headers: { "Content-Type": "application/json" } });
            }
            return new Response(JSON.stringify({
              date: payload.date,
              timezone: "America/Phoenix",
              locationName: payload.locationName,
              intensity: payload.intensity,
              newToHeat: payload.newToHeat,
              missingHours: window.__mockMissingHours || [],
              hours: ["22:00", "23:00", "00:00", "01:00"].map((time) => ({
                time,
                airTempF: 100,
                humidity: 20,
                wbgtSunF: 90,
                wbgtShadeF: 85,
                wbgtSiteF: typeof payload.siteAlbedo === "number" ? 80 : 90
              }))
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return nativeFetch(input, init);
        };
        Object.defineProperty(navigator, "geolocation", {
          configurable: true,
          value: {
            getCurrentPosition(success, failure) {
              if (window.__geoError) {
                failure({ code: window.__geoError, PERMISSION_DENIED: 1, TIMEOUT: 3 });
                return;
              }
              if (window.__geoPending) {
                window.__finishGeo = () => success({ coords: { latitude: 33.4484, longitude: -112.074 } });
                return;
              }
              success({ coords: { latitude: 33.4484, longitude: -112.074 } });
            }
          }
        });
      })();`,
    });
    await page.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/planner.html` });
    await waitForDocument(page);
    const chooseLanguage = (locale) => page.evaluate(`document.querySelector('[data-locale="${locale}"]').click()`);
    const inputText = (value) => page.evaluate(`(() => {
      const input = document.querySelector("#location-search");
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    // Validation and location feedback must translate immediately, not only after the worker repeats the failed action.
    for (const locale of ["en", "es"]) {
      const other = locale === "en" ? "es" : "en";
      const copy = workerMode.locales[locale];
      await page.evaluate(`window.__searchResults = []`);
      await chooseLanguage(locale);
      await page.evaluate(`document.querySelector("#clear-location").click(); document.querySelector("#submit-shift").click()`);
      assert.equal(await page.evaluate(`document.querySelector("#form-error").textContent`), copy.validation.location);
      await chooseLanguage(other);
      assert.equal(await page.evaluate(`document.querySelector("#form-error").textContent`), workerMode.locales[other].validation.location);
      await chooseLanguage(locale);
      // Blocked shows how to turn location back on (this is a desktop browser).
      for (const [code, key] of [[1, "permissionDeclinedDesktop"], [3, "timeout"], [2, "failed"]]) {
        await page.evaluate(`localStorage.removeItem("sombra.last-fix"); window.__geoError = ${code}; document.querySelector("#use-location").click()`);
        await waitForCondition(page, `document.querySelector("#location-status").textContent === ${JSON.stringify(copy.location[key])}`);
        await chooseLanguage(other);
        assert.equal(await page.evaluate(`document.querySelector("#location-status").textContent`), workerMode.locales[other].location[key]);
        await chooseLanguage(locale);
      }
      await page.evaluate(`window.__geoError = 0; document.querySelector("#use-location").click()`);
      await waitForCondition(page, `document.querySelector("#location-status").textContent === ${JSON.stringify(copy.location.selected)}`);
      await page.evaluate(`document.querySelector("#worker-name").value = ""; document.querySelector("#submit-shift").click()`);
      assert.equal(await page.evaluate(`document.querySelector("#form-error").textContent`), copy.validation.workerName);
      await page.evaluate(`document.querySelector("#worker-name").value = "María López"; document.querySelectorAll('input[name="intensity"]').forEach(input => input.checked = false); document.querySelector("#submit-shift").click()`);
      assert.equal(await page.evaluate(`document.querySelector("#form-error").textContent`), copy.validation.intensity);
      await page.evaluate(`document.querySelector('input[name="intensity"][value="moderate"]').click(); document.querySelector("#start-time").value = ""; document.querySelector("#submit-shift").click()`);
      assert.equal(await page.evaluate(`document.querySelector("#form-error").textContent`), copy.validation.shiftTimes);
      await page.evaluate(`document.querySelector("#start-time").value = "15:00"; document.querySelector("#submit-shift").click()`);
      assert.equal(await page.evaluate(`document.querySelector("#form-error").textContent`), copy.validation.sameTime);
      await page.evaluate(`document.querySelector("#start-time").value = "07:00"; document.querySelectorAll('input[name="newToHeat"]').forEach(input => input.checked = false); document.querySelector("#submit-shift").click()`);
      assert.equal(await page.evaluate(`document.querySelector("#form-error").textContent`), copy.validation.newToHeat);
      await inputText("P");
      assert.equal(await page.evaluate(`document.querySelector("#location-status").textContent`), copy.location.minimumCharacters);
      await inputText("No matches");
      await waitForCondition(page, `document.querySelector("#location-status").textContent === ${JSON.stringify(copy.location.noneFound)}`);
      await page.evaluate(`window.__searchFailure = true`);
      await inputText("Failed search");
      await waitForCondition(page, `document.querySelector("#location-status").textContent === ${JSON.stringify(copy.location.searchFailed)}`);
      await page.evaluate(`window.__searchFailure = false; window.__searchResults = [{ name: "Phoenix", admin1: "Arizona", country: "United States", latitude: 33.4484, longitude: -112.074 }]`);
      await inputText("Phoenix");
      await waitForCondition(page, `!document.querySelector("#location-options").hidden`);
      assert.equal(await page.evaluate(`document.querySelector("#location-status").textContent`), copy.location.oneFound.replace("{count}", "1"));
      await chooseLanguage(other);
      assert.equal(await page.evaluate(`document.querySelector("#location-status").textContent`), workerMode.locales[other].location.oneFound.replace("{count}", "1"));
      assert.equal(await page.evaluate(`document.querySelector("#location-search").value`), "Phoenix");
      await page.evaluate(`document.querySelector(".suggestion-option").click()`);
    }
    await chooseLanguage("en");
    await page.evaluate(`window.__geoPending = true; document.querySelector("#use-location").click()`);
    assert.equal(await page.evaluate(`document.querySelector("#location-status").textContent`), workerMode.locales.en.location.finding);
    await chooseLanguage("es");
    assert.equal(await page.evaluate(`document.querySelector("#location-status").textContent`), workerMode.locales.es.location.finding);
    await page.evaluate(`window.__geoPending = false; window.__finishGeo()`);
    await waitForCondition(page, `document.querySelector("#location-status").textContent === ${JSON.stringify(workerMode.locales.es.location.selected)}`);
    await chooseLanguage("en");
    const visionSmoke = await page.evaluate(`(async () => {
      const { classifySitePhoto } = await import("/js/vision.js");
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = 24;
      sourceCanvas.height = 16;
      sourceCanvas.getContext("2d").fillRect(0, 0, 24, 16);
      const imageBlob = await new Promise((resolve) => sourceCanvas.toBlob(resolve, "image/png"));
      const imageFile = new File([imageBlob], "work-area.png", { type: "image/png" });
      const calls = [];
      const fakeClassifier = async (image, prompts) => {
        calls.push({ width: image.width, height: image.height, prompts: [...prompts] });
        return prompts.map((label) => ({
          label,
          score: label.includes("black roof") ? 0.82 :
            label.includes("completely shaded") ? 0.66 : 0.04
        }));
      };
      const result = await classifySitePhoto(imageFile, fakeClassifier);
      return {
        calls,
        surface: result.surface,
        shade: result.shade
      };
    })()`);
    assert.equal(visionSmoke.calls.length, 2, "the image model runs once for surface and once for shade");
    assert.equal(visionSmoke.calls[0].prompts.length, 8, "all surface prompts are classified together");
    assert.equal(visionSmoke.calls[1].prompts.length, 3, "all shade prompts are classified together");
    assert.ok(Math.max(visionSmoke.calls[0].width, visionSmoke.calls[0].height) <= 512);
    assert.equal(visionSmoke.surface.key, "dark_roof");
    assert.equal(visionSmoke.surface.score, 0.82);
    assert.equal(visionSmoke.shade.key, "full_shade");
    assert.equal(visionSmoke.shade.score, 0.66);

    const tomorrow = phoenixTomorrow();
    const expectedDisplayDate = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${tomorrow}T12:00:00Z`));

    const completeAndSubmit = async (invalidDate = false) => {
      await page.evaluate(`window.__mockInvalidDate = ${invalidDate}`);
      await page.evaluate(`document.querySelector("#use-location").click()`);
      await page.evaluate(`document.querySelector("#worker-name").value = "Test worker"`);
      await page.evaluate(`document.querySelector('input[name="intensity"][value="moderate"]').click()`);
      await page.evaluate(`document.querySelector('input[name="newToHeat"][value="no"]').click()`);
      await page.evaluate(`document.querySelector("#shift-date-tomorrow").click()`);
      await page.evaluate(`document.querySelector("#start-time").value = "22:00"`);
      await page.evaluate(`document.querySelector("#end-time").value = "02:00"`);
      assert.equal(await page.evaluate(`document.querySelector("#shift-date-tomorrow").value`), tomorrow);
      await page.evaluate(`document.querySelector("#submit-shift").click()`);

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const complete = await page.evaluate(`(() => {
          const status = document.querySelector("#forecast-status");
          return window.__shiftRequests.length > 0 &&
            status.dataset.kind !== "loading" &&
            (document.querySelector("#forecast-date").textContent ||
              status.dataset.kind === "error");
        })()`);
        if (complete) return;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw new Error("The forecast request did not finish in the browser.");
    };

    await page.evaluate(`document.querySelector('input[name="intensity"][value="moderate"]').click()`);
    await page.evaluate(`document.querySelector('[data-locale="es"]').click()`);
    const spanishCopy = await page.evaluate(`(() => {
      const moderate = document.querySelector('input[name="intensity"][value="moderate"]');
      return {
        language: document.documentElement.lang,
        namePlaceholder: document.querySelector("#worker-name").placeholder,
        moderateExample: moderate.parentElement.querySelector(".intensity-example").textContent,
        moderateSelected: moderate.checked
      };
    })()`);
    assert.equal(spanishCopy.language, "es");
    assert.equal(spanishCopy.namePlaceholder, workerMode.locales.es.ui.workerNamePlaceholder);
    assert.equal(
      spanishCopy.moderateExample,
      workerMode.locales.es.taskIntensities.find(({ value }) => value === "moderate").example,
    );
    assert.equal(spanishCopy.moderateSelected, true, "changing the locale should preserve the selected intensity");
    await page.evaluate(`document.querySelector('[data-locale="en"]').click()`);

    await completeAndSubmit();
    const success = await page.evaluate(`({
      request: window.__shiftRequests[0],
      renderedDate: document.querySelector("#forecast-date").textContent,
      renderedLocation: document.querySelector("#forecast-location-name").textContent,
      renderedHours: document.querySelector("#forecast-shift-hours").textContent,
      hourlyConditions: document.querySelector("#forecast-rows").textContent,
      resultVisible: !document.querySelector("#results").hidden,
      currentHeat: document.querySelector("#summary-wbgt").textContent,
      hourStripTitle: document.querySelector("#hour-strip-title").textContent,
      workerCopy: document.querySelector("#results").innerText,
      blocks: document.querySelectorAll(".schedule-card").length,
      detailClosed: !document.querySelector("#forecast-details").open,
      partialNoticeHidden: document.querySelector("#forecast-partial-notice").hidden
    })`);
    assert.equal(success.request.date, tomorrow, "the request must contain Phoenix-local tomorrow");
    assert.equal(success.renderedDate, `Phoenix local: ${expectedDisplayDate}`, "the brief must display the requested Phoenix-local date");
    assert.match(success.renderedDate, /Phoenix local/);
    assert.equal(success.renderedLocation, success.request.locationName);
    assert.equal(success.renderedHours, "Shift: 10 PM to 2 AM (next day)");
    assert.match(success.hourlyConditions, /100°F/);
    assert.equal(success.resultVisible, true);
    assert.match(success.currentHeat, /Heat stress 90°F$/, "the large heat reading uses the same solar-adjusted WBGT as the schedule");
    assert.match(success.currentHeat, /^Air \d+°F/, "the air temperature is shown next to it so the two aren't confused");
    assert.equal(success.hourStripTitle, workerMode.locales.en.results.restOfShift);
    assert.equal(success.blocks, 1, "consecutive hours with the same risk form one block");
    assert.equal(success.detailClosed, true, "technical weather values start behind Details");
    assert.equal(success.partialNoticeHidden, true, "complete forecasts do not show a partial-data notice");
    assert.doesNotMatch(success.workerCopy, /WBGT|solar-adjusted|Category \d|No limit|\b0 min\b/);
    assert.match(success.workerCopy, /Test worker/);
    const hotBlockBounds = await page.evaluate(`(() => {
      const box = document.querySelector("#work-rest-schedule").getBoundingClientRect();
      return { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height, scale: 1 };
    })()`);
    const hotBlockScreenshot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: hotBlockBounds });
    await writeFile(path.join(os.tmpdir(), "sombra-worker-hot-block.png"), Buffer.from(hotBlockScreenshot.data, "base64"));
    await page.evaluate(`document.querySelector(".schedule-block > summary").click()`);
    assert.equal(await page.evaluate(`document.querySelector(".schedule-block").open`), true);
    assert.equal(await page.evaluate(`document.querySelectorAll(".schedule-hour").length`), 4);
    await page.evaluate(`(() => {
      document.querySelector("#site-manual-open").click();
      document.querySelector('input[name="site-surface"][value="asphalt"]').click();
      document.querySelector('input[name="site-shade"][value="full_shade"]').click();
      document.querySelector("#site-apply-adjustment").click();
    })()`);
    const siteDeadline = Date.now() + 5000;
    while (Date.now() < siteDeadline) {
      const siteReady = await page.evaluate(`!document.querySelector("#site-adjusted-results").hidden`);
      if (siteReady) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const siteResult = await page.evaluate(`({
      request: window.__shiftRequests[1],
      comparison: document.querySelector("#site-comparison-rows").textContent,
      siteBadge: !document.querySelector("#site-adjusted-badge").hidden,
      scheduleBadge: !document.querySelector("#schedule-site-badge").hidden,
      currentHeat: document.querySelector("#summary-wbgt").textContent
    })`);
    assert.equal(siteResult.request.siteAlbedo, 0.08);
    assert.equal(siteResult.request.solarMultiplier, 0);
    assert.equal(Object.hasOwn(siteResult.request, "photo"), false);
    assert.match(siteResult.comparison, /90°F/);
    assert.match(siteResult.comparison, /80°F/);
    assert.equal(siteResult.siteBadge, true);
    assert.equal(siteResult.scheduleBadge, true);
    assert.match(siteResult.currentHeat, /Heat stress 80°F$/, "the displayed reading follows the applied site shade adjustment");
    const adjustedCopy = await page.evaluate(`document.querySelector("#results").innerText`);
    assert.match(adjustedCopy, /Asphalt in full shade: we adjusted your plan/);
    assert.match(adjustedCopy, /Work normally/);
    assert.doesNotMatch(adjustedCopy, /WBGT|Category \d|No limit|\b0 min\b/);
    await page.evaluate(`document.querySelector("#site-edit-adjustment").click()`);
    assert.equal(await page.evaluate(`document.querySelector("#site-check").hidden`), false);
    await page.evaluate(`document.querySelector('[data-locale="es"]').click()`);
    const spanish = await page.evaluate(`({
      language: document.querySelector("#results").lang,
      copy: document.querySelector("#results").innerText
    })`);
    assert.equal(spanish.language, "es");
    assert.match(spanish.copy, /Trabaja normalmente/);
    assert.match(spanish.copy, /Precaución/);
    assert.match(spanish.copy, /Tomar una foto/);
    assert.doesNotMatch(spanish.copy, /WBGT|Category \d|No limit|\b0 min\b/);
    await page.evaluate(`document.querySelector('[data-locale="en"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 650));
    for (const width of [375, 430]) {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: width,
        screenHeight: 900
      });
      const layout = await page.evaluate(`({
        viewport: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        applyHeight: document.querySelector("#site-apply-adjustment").getBoundingClientRect().height,
        choiceHeight: document.querySelector(".site-choice span").getBoundingClientRect().height,
        intensityChoiceMinHeight: Number.parseFloat(getComputedStyle(document.querySelector(".intensity-card")).minHeight)
      })`);
      assert.ok(layout.documentWidth <= layout.viewport, `no horizontal document overflow at ${width}px`);
      assert.ok(layout.bodyWidth <= layout.viewport, `no horizontal body overflow at ${width}px`);
      assert.ok(layout.applyHeight >= 48, "site adjustment button remains a large touch target");
      assert.ok(layout.choiceHeight >= 48, "site choice remains a large touch target");
      assert.ok(layout.intensityChoiceMinHeight >= 48, "work-intensity choices keep their large touch target size");
      await page.evaluate(`document.querySelector("#shift-summary").scrollIntoView({ block: "start", behavior: "instant" })`);
      const screenshot = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(path.join(os.tmpdir(), `sombra-worker-results-${width}.png`), Buffer.from(screenshot.data, "base64"));
      await page.evaluate(`document.querySelector("#work-rest-schedule").scrollIntoView({ block: "start", behavior: "instant" })`);
      const hoursScreenshot = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(path.join(os.tmpdir(), `sombra-worker-hours-${width}.png`), Buffer.from(hoursScreenshot.data, "base64"));
    }
    await page.send("Emulation.clearDeviceMetricsOverride");
    await page.evaluate(`window.dispatchEvent(new Event("beforeprint"))`);
    assert.equal(await page.evaluate(`document.querySelector("#forecast-details").open`), true, "print includes the technical weather readings");
    await page.send("Emulation.setEmulatedMedia", { media: "print" });
    const printLayout = await page.evaluate(`({
      planner: getComputedStyle(document.querySelector(".planner .form-panel")).display,
      brief: getComputedStyle(document.querySelector("#results")).display,
      brand: getComputedStyle(document.querySelector(".topbar")).display,
      disclaimer: getComputedStyle(document.querySelector("footer")).display,
      tableHeader: getComputedStyle(document.querySelector(".forecast-table thead")).display
    })`);
    assert.equal(printLayout.planner, "none");
    assert.notEqual(printLayout.brief, "none");
    assert.notEqual(printLayout.brand, "none");
    assert.notEqual(printLayout.disclaimer, "none");
    assert.equal(printLayout.tableHeader, "table-header-group");
    await page.send("Emulation.setEmulatedMedia", { media: "screen" });
    await page.evaluate(`window.dispatchEvent(new Event("afterprint"))`);
    assert.equal(await page.evaluate(`document.querySelector("#forecast-details").open`), false, "printing restores the worker-friendly collapsed view");
    await page.evaluate(`window.__printCalled = false; window.print = () => { window.__printCalled = true; }; document.querySelector("#print-brief").click()`);
    assert.equal(await page.evaluate(`window.__printCalled`), true, "the print action must open the browser print dialog");
    const printedDisclaimer = await page.evaluate(`document.querySelector("footer").textContent.replace(/\\s+/g, " ").trim()`);
    // The printed brief keeps the disclaimer and the 911 line, whatever their current wording.
    assert.ok(printedDisclaimer.includes(workerMode.locales.en.ui.footerDisclaimer), printedDisclaimer);
    assert.match(printedDisclaimer, /911/);

    await page.evaluate(`window.__mockMissingHours = ["11:00", "12:00"]; document.querySelector("#shift-form").requestSubmit()`);
    const partialDeadline = Date.now() + 5000;
    while (Date.now() < partialDeadline) {
      const partialReady = await page.evaluate(`window.__shiftRequests.length === 3 && !document.querySelector("#forecast-partial-notice").hidden`);
      if (partialReady) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const partialNotice = await page.evaluate(`({
      message: document.querySelector("#forecast-partial-notice").textContent,
      role: document.querySelector("#forecast-partial-notice").getAttribute("role"),
      live: document.querySelector("#forecast-partial-notice").getAttribute("aria-live")
    })`);
    // The notice names how many hours are missing and which ones.
    assert.equal(partialNotice.message, workerMode.locales.en.results.partialForecastPlural.replace("{count}", "2").replace("{times}", "11 AM, 12 PM"));
    assert.equal(partialNotice.role, "status");
    assert.equal(partialNotice.live, "polite");
    await page.evaluate(`document.querySelector('[data-locale="es"]').click()`);
    const spanishPartialNotice = await page.evaluate(`document.querySelector("#forecast-partial-notice").textContent`);
    assert.match(spanishPartialNotice, /^Sin pronóstico para 2 horas/);

    // Compare actual requests and numeric rendered schedule data across both languages and phone widths, including applied site adjustments.
    const formValues = () => page.evaluate(`({
      name: document.querySelector("#worker-name").value,
      location: document.querySelector("#location-search").value,
      locationName: document.querySelector("#location-name").value,
      latitude: document.querySelector("#latitude").value,
      longitude: document.querySelector("#longitude").value,
      intensity: document.querySelector('input[name="intensity"]:checked')?.value,
      date: document.querySelector('input[name="date"]:checked')?.value,
      start: document.querySelector("#start-time").value,
      end: document.querySelector("#end-time").value,
      newToHeat: document.querySelector('input[name="newToHeat"]:checked')?.value,
      surface: document.querySelector('input[name="site-surface"]:checked')?.value,
      shade: document.querySelector('input[name="site-shade"]:checked')?.value
    })`);
    const scheduleValues = () => page.evaluate(`({
      categories: [...document.querySelectorAll(".schedule-card")].map(card => card.dataset.category),
      weatherAndCategories: [...document.querySelectorAll(".schedule-card-metrics dd")].map(cell => cell.textContent),
      workRatios: [...document.querySelectorAll(".work-part")].map(part => part.style.width),
      actionNumbers: [...document.querySelectorAll(".schedule-action")].map(action => action.textContent.match(/\\d+/g)),
      waterCups: [...document.querySelectorAll(".schedule-water")].map(line => line.querySelectorAll("svg").length),
      adjusted: !document.querySelector("#schedule-site-badge").hidden
    })`);
    let referenceBase, referenceAdjusted, referenceSchedule, referenceAdjustedSchedule;
    await page.evaluate(`window.__mockMissingHours = []; document.querySelector("#worker-name").value = "María López"`);
    for (const width of [375, 430]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: true });
      for (const locale of ["en", "es"]) {
        const before = await formValues();
        const requestsBefore = await page.evaluate("window.__shiftRequests.length");
        await chooseLanguage(locale);
        assert.deepEqual(await formValues(), before, "language switching preserves all form and site selections");
        assert.equal(await page.evaluate("window.__shiftRequests.length"), requestsBefore, "language switching does not request weather");
        const copy = workerMode.locales[locale];
        const expectedDateLabel = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${tomorrow}T12:00:00Z`));
        assert.equal(await page.evaluate(`document.querySelector("#shift-date-tomorrow-label").textContent`), expectedDateLabel);
        assert.equal(await page.evaluate(`document.querySelector(".language-switch").getAttribute("aria-label")`), copy.ui.languageControl);
        assert.equal(await page.evaluate(`document.querySelector(".brand").getAttribute("aria-label")`), copy.ui.brandHome);
        for (const [attribute, prefix, property] of [["data-mode-copy", "ui.", "textContent"], ["data-mode-placeholder", "ui.", "placeholder"], ["data-mode-aria", "ui.", "aria-label"]]) {
          const elements = await page.evaluate(`[...document.querySelectorAll("[${attribute}]")].map(el => [el.getAttribute("${attribute}"), ${property === "aria-label" ? 'el.getAttribute("aria-label")' : `el.${property}`}])`);
          for (const [key, text] of elements) assert.equal(text, copy.ui[key], `translated ${prefix}${key} at ${width}px`);
        }
        await page.evaluate(`document.querySelector("#shift-form").requestSubmit()`);
        await waitForCondition(page, `window.__shiftRequests.length === ${requestsBefore + 1} && !document.querySelector("#submit-shift").disabled`);
        const request = await page.evaluate("window.__shiftRequests.at(-1)");
        const schedule = await scheduleValues();
        referenceBase ??= request;
        referenceSchedule ??= schedule;
        assert.deepEqual(request, referenceBase, "English and Spanish send identical base payloads");
        assert.deepEqual(schedule, referenceSchedule, "English and Spanish render identical schedule values");
        await page.evaluate(`document.querySelector("#site-manual-open").click(); document.querySelector('input[name="site-surface"][value="asphalt"]').click(); document.querySelector('input[name="site-shade"][value="full_shade"]').click(); document.querySelector("#site-apply-adjustment").click()`);
        await waitForCondition(page, `!document.querySelector("#site-adjusted-results").hidden && document.querySelector("#site-apply-adjustment").getAttribute("aria-busy") !== "true"`);
        const adjusted = await page.evaluate("window.__shiftRequests.at(-1)");
        const adjustedSchedule = await scheduleValues();
        referenceAdjusted ??= adjusted;
        referenceAdjustedSchedule ??= adjustedSchedule;
        assert.deepEqual(adjusted, referenceAdjusted, "English and Spanish send identical site factors");
        assert.deepEqual(adjustedSchedule, referenceAdjustedSchedule, "site-adjusted schedule values are language-independent");
        await page.evaluate(`document.querySelector("#site-edit-adjustment").click()`);
        // The form is folded away while a plan is showing.
        await page.evaluate(`document.querySelector("#edit-shift").click()`);
        const layout = await page.evaluate(`({
          viewport: document.documentElement.clientWidth,
          width: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          widest: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 4).map((el) => (el.id || el.className || el.tagName) + ":" + Math.round(el.getBoundingClientRect().right)).join(", "),
          choiceHeight: document.querySelector(".intensity-card").getBoundingClientRect().height
        })`);
        assert.ok(layout.width <= layout.viewport && layout.body <= layout.viewport, `${locale} fits at ${width}px; too wide: ${layout.widest}`);
        assert.ok(layout.choiceHeight >= 48, `intensity choice is ${layout.choiceHeight}px tall at ${width}px (${locale})`);
        await page.evaluate(`document.querySelector("#shift-form").scrollIntoView({ block: "start", behavior: "instant" })`);
        const capture = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
        await writeFile(path.join(os.tmpdir(), `sombra-planner-${locale}-${width}.png`), Buffer.from(capture.data, "base64"));
      }
    }
    await page.send("Emulation.clearDeviceMetricsOverride");
    const beforeParentSwitch = await formValues();
    await page.evaluate(`window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: window.parent,
      data: { type: "sombra:session", userId: null, language: "en",
        profile: { name: "Old saved name", usualIntensity: "easy", newToHeat: true, language: "en" } }
    }))`);
    assert.deepEqual(await formValues(), beforeParentSwitch, "the app-shell language control does not overwrite this shift with saved defaults");
    assert.equal(await page.evaluate(`document.documentElement.lang`), "en");
    assert.match(await page.evaluate(`document.querySelector("#results").innerText`), /Work normally/);
    await chooseLanguage("es");

    await page.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/planner.html` });
    await waitForDocument(page);
    await page.evaluate(`window.__mockInvalidDate = true`);
    await completeAndSubmit(true);
    const visibleError = await page.evaluate(`({
      message: document.querySelector("#forecast-status").textContent,
      kind: document.querySelector("#forecast-status").dataset.kind
    })`);
    assert.equal(visibleError.kind, "error");
    assert.match(visibleError.message, /No se pudo cargar el pronóstico/);
    await chooseLanguage("en");
    assert.equal(await page.evaluate(`document.querySelector("#forecast-status > span").textContent`), workerMode.locales.en.results.forecastLoadedError);
    assert.equal(await page.evaluate(`document.querySelector(".retry-button").textContent`), workerMode.locales.en.results.forecastTryAgain);
    await chooseLanguage("es");
    await page.send("Page.navigate", { url: `http://127.0.0.1:${appPort}/planner.html` });
    await waitForDocument(page);
    let restored;
    const restorationDeadline = Date.now() + 3000;
    while (Date.now() < restorationDeadline) {
      restored = await page.evaluate(`({
        location: document.querySelector("#location-name").value,
        noticeHidden: document.querySelector(".saved-plan-notice").hidden,
        resultsHidden: document.querySelector("#results").hidden,
        savedCount: JSON.parse(localStorage.getItem("sombra.shifts") || "[]").length,
        lastLocation: JSON.parse(localStorage.getItem("sombra.shifts") || "[]")[0]?.location
      })`);
      if (!restored.noticeHidden) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(restored.location);
    assert.equal(restored.location, restored.lastLocation);
    assert.equal(restored.noticeHidden, false);
    assert.ok(restored.savedCount > 0, "the shift remains saved locally");
    assert.equal(restored.resultsHidden, true, "cached heat guidance is not presented as current");
  } finally {
    page?.close();
    await Promise.all([stopChild(server), stopChild(browser)]);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(profileDirectory, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error.code !== "ENOTEMPTY" || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
});
