import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { getAuth } from "@clerk/express";
import { PersonalizeCheckinBody, PersonalizeCheckinResponse } from "@workspace/api-zod";
import { evaluateSafety } from "@workspace/heat-safety/safety";
import { phoenixDate, sessionContext } from "@workspace/heat-safety/session";
import { fillTemplate, templates } from "@workspace/heat-safety/templates";
import { personalize } from "../../lib/ai.js";
import { validSession } from "../lib/session-validation";
import { sombraData } from "../lib/sombra-data";

export function createCheckInRouter(dependencies: {
  getUserId?: (req:Request)=>string|undefined;
  store?: typeof sombraData;
  personalize?: typeof personalize;
  now?:()=>number;
} = {}) {
  const router = Router();
  const store = dependencies.store ?? sombraData;
  const ai = dependencies.personalize ?? personalize;
  const now = dependencies.now ?? Date.now;
  const userIdFor = dependencies.getUserId ?? ((req:Request)=>getAuth(req).userId ?? undefined);
  const calls = new Map<string,number>();
  const guestSecret = randomUUID();
  const sign = (id:string) => createHmac("sha256",guestSecret).update(id).digest("hex");
  router.post("/check-in",async (req,res) => {
    const parsed = PersonalizeCheckinBody.safeParse(req.body);
    if (!parsed.success || parsed.data.workerName !== parsed.data.session.workerName || !validSession(parsed.data.session,now())) {
      res.status(400).json({error:"Check the recorded activity and symptoms, then try again."}); return;
    }
    const input = parsed.data;
    if (!templates.en.modes[input.mode ?? "workers"] || !templates.es.modes[input.mode ?? "workers"]) {
      res.status(400).json({error:"This audience mode does not have check-in guidance configured."}); return;
    }
    const userId = userIdFor(req);
    let session = input.session;
    let pastAnswers = (input.pastAnswers ?? []).filter((a)=>Number.isFinite(Date.parse(a.time)) && phoenixDate(Date.parse(a.time)) === session.date);
    if (userId) {
      const sessions = await store.getSessions(userId);
      session = sessions.find((s)=>s.workerName === input.workerName && s.date === input.session.date) ?? input.session;
      const history = await store.getCheckins(userId);
      pastAnswers = history.filter((c)=>c.workerName === input.workerName && phoenixDate(Date.parse(c.time)) === session.date).slice(0,100).map((c)=>({
        time:c.time,level:c.level,symptoms:c.symptomsJson,note:typeof c.detailsJson.note === "string" ? c.detailsJson.note.slice(0,1000) : "",
      }));
    }
    const context = sessionContext(session,now());
    const level = evaluateSafety({...context,symptoms:input.symptoms});
    const fallback = () => ({level,...fillTemplate(level,context,input.language,input.mode),source:"template"});
    if (level === "DANGER") { res.json(PersonalizeCheckinResponse.parse(fallback())); return; }
    let identity = userId ? `account:${userId}` : "";
    if (!identity) {
      const cookie = (req.headers.cookie || "").split(";").map((c)=>c.trim()).find((c)=>c.startsWith("sombra_checkin_guest="))?.split("=")[1];
      const [id, signature] = (cookie || "").split(".");
      const expected = id && /^[0-9a-f-]{36}$/.test(id) ? sign(id) : "";
      const valid = signature && expected && signature.length === expected.length && timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
      const guestId = valid ? id : randomUUID();
      if (!valid) res.cookie("sombra_checkin_guest",`${guestId}.${sign(guestId)}`,{httpOnly:true,sameSite:"strict",secure:req.secure || req.headers["x-forwarded-proto"] === "https",maxAge:86400000,path:"/api"});
      identity = `guest:${guestId}`;
    }
    if (calls.size > 10000) for (const [key,at] of calls) if (now()-at > 60000) calls.delete(key);
    if (now() - (calls.get(identity) ?? -Infinity) < 5000) { res.json(PersonalizeCheckinResponse.parse(fallback())); return; }
    calls.set(identity,now());
    const result = await ai({level,context,language:input.language,mode:input.mode,symptoms:input.symptoms,note:input.note,pastAnswers},{
      onFailure:({kind,status,code})=>req.log?.warn({kind,status,code},"Check-in personalization unavailable; used standard guidance"),
    });
    // The model never owns the level, even with a substituted provider.
    res.json(PersonalizeCheckinResponse.parse({...result,level,recheck_in_minutes:Math.max(15,Math.min(level === "CAUTION" ? 30 : 60,result.recheck_in_minutes))}));
  });
  return router;
}
export default createCheckInRouter();
