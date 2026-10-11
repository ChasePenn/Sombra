import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
let sequence = 0;

function storage() {
  return {
    getItem(key) { return this[key] ?? null; },
    setItem(key, value) { this[key] = String(value); },
    removeItem(key) { delete this[key]; },
  };
}

async function freshStore() {
  globalThis.window = { localStorage: storage() };
  return import(`../public/js/store.js?test=${++sequence}`);
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
});

const profile = {
  name: "Luis",
  language: "en",
  usualIntensity: "hard",
  newToHeat: false,
  notificationsEnabled: false,
};

test("guest profile, crew, shift and check-in work without a network request", async () => {
  const store = await freshStore();
  globalThis.fetch = () => { throw new Error("Guest must not need the network"); };
  await store.saveProfile(profile);
  await store.saveCrew([{ name: "Ana", intensity: "moderate", newToHeat: true }]);
  await store.saveShift({ date: "2026-10-10", location: "Phoenix", planJson: { hours: [] } });
  await store.saveCheckin({ workerName: "Luis", time: new Date().toISOString(), level: "checked-in", symptomsJson: [] });
  assert.equal((await store.getProfile()).name, "Luis");
  assert.equal((await store.getCrew())[0].name, "Ana");
  assert.equal((await store.getShifts()).length, 1);
  assert.equal((await store.getCheckins()).length, 1);
  await store.deleteAccount();
  assert.equal(await store.getProfile(), null);
  assert.equal((await store.getShifts()).length, 0);
});

test("account writes use cookie-backed routes and never send a trusted user ID", async () => {
  const store = await freshStore();
  store.setAccountSession("account-a");
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return { ok: true, status: 200, json: async () => profile };
  };
  await store.saveProfile(profile);
  assert.equal(calls[0].path, "/api/me/profile");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(JSON.parse(calls[0].options.body).userId, undefined);
  assert.equal(store.getLocalSnapshot().profile, null);
});

test("failed account save is explicit, not a silent local fallback", async () => {
  const store = await freshStore();
  store.setAccountSession("account-a");
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: "Try again shortly." }),
  });
  await assert.rejects(store.saveProfile(profile), /Try again shortly/);
  assert.equal(store.getLocalSnapshot().profile, null);
});

test("copying guest data marks only the account that handled the offer", async () => {
  const store = await freshStore();
  await store.saveProfile(profile);
  const snapshot = store.getLocalSnapshot();
  store.setAccountSession("account-a");
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ imported: true, reason: null }) });
  await store.importGuestData(snapshot, "account-a");
  assert.equal(store.hasImportedGuestData("account-a"), true);
  assert.equal(store.hasImportedGuestData("account-b"), false);
  assert.equal(store.getLocalSnapshot().profile.name, "Luis");
});

test("local storage failures are reported", async () => {
  const store = await freshStore();
  window.localStorage.setItem = () => { throw new Error("Quota exceeded"); };
  await assert.rejects(store.saveProfile(profile), /could not save on this device/);
});
