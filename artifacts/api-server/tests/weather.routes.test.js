import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import test, { after, afterEach, before } from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const routerBundlePath = path.join(testDirectory, ".weather-router.test-bundle.mjs");
const originalFetch = globalThis.fetch;
const NativeDate = globalThis.Date;
let server;
let baseUrl;

await build({
  entryPoints: [path.resolve(testDirectory, "../src/routes/weather.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: routerBundlePath,
  external: ["express"],
  logLevel: "silent",
});

const { default: weatherRouter } = await import(
  `${pathToFileURL(routerBundlePath).href}?test=${Date.now()}`
);

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error() {} };
    next();
  });
  app.use(weatherRouter);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Date = NativeDate;
});

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  await unlink(routerBundlePath);
});

function mockUpstream(implementation) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: new URL(input), init });
    return implementation(new URL(input), init);
  };
  return calls;
}

function upstreamResponse(data, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    httpRequest(`${baseUrl}${pathname}`, { method: "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ status: response.statusCode, body: JSON.parse(body) });
      });
    })
      .on("error", reject)
      .end();
  });
}

function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${baseUrl}${pathname}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode, body: JSON.parse(responseBody) });
        });
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

function phoenixDateNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function freezeTime(instant) {
  globalThis.Date = class extends NativeDate {
    constructor(...args) {
      if (args.length === 0) {
        super(instant);
      } else {
        super(...args);
      }
    }

    static now() {
      return new NativeDate(instant).getTime();
    }
  };
}

function forecastData(times, overrides = {}) {
  const hourly = {
    time: times,
    temperature_2m: times.map(() => 40),
    relative_humidity_2m: times.map(() => 20),
    wind_speed_10m: times.map(() => 2),
    surface_pressure: times.map(() => 940),
    shortwave_radiation: times.map(() => 850),
    direct_radiation: times.map(() => 700),
    diffuse_radiation: times.map(() => 150),
    ...overrides,
  };
  return { hourly };
}

const shiftBody = {
  workerName: "Crew",
  locationName: "Phoenix",
  latitude: 33.4484,
  longitude: -112.074,
  intensity: "moderate",
  startTime: "10:00",
  endTime: "12:00",
  date: phoenixDateNow(),
  newToHeat: false,
};

test("geocoding returns validated locations from the mocked provider", async () => {
  const calls = mockUpstream(async (url) => {
    assert.equal(url.hostname, "geocoding-api.open-meteo.com");
    assert.equal(url.searchParams.get("name"), "Phoenix");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    return upstreamResponse({
      results: [
        {
          id: 123,
          name: "Phoenix",
          admin1: "Arizona",
          country: "United States",
          latitude: 33.4484,
          longitude: -112.074,
        },
      ],
    });
  });

  const result = await getJson("/weather/geocode?name=Phoenix");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [
    {
      id: 123,
      name: "Phoenix",
      admin1: "Arizona",
      country: "United States",
      latitude: 33.4484,
      longitude: -112.074,
    },
  ]);
  assert.equal(calls.length, 1);
});

test("geocoding rejects invalid input without calling the provider", async () => {
  const calls = mockUpstream(async () => {
    throw new Error("provider must not be called");
  });

  const result = await getJson("/weather/geocode?name=x");
  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);
});

test("geocoding reports provider errors, timeouts, and malformed results", async (t) => {
  await t.test("provider error", async () => {
    mockUpstream(async () => upstreamResponse({}, { status: 503 }));
    const result = await getJson("/weather/geocode?name=Phoenix");
    assert.equal(result.status, 502);
  });

  await t.test("upstream timeout", async () => {
    mockUpstream(async () => {
      throw new Error("upstream timeout");
    });
    const result = await getJson("/weather/geocode?name=Phoenix");
    assert.equal(result.status, 502);
  });

  await t.test("malformed location response", async () => {
    mockUpstream(async () =>
      upstreamResponse({ results: [{ name: "Phoenix", latitude: "unknown" }] }),
    );
    const result = await getJson("/weather/geocode?name=Phoenix");
    assert.equal(result.status, 502);
  });
});

test("shift forecast returns Phoenix-local date and sun/shade WBGT values", async () => {
  const date = phoenixDateNow();
  const calls = mockUpstream(async (url) => {
    assert.equal(url.hostname, "api.open-meteo.com");
    assert.equal(url.searchParams.get("timezone"), "America/Phoenix");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    return upstreamResponse(
      forecastData([`${date}T09:00`, `${date}T10:00`, `${date}T11:00`, `${date}T12:00`]),
    );
  });

  const result = await postJson("/weather/shift", shiftBody);
  assert.equal(result.status, 200);
  assert.equal(result.body.date, date);
  assert.equal(result.body.timezone, "America/Phoenix");
  assert.deepEqual(
    result.body.hours.map(({ time }) => time),
    ["10:00", "11:00"],
  );
  assert.deepEqual(result.body.missingHours, []);
  for (const hour of result.body.hours) {
    assert.ok(Number.isFinite(hour.wbgtSunF));
    assert.ok(Number.isFinite(hour.wbgtShadeF));
    assert.equal(hour.wbgtSiteF, hour.wbgtSunF);
    assert.ok(hour.wbgtSunF > hour.wbgtShadeF);
  }
  assert.equal(calls.length, 1);
});

test("shift forecast recalculates site WBGT from albedo and shade inputs", async () => {
  const date = phoenixDateNow();
  const calls = mockUpstream(async () =>
    upstreamResponse(forecastData([`${date}T10:00`, `${date}T11:00`])),
  );

  const adjusted = await postJson("/weather/shift", {
    ...shiftBody,
    siteAlbedo: 0.08,
    solarMultiplier: 0,
  });
  assert.equal(adjusted.status, 200);
  assert.equal(calls.length, 1);
  for (const hour of adjusted.body.hours) {
    assert.ok(Number.isFinite(hour.wbgtSiteF));
    assert.ok(hour.wbgtSiteF < hour.wbgtSunF);
  }
});

test("shift forecast rejects site albedo and shade factors outside physical bounds", async (t) => {
  const calls = mockUpstream(async () => {
    throw new Error("provider must not be called");
  });

  await t.test("albedo above one", async () => {
    const result = await postJson("/weather/shift", {
      ...shiftBody,
      siteAlbedo: 1.1,
      solarMultiplier: 0.5,
    });
    assert.equal(result.status, 400);
  });

  await t.test("negative shade multiplier", async () => {
    const result = await postJson("/weather/shift", {
      ...shiftBody,
      siteAlbedo: 0.2,
      solarMultiplier: -0.1,
    });
    assert.equal(result.status, 400);
  });

  assert.equal(calls.length, 0);
});

test("shift forecast omits an hour with a missing required reading and keeps valid hours", async () => {
  const date = phoenixDateNow();
  mockUpstream(async () =>
    upstreamResponse(
      forecastData([`${date}T10:00`, `${date}T11:00`], {
        temperature_2m: [null, 40],
      }),
    ),
  );

  const result = await postJson("/weather/shift", shiftBody);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.hours.map(({ time }) => time), ["11:00"]);
  assert.deepEqual(result.body.missingHours, ["10:00"]);
  assert.ok(Number.isFinite(result.body.hours[0].airTempF));
  assert.ok(Number.isFinite(result.body.hours[0].wbgtSunF));
  assert.ok(Number.isFinite(result.body.hours[0].wbgtShadeF));
});

test("shift forecast identifies requested hours omitted by the provider", async () => {
  const date = phoenixDateNow();
  mockUpstream(async () =>
    upstreamResponse(
      forecastData([`${date}T10:00`, `${date}T12:00`]),
    ),
  );

  const result = await postJson("/weather/shift", shiftBody);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.hours.map(({ time }) => time), ["10:00"]);
  assert.deepEqual(result.body.missingHours, ["11:00"]);
});

test("shift forecast accepts inclusive weather-value boundaries with finite WBGT values", async (t) => {
  const date = phoenixDateNow();
  const cases = [
    ["minimum temperature", { temperature_2m: [-50] }],
    ["maximum temperature", { temperature_2m: [60] }],
    ["minimum humidity", { relative_humidity_2m: [0] }],
    ["maximum humidity", { relative_humidity_2m: [100] }],
    ["minimum pressure", { surface_pressure: [500] }],
    ["maximum pressure", { surface_pressure: [1100] }],
    ["minimum wind", { wind_speed_10m: [0] }],
    ["maximum wind", { wind_speed_10m: [75] }],
    [
      "minimum shortwave radiation",
      {
        shortwave_radiation: [0],
        direct_radiation: [0],
        diffuse_radiation: [0],
      },
    ],
    [
      "maximum shortwave radiation",
      {
        shortwave_radiation: [1500],
        direct_radiation: [0],
        diffuse_radiation: [0],
      },
    ],
    [
      "minimum direct radiation",
      { shortwave_radiation: [0], direct_radiation: [0], diffuse_radiation: [0] },
    ],
    [
      "maximum direct radiation",
      {
        shortwave_radiation: [1500],
        direct_radiation: [1500],
        diffuse_radiation: [0],
      },
    ],
    [
      "minimum diffuse radiation",
      { shortwave_radiation: [0], direct_radiation: [0], diffuse_radiation: [0] },
    ],
    [
      "maximum diffuse radiation",
      {
        shortwave_radiation: [1500],
        direct_radiation: [0],
        diffuse_radiation: [1500],
      },
    ],
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      mockUpstream(async () =>
        upstreamResponse(forecastData([`${date}T10:00`], overrides)),
      );

      const result = await postJson("/weather/shift", shiftBody);
      assert.equal(result.status, 200);
      assert.equal(result.body.hours.length, 1);
      assert.ok(Number.isFinite(result.body.hours[0].wbgtSunF));
      assert.ok(Number.isFinite(result.body.hours[0].wbgtShadeF));
    });
  }
});

test("shift forecast rejects implausible provider readings as unavailable", async (t) => {
  const date = phoenixDateNow();
  const cases = [
    ["temperature below minimum", { temperature_2m: [-51] }],
    ["temperature", { temperature_2m: [61] }],
    ["humidity below minimum", { relative_humidity_2m: [-1] }],
    ["humidity", { relative_humidity_2m: [101] }],
    ["pressure", { surface_pressure: [499] }],
    ["pressure above maximum", { surface_pressure: [1101] }],
    ["wind below minimum", { wind_speed_10m: [-1] }],
    ["wind", { wind_speed_10m: [76] }],
    ["shortwave radiation below minimum", { shortwave_radiation: [-1] }],
    ["shortwave radiation", { shortwave_radiation: [1501] }],
    ["direct radiation below minimum", { direct_radiation: [-1] }],
    ["direct radiation above maximum", { direct_radiation: [1501] }],
    ["diffuse radiation below minimum", { diffuse_radiation: [-1] }],
    ["diffuse radiation above maximum", { diffuse_radiation: [1501] }],
    [
      "combined direct and diffuse radiation",
      { direct_radiation: [900], diffuse_radiation: [700] },
    ],
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      mockUpstream(async () =>
        upstreamResponse(forecastData([`${date}T10:00`], overrides)),
      );

      const result = await postJson("/weather/shift", shiftBody);
      assert.equal(result.status, 502);
      assert.match(result.body.error, /implausible readings.*temporarily unavailable/);
    });
  }
});

test("shift forecast returns the selected tomorrow date and requested Phoenix-local hours", async () => {
  const today = phoenixDateNow();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);
  const calls = mockUpstream(async () =>
    upstreamResponse(
      forecastData([`${date}T09:00`, `${date}T10:00`, `${date}T11:00`, `${date}T12:00`]),
    ),
  );

  const result = await postJson("/weather/shift", { ...shiftBody, date });
  assert.equal(result.status, 200);
  assert.equal(result.body.date, date);
  assert.equal(result.body.timezone, "America/Phoenix");
  assert.deepEqual(result.body.hours.map(({ time }) => time), ["10:00", "11:00"]);
  assert.equal(calls.length, 1);
});

test("shift forecast rejects invalid input and invalid clock values without fetching", async () => {
  const calls = mockUpstream(async () => {
    throw new Error("provider must not be called");
  });

  const invalidBody = await postJson("/weather/shift", {
    ...shiftBody,
    latitude: 91,
  });
  assert.equal(invalidBody.status, 400);

  const invalidClock = await postJson("/weather/shift", {
    ...shiftBody,
    startTime: "25:90",
  });
  assert.equal(invalidClock.status, 400);
  assert.equal(calls.length, 0);
});

test("shift forecast rejects past, unavailable, and tomorrow-overnight dates without fetching", async () => {
  const today = phoenixDateNow();
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const tooFar = new Date(`${today}T12:00:00Z`);
  tooFar.setUTCDate(tooFar.getUTCDate() + 2);
  const calls = mockUpstream(async () => {
    throw new Error("provider must not be called");
  });

  const past = await postJson("/weather/shift", {
    ...shiftBody,
    date: yesterday.toISOString().slice(0, 10),
  });
  assert.equal(past.status, 400);
  assert.match(past.body.error, /Past forecast dates/);

  const unavailable = await postJson("/weather/shift", {
    ...shiftBody,
    date: tooFar.toISOString().slice(0, 10),
  });
  assert.equal(unavailable.status, 400);
  assert.match(unavailable.body.error, /today and tomorrow/);

  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const overnight = await postJson("/weather/shift", {
    ...shiftBody,
    date: tomorrow.toISOString().slice(0, 10),
    startTime: "22:00",
    endTime: "02:00",
  });
  assert.equal(overnight.status, 400);
  assert.match(overnight.body.error, /extends beyond the available forecast/);
  assert.equal(calls.length, 0);
});

test("shift forecast rejects a selected date missing from provider coverage", async () => {
  const today = phoenixDateNow();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);
  mockUpstream(async () =>
    upstreamResponse(forecastData([`${today}T10:00`, `${today}T11:00`])),
  );

  const result = await postJson("/weather/shift", { ...shiftBody, date });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /forecast isn't available for the selected date/);
});

test("shift forecast reports provider errors, timeouts, and missing hourly data", async (t) => {
  await t.test("provider error", async () => {
    mockUpstream(async () => upstreamResponse({}, { status: 503 }));
    const result = await postJson("/weather/shift", shiftBody);
    assert.equal(result.status, 502);
  });

  await t.test("upstream timeout", async () => {
    mockUpstream(async () => {
      throw new Error("upstream timeout");
    });
    const result = await postJson("/weather/shift", shiftBody);
    assert.equal(result.status, 502);
  });

  await t.test("missing hourly data", async () => {
    mockUpstream(async () => upstreamResponse({}));
    const result = await postJson("/weather/shift", shiftBody);
    assert.equal(result.status, 502);
  });

  await t.test("no usable forecast values", async () => {
    const date = phoenixDateNow();
    mockUpstream(async () =>
      upstreamResponse(
        forecastData([`${date}T10:00`], {
          temperature_2m: [null],
          relative_humidity_2m: [null],
          wind_speed_10m: [null],
          surface_pressure: [null],
        }),
      ),
    );
    const result = await postJson("/weather/shift", shiftBody);
    assert.equal(result.status, 502);
  });

  await t.test("malformed hourly response", async () => {
    mockUpstream(async () =>
      upstreamResponse({
        hourly: {
          time: ["not-a-date"],
          temperature_2m: [],
          relative_humidity_2m: [],
          wind_speed_10m: [],
          surface_pressure: [],
          shortwave_radiation: [],
          direct_radiation: [],
          diffuse_radiation: [],
        },
      }),
    );
    const result = await postJson("/weather/shift", shiftBody);
    assert.equal(result.status, 502);
  });
});

test("overnight shifts include the next Phoenix calendar date and exclude the end time", async () => {
  const date = phoenixDateNow();
  const nextDate = new Date(`${date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateString = nextDate.toISOString().slice(0, 10);
  const calls = mockUpstream(async () =>
    upstreamResponse(
      forecastData([
        `${date}T21:00`,
        `${date}T22:00`,
        `${date}T23:00`,
        `${nextDateString}T00:00`,
        `${nextDateString}T01:00`,
        `${nextDateString}T02:00`,
      ]),
    ),
  );

  const result = await postJson("/weather/shift", {
    ...shiftBody,
    startTime: "22:00",
    endTime: "02:00",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.date, date);
  assert.deepEqual(
    result.body.hours.map(({ time }) => time),
    ["22:00", "23:00", "00:00", "01:00"],
  );
  assert.equal(calls.length, 1);
});

test("overnight shifts omit an incomplete hour and preserve usable hours across midnight", async () => {
  const date = phoenixDateNow();
  const nextDate = new Date(`${date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateString = nextDate.toISOString().slice(0, 10);
  mockUpstream(async () =>
    upstreamResponse(
      forecastData(
        [
          `${date}T22:00`,
          `${date}T23:00`,
          `${nextDateString}T00:00`,
          `${nextDateString}T01:00`,
        ],
        { relative_humidity_2m: [20, null, 20, 20] },
      ),
    ),
  );

  const result = await postJson("/weather/shift", {
    ...shiftBody,
    startTime: "22:00",
    endTime: "02:00",
  });

  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.hours.map(({ time }) => time),
    ["22:00", "00:00", "01:00"],
  );
  assert.deepEqual(result.body.missingHours, ["23:00"]);
});

test("overnight shifts preserve Phoenix dates across month-end, year-end, and leap day", async (t) => {
  const cases = [
    {
      name: "month-end",
      now: "2025-12-01T06:30:00.000Z",
      date: "2025-11-30",
      nextDate: "2025-12-01",
    },
    {
      name: "year-end",
      now: "2026-01-01T06:30:00.000Z",
      date: "2025-12-31",
      nextDate: "2026-01-01",
    },
    {
      name: "leap day",
      now: "2024-02-29T06:30:00.000Z",
      date: "2024-02-28",
      nextDate: "2024-02-29",
    },
  ];

  for (const boundary of cases) {
    await t.test(boundary.name, async () => {
      freezeTime(boundary.now);
      assert.equal(phoenixDateNow(), boundary.date);

      const calls = mockUpstream(async (url) => {
        assert.equal(url.searchParams.get("timezone"), "America/Phoenix");
        return upstreamResponse(
          forecastData([
            `${boundary.date}T21:00`,
            `${boundary.date}T22:00`,
            `${boundary.date}T23:00`,
            `${boundary.nextDate}T00:00`,
            `${boundary.nextDate}T01:00`,
            `${boundary.nextDate}T02:00`,
          ]),
        );
      });

      const result = await postJson("/weather/shift", {
        ...shiftBody,
        date: boundary.date,
        startTime: "22:00",
        endTime: "02:00",
      });

      assert.equal(result.status, 200);
      assert.equal(result.body.date, boundary.date);
      assert.equal(result.body.timezone, "America/Phoenix");
      assert.deepEqual(
        result.body.hours.map(({ time }) => time),
        ["22:00", "23:00", "00:00", "01:00"],
      );
      assert.equal(calls.length, 1);
    });
  }
});
