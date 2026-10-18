const LOCAL_KEYS = {
  profile: "sombra.profile",
  crew: "sombra.crew",
  shifts: "sombra.shifts",
  checkins: "sombra.checkins",
  sessions: "sombra.sessions",
  locale: "sombra.locale",
  mode: "sombra.mode",
  guestImportDone: "sombra.guest-import-done",
  signInPromptDismissed: "sombra.sign-in-prompt-dismissed",
  welcomeDismissed: "sombra.welcome-dismissed",
};

// Guests are the default and never touch the network.
let accountUserId = null;

export function setAccountSession(userId) {
  accountUserId = typeof userId === "string" && userId ? userId : null;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      ...options,
    });
  } catch {
    const error = new Error("Could not reach sombra. Check your connection and try again.");
    error.code = "OFFLINE";
    throw error;
  }

  if (response.status === 401) {
    const error = new Error("Sign in to access your saved data.");
    error.code = "SIGNED_OUT";
    throw error;
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(body?.error || "sombra could not save that yet. Try again.");
    error.code = response.status >= 500 ? "OFFLINE" : "REJECTED";
    throw error;
  }
  return body;
}

async function isSignedIn() {
  return accountUserId !== null;
}

function localRead(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    throw new Error("Saved information could not be read on this device.");
  }
}

function localWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("sombra could not save on this device. Check available storage and try again.");
  }
}

function localRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    throw new Error("sombra could not remove saved information from this device.");
  }
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ??
    `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getProfile() {
  if (await isSignedIn()) {
    return (await request("/api/me/profile")).profile;
  }
  const profile = localRead(LOCAL_KEYS.profile, null);
  return profile ? {
    ...profile,
    mode: profile.mode === "workers" ? "work" : profile.mode || getModePreference(),
  } : null;
}

export function getModePreference() {
  const mode = localRead(LOCAL_KEYS.mode, "work");
  if (mode === "workers") return "work";
  return typeof mode === "string" && /^[a-z][a-z0-9-]*$/.test(mode) ? mode : "work";
}

export function setModePreference(mode) {
  if (mode === "workers") mode = "work";
  if (typeof mode !== "string" || !/^[a-z][a-z0-9-]*$/.test(mode)) throw new TypeError("Choose a configured audience mode.");
  localWrite(LOCAL_KEYS.mode, mode);
}

export async function saveProfile(profile) {
  const normalized = {
    name: String(profile.name ?? "").trim(),
    language: profile.language === "es" ? "es" : "en",
    mode: profile.mode === "workers" ? "work" : typeof profile.mode === "string" && /^[a-z][a-z0-9-]*$/.test(profile.mode) ? profile.mode : "work",
    usualIntensity: profile.usualIntensity ?? "moderate",
    newToHeat: Boolean(profile.newToHeat),
    notificationsEnabled: Boolean(profile.notificationsEnabled),
  };
  setModePreference(normalized.mode);
  const signedIn = await isSignedIn();
  if (signedIn) {
    const saved = await request("/api/me/profile", {
      method: "PUT",
      body: JSON.stringify(normalized),
    });
    try {
      window.localStorage.setItem(LOCAL_KEYS.locale, saved.language);
    } catch {
      // The server copy wins; the embedded planner can still read this one.
    }
    return saved;
  }
  localWrite(LOCAL_KEYS.profile, normalized);
  try {
    window.localStorage.setItem(LOCAL_KEYS.locale, normalized.language);
  } catch {
    // saveProfile already reports local-storage failures through localWrite.
  }
  return normalized;
}

export async function getCrew() {
  if (await isSignedIn()) return request("/api/me/crew");
  return localRead(LOCAL_KEYS.crew, []);
}

export async function saveCrew(crew) {
  const normalized = crew.map(({ id, ...member }) => ({
    ...(id ? { id } : {}),
    name: String(member.name ?? "").trim(),
    intensity: member.intensity ?? "moderate",
    newToHeat: Boolean(member.newToHeat),
  }));
  if (await isSignedIn()) {
    return request("/api/me/crew", {
      method: "PUT",
      body: JSON.stringify({ crew: normalized }),
    });
  }
  localWrite(LOCAL_KEYS.crew, normalized.map((member) => ({
    ...member,
    id: member.id ?? newId(),
  })));
  return localRead(LOCAL_KEYS.crew, []);
}

export async function getShifts() {
  if (await isSignedIn()) return request("/api/me/shifts");
  return localRead(LOCAL_KEYS.shifts, []);
}

export async function saveShift(shift) {
  const normalized = {
    date: shift.date,
    location: shift.location,
    planJson: shift.planJson,
  };
  if (await isSignedIn()) {
    return request("/api/me/shifts", {
      method: "POST",
      body: JSON.stringify(normalized),
    });
  }
  const shifts = localRead(LOCAL_KEYS.shifts, []);
  const saved = { ...normalized, id: newId(), createdAt: new Date().toISOString() };
  localWrite(LOCAL_KEYS.shifts, [saved, ...shifts]);
  return saved;
}

export async function getCheckins() {
  if (await isSignedIn()) {
    const owner = accountUserId;
    try {
      const rows = await request("/api/me/checkins");
      const cache = activityCache(owner);
      cache.checkins = [...cache.pendingCheckins, ...rows.filter((c) => !cache.pendingCheckins.some((p) => p.id === c.id))];
      writeActivity(owner, cache);
      return cache.checkins;
    } catch (error) {
      if (error.code !== "OFFLINE") throw error;
      return activityCache(owner).checkins;
    }
  }
  return localRead(LOCAL_KEYS.checkins, []);
}

export async function saveCheckin(checkin) {
  const normalized = {
    id: checkin.id || newId(),
    workerName: String(checkin.workerName ?? "").trim(),
    time: checkin.time ?? new Date().toISOString(),
    level: String(checkin.level ?? "").trim(),
    symptomsJson: Array.isArray(checkin.symptomsJson) ? checkin.symptomsJson : [],
    ...(checkin.detailsJson ? { detailsJson: checkin.detailsJson } : {}),
  };
  if (await isSignedIn()) {
    const owner = accountUserId;
    let saved;
    try {
      saved = await request("/api/me/checkins", { method: "POST", body: JSON.stringify(normalized) });
    } catch (error) {
      if (error.code !== "OFFLINE") throw error;
      saved = { ...normalized, detailsJson: { ...normalized.detailsJson, pendingSync: true } };
      const cache = activityCache(owner);
      cache.pendingCheckins = [normalized, ...cache.pendingCheckins.filter((c) => c.id !== normalized.id)];
      cache.checkins = [saved, ...cache.checkins.filter((c) => c.id !== normalized.id)];
      writeActivity(owner, cache);
      activityChanged();
      return saved;
    }
    const cache = activityCache(owner);
    cache.checkins = [saved, ...cache.checkins.filter((c) => c.id !== saved.id)];
    cache.pendingCheckins = cache.pendingCheckins.filter((c) => c.id !== saved.id);
    writeActivity(owner, cache);
    activityChanged();
    return saved;
  }
  const checkins = localRead(LOCAL_KEYS.checkins, []);
  const saved = { ...normalized, createdAt: new Date().toISOString() };
  localWrite(LOCAL_KEYS.checkins, [saved, ...checkins]);
  activityChanged();
  return saved;
}

function activityChanged() {
  if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("sombra:activity"));
}
const activityKey = (owner) => `sombra.activity:${owner}`;
const sessionKey = (s) => `${s.date}:${s.workerName}`;
function activityCache(owner = accountUserId) {
  return localRead(activityKey(owner), { sessions: [], sessionsLoaded:false, checkins: [], pendingSessions: {}, pendingCheckins: [] });
}
function writeActivity(owner, cache) { localWrite(activityKey(owner), cache); }
export function hasPendingActivity() {
  if (!accountUserId) return false;
  const cache = activityCache();
  return Object.keys(cache.pendingSessions).length > 0 || cache.pendingCheckins.length > 0;
}
export async function getSessions() {
  if (!accountUserId) return localRead(LOCAL_KEYS.sessions, []);
  const owner = accountUserId;
  try {
    const sessions = await request("/api/me/sessions");
    const cache = activityCache(owner);
    cache.sessions = [...Object.values(cache.pendingSessions), ...sessions.filter((s) => !cache.pendingSessions[sessionKey(s)])];
    cache.sessionsLoaded = true;
    writeActivity(owner, cache);
    return cache.sessions;
  } catch (error) {
    if (error.code !== "OFFLINE") throw error;
    const cache = activityCache(owner);
    if (!cache.sessionsLoaded) throw error;
    return cache.sessions;
  }
}
export async function saveSession(session) {
  const key = sessionKey(session);
  if (!accountUserId) {
    const sessions = localRead(LOCAL_KEYS.sessions, []);
    localWrite(LOCAL_KEYS.sessions, [session, ...sessions.filter((s) => sessionKey(s) !== key)]);
    activityChanged();
    return session;
  }
  const owner = accountUserId;
  const initial = activityCache(owner);
  initial.sessions = [session, ...initial.sessions.filter((s) => sessionKey(s) !== key)];
  initial.pendingSessions[key] = session;
  writeActivity(owner, initial);
  try {
    const saved = await request("/api/me/sessions", {method:"PUT",body:JSON.stringify(session)});
    const cache = activityCache(owner);
    if (JSON.stringify(cache.pendingSessions[key]) === JSON.stringify(session)) {
      delete cache.pendingSessions[key];
      cache.sessions = [saved, ...cache.sessions.filter((s) => sessionKey(s) !== key)];
    }
    writeActivity(owner, cache);
    activityChanged();
    return saved;
  } catch (error) {
    activityChanged();
    if (error.code !== "OFFLINE") throw error;
    return session;
  }
}
let syncing = false;
export async function syncActivity() {
  if (!accountUserId || syncing || !hasPendingActivity()) return;
  const owner = accountUserId;
  syncing = true;
  try {
    // Never replay another account's offline records into the cookie's account.
    const identity = await request("/api/me/session");
    if (identity.userId !== owner) throw new Error("Sign in to the account that recorded this activity.");
    const pending = activityCache(owner);
    for (const [key, session] of Object.entries(pending.pendingSessions)) {
      if (accountUserId !== owner) return;
      await request("/api/me/sessions", {method:"PUT",body:JSON.stringify(session)});
      const cache = activityCache(owner);
      if (JSON.stringify(cache.pendingSessions[key]) === JSON.stringify(session)) delete cache.pendingSessions[key];
      writeActivity(owner, cache);
    }
    for (const checkin of pending.pendingCheckins) {
      if (accountUserId !== owner) return;
      const saved = await request("/api/me/checkins", {method:"POST",body:JSON.stringify(checkin)});
      const cache = activityCache(owner);
      cache.pendingCheckins = cache.pendingCheckins.filter((c) => c.id !== checkin.id);
      cache.checkins = [saved, ...cache.checkins.filter((c) => c.id !== saved.id)];
      writeActivity(owner, cache);
    }
    activityChanged();
  } finally { syncing = false; }
}

export function getLocalSnapshot() {
  return {
    profile: localRead(LOCAL_KEYS.profile, null),
    crew: localRead(LOCAL_KEYS.crew, []),
    shifts: localRead(LOCAL_KEYS.shifts, []),
    checkins: localRead(LOCAL_KEYS.checkins, []),
    sessions: localRead(LOCAL_KEYS.sessions, []),
  };
}

export function hasLocalData(snapshot = getLocalSnapshot()) {
  return Boolean(
    snapshot.profile ||
    snapshot.crew.length ||
    snapshot.shifts.length ||
    snapshot.checkins.length || snapshot.sessions?.length,
  );
}

export function hasImportedGuestData(userId) {
  if (!userId) return false;
  return localRead(`${LOCAL_KEYS.guestImportDone}:${userId}`, false) === true;
}

export function skipGuestImport(userId) {
  if (userId) localWrite(`${LOCAL_KEYS.guestImportDone}:${userId}`, true);
}

export function isSignInPromptDismissed() {
  return localRead(LOCAL_KEYS.signInPromptDismissed, false) === true;
}

export function dismissSignInPrompt() {
  localWrite(LOCAL_KEYS.signInPromptDismissed, true);
}

export function isWelcomeDismissed() {
  return localRead(LOCAL_KEYS.welcomeDismissed, false) === true;
}

export function dismissWelcome() {
  localWrite(LOCAL_KEYS.welcomeDismissed, true);
}

export async function importGuestData(snapshot = getLocalSnapshot(), userId) {
  if (!snapshot.profile) {
    throw new Error("Add your name and preferences before copying guest data.");
  }
  if (!userId) {
    throw new Error("Sign in before copying guest data.");
  }
  const result = await request("/api/me/import", {
    method: "POST",
    body: JSON.stringify({
      profile: snapshot.profile,
      crew: snapshot.crew,
      shifts: snapshot.shifts.map(({ date, location, planJson }) => ({
        date,
        location,
        planJson,
      })),
      checkins: snapshot.checkins.map(
        ({ id, workerName, time, level, symptomsJson, detailsJson }) => ({
          id,
          workerName,
          time,
          level,
          symptomsJson,
          detailsJson,
        }),
      ),
      sessions: snapshot.sessions || [],
    }),
  });
  localWrite(`${LOCAL_KEYS.guestImportDone}:${userId}`, true);
  return result;
}

export function clearLocalData() {
  for (const key of Object.values(LOCAL_KEYS)) localRemove(key);
  try {
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (key.startsWith(`${LOCAL_KEYS.guestImportDone}:`) || key.startsWith("sombra.activity:")) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    throw new Error("sombra could not remove saved information from this device.");
  }
}

export async function deleteAccount() {
  if (await isSignedIn()) {
    await request("/api/me/account", { method: "DELETE" });
  }
  clearLocalData();
}
