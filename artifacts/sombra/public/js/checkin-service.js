import { applySessionAction, emptySession, phoenixDate, sessionContext } from "@workspace/heat-safety/session";
import { evaluateSafety, enforceSafetyFloor } from "@workspace/heat-safety/safety";
import { fillTemplate } from "@workspace/heat-safety/templates";
import { buildWorkRestSchedule } from "../../lib/schedule.js";
import table from "../../config/work_rest_table.json" with { type: "json" };
import { getSessions, saveSession, getShifts, getCrew, getProfile, getCheckins, saveCheckin } from "./store.js";

function hourAt(date, time) {
  if (/^\d{2}:\d{2}$/.test(time)) return Date.parse(`${date}T${time}:00-07:00`);
  return Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(time) ? time : `${time}-07:00`);
}
export async function getWorkerSession(workerName) {
  const date = phoenixDate();
  let sessions;
  try { sessions = await getSessions(); }
  catch (error) {
    if (error.code === "OFFLINE") return {...emptySession(workerName,date),activityAvailable:false};
    throw error;
  }
  const session = sessions.find((s) => s.workerName === workerName && s.date === date) || emptySession(workerName, date);
  const [shiftsResult, crewResult, profileResult] = await Promise.allSettled([getShifts(), getCrew(), getProfile()]);
  const shifts = shiftsResult.status === "fulfilled" ? shiftsResult.value : [];
  const crew = crewResult.status === "fulfilled" ? crewResult.value : [];
  const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
  const today = shifts.filter((s) => s.date === date);
  const shift = today.find((s) => s.planJson.input?.workerName === workerName) || today[0];
  const forecast = shift?.planJson?.forecast;
  if (forecast?.hours?.length) {
    const member = crew.find((c) => c.name === workerName);
    const ownPlan = shift.planJson.input?.workerName === workerName;
    const intensity = ownPlan ? forecast.intensity : member?.intensity || forecast.intensity || profile?.usualIntensity;
    const newToHeat = ownPlan ? forecast.newToHeat : member?.newToHeat ?? forecast.newToHeat;
      const input = shift.planJson.input ?? {};
    const schedule = buildWorkRestSchedule({
      hours: forecast.hours.map((h) => ({time:h.time,wbgtF:h.wbgtSiteF ?? h.wbgtSunF})),
      intensity, newToHeat: Boolean(newToHeat), table,
        categoryIncrease: input.categoryIncrease === 1 ? 1 : 0,
        stopAtExtreme: input.stopAtExtreme === true,
    });
    session.planHours = schedule.hours.map((h) => {
      const at = hourAt(date,h.time);
      return {at,time:new Date(at-7*3600000).toISOString().slice(11,16),wbgtF:h.wbgtF,category:h.category,workMinutes:h.work === "NL" ? 60 : h.work,restMinutes:h.restMinutes,waterCups:h.waterCups};
    });
    session.siteType = [shift.planJson.siteSelection?.surface || input.surface, shift.planJson.siteSelection?.shade || input.shade || "full_sun"].filter(Boolean).join(", ");
  }
  return session;
}
const locks = new Map();
export function trackWorkerSession(workerName, action) {
  const previous = locks.get(workerName) || Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    const session = await getWorkerSession(workerName);
    if (session.activityAvailable === false) throw new Error("Reconnect to load recorded activity before changing it.");
    return saveSession(applySessionAction(session, action));
  });
  locks.set(workerName, job);
  job.finally(() => { if (locks.get(workerName) === job) locks.delete(workerName); }).catch(() => {});
  return job;
}
export const getResultContext = (session) => sessionContext(session);
export function localCheckinResult(session, symptoms, language, mode="workers") {
  const context = sessionContext(session);
  const level = evaluateSafety({...context,symptoms});
  return {level,...fillTemplate(level,context,language,mode),source:"template"};
}
export async function submitCheckin({session,symptoms,note="",language,mode="workers",signal}) {
  let sessionReadFailed = false;
  try {
    const saved = (await getSessions()).find((s)=>s.workerName === session.workerName && s.date === session.date);
    if (saved) session = {
      ...saved,
      planHours:session.planHours.length ? session.planHours : saved.planHours,
      siteType:session.siteType || saved.siteType,
    };
  } catch { sessionReadFailed = true; }
  const context = sessionContext(session);
  let result = localCheckinResult(session,symptoms,language,mode);
  let sessionSaveFailed = false;
  if (sessionReadFailed && session.activityAvailable !== false) sessionSaveFailed = true;
  else if (session.activityAvailable !== false) try { await saveSession(session); } catch { sessionSaveFailed = true; }
  let history = [];
  try { history = await getCheckins(); } catch { /* Safety guidance is independent of history availability. */ }
  if (signal?.aborted) throw new DOMException("Check-in cancelled", "AbortError");
  if (result.level !== "DANGER" && session.activityAvailable !== false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    const abort = () => controller.abort();
    signal?.addEventListener("abort",abort,{once:true});
    try {
      const response = await fetch("/api/check-in", {
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},signal:controller.signal,
        body:JSON.stringify({workerName:session.workerName,symptoms,note,language,mode,session,pastAnswers:history
          .filter((c) => c.workerName === session.workerName && phoenixDate(Date.parse(c.time)) === session.date)
          .slice(0,100).map((c) => ({time:c.time,level:c.level,symptoms:c.symptomsJson,note:c.detailsJson?.note || ""}))}),
      });
      const data = response.ok ? await response.json() : null;
      if (data && ["OK","CAUTION","DANGER"].includes(data.level) && typeof data.message === "string" &&
          typeof data.follow_up_question === "string" && Array.isArray(data.actions) &&
          data.actions.every((a) => typeof a === "string") && Number.isFinite(data.recheck_in_minutes)) {
        const level = enforceSafetyFloor(result.level,data.level);
        result = level === data.level ? {...data,level,actions:data.actions.slice(0,3),recheck_in_minutes:Math.max(15,Math.min(level === "CAUTION" ? 30 : 60,Math.round(data.recheck_in_minutes)))} : result;
      }
    } catch { /* Offline, timeout and invalid responses use the deterministic local template. */ }
    finally { clearTimeout(timer); signal?.removeEventListener("abort",abort); }
  }
  if (signal?.aborted) throw new DOMException("Check-in cancelled", "AbortError");
  const time = new Date().toISOString();
  const entry = {workerName:session.workerName,time,level:result.level,symptomsJson:[...symptoms],detailsJson:{
    note:note.slice(0,1000),language,mode,context,response:result,
    recheckAt:new Date(Date.parse(time)+result.recheck_in_minutes*60000).toISOString(),
  }};
  try {
    const checkin = await saveCheckin(entry);
    return {result,checkin,...(sessionSaveFailed ? {saveError:"SAVE_FAILED"} : {})};
  } catch {
    return {result,checkin:null,saveError:"SAVE_FAILED"};
  }
}
