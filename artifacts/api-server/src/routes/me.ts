import { clerkClient, getAuth } from "@clerk/express";
import { Router, type Request, type Response } from "express";
import {
  DeleteMyAccountResponse,
  GetMyCheckinsResponse,
  GetMyCrewResponse,
  GetMyProfileResponse,
  GetMySessionResponse,
  GetMyShiftsResponse,
  ImportMyGuestDataBody,
  ImportMyGuestDataResponse,
  SaveMyCheckinBody,
  SaveMyCheckinResponse,
  SaveMyCrewBody,
  SaveMyCrewResponse,
  SaveMyProfileBody,
  SaveMyProfileResponse,
  SaveMyShiftBody,
  SaveMyShiftResponse,
  GetMyWorkerSessionsResponse,
  SaveMyWorkerSessionBody,
  SaveMyWorkerSessionResponse,
} from "@workspace/api-zod";
import { SYMPTOM_IDS } from "@workspace/heat-safety/safety";
import { validSession } from "../lib/session-validation";
import { sombraData } from "../lib/sombra-data";

type UserRequest = Request & { sombraUserId?: string };
type RouterDependencies = {
  store?: typeof sombraData;
  getUserId?: (req: Request) => string | undefined;
  deleteAuthUser?: (userId: string) => Promise<void>;
};

const errorBody = (error: string) => ({ error });

function invalidBody(req: Request, res: Response, message: string) {
  req.log.warn("Rejected invalid account data");
  res.status(400).json(errorBody(message));
}
const validCheckin = (c: {level:string;symptomsJson:string[];detailsJson?:Record<string,unknown>}) =>
  (!["OK","CAUTION","DANGER"].includes(c.level) || c.symptomsJson.every((s)=>SYMPTOM_IDS.includes(s))) &&
  (c.detailsJson?.mode === undefined || (typeof c.detailsJson.mode === "string" && /^[a-z][a-z0-9-]*$/.test(c.detailsJson.mode))) &&
  (c.detailsJson?.note === undefined || (typeof c.detailsJson.note === "string" && c.detailsJson.note.length <= 1000));

export function createMeRouter(dependencies: RouterDependencies = {}) {
  const router = Router();
  const store = dependencies.store ?? sombraData;
  const getUserId =
    dependencies.getUserId ??
    ((req: Request) => getAuth(req).userId ?? undefined);
  const deleteAuthUser =
    dependencies.deleteAuthUser ??
    (async (userId: string) => {
      await clerkClient.users.deleteUser(userId);
    });

  router.use((req, res, next) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json(errorBody("Sign in to access your saved data."));
      return;
    }
    (req as UserRequest).sombraUserId = userId;
    next();
  });

  router.get("/me/session", (req, res) => {
    res.json(
      GetMySessionResponse.parse({
        authenticated: true,
        userId: (req as UserRequest).sombraUserId!,
      }),
    );
  });

  router.get("/me/profile", async (req, res) => {
    const profile = await store.getProfile((req as UserRequest).sombraUserId!);
    res.json(GetMyProfileResponse.parse({ profile }));
  });

  router.put("/me/profile", async (req, res) => {
    const parsed = SaveMyProfileBody.safeParse(req.body);
    if (!parsed.success) {
      invalidBody(req, res, "Check the profile details and try again.");
      return;
    }
    const profile = await store.saveProfile(
      (req as UserRequest).sombraUserId!,
      parsed.data,
    );
    res.json(SaveMyProfileResponse.parse(profile));
  });

  router.get("/me/crew", async (req, res) => {
    const crew = await store.getCrew((req as UserRequest).sombraUserId!);
    res.json(GetMyCrewResponse.parse(crew));
  });

  router.put("/me/crew", async (req, res) => {
    const parsed = SaveMyCrewBody.safeParse(req.body);
    if (!parsed.success) {
      invalidBody(req, res, "Check the crew details and try again.");
      return;
    }
    const crew = await store.saveCrew(
      (req as UserRequest).sombraUserId!,
      parsed.data.crew,
    );
    res.json(SaveMyCrewResponse.parse(crew));
  });

  router.get("/me/shifts", async (req, res) => {
    const shifts = await store.getShifts(
      (req as UserRequest).sombraUserId!,
    );
    res.json(GetMyShiftsResponse.parse(shifts));
  });

  router.post("/me/shifts", async (req, res) => {
    const parsed = SaveMyShiftBody.safeParse(req.body);
    if (!parsed.success) {
      invalidBody(req, res, "Check the shift details and try again.");
      return;
    }
    const shift = await store.saveShift(
      (req as UserRequest).sombraUserId!,
      parsed.data,
    );
    res.status(201).json(SaveMyShiftResponse.parse(shift));
  });

  router.get("/me/checkins", async (req, res) => {
    const checkins = await store.getCheckins(
      (req as UserRequest).sombraUserId!,
    );
    res.json(GetMyCheckinsResponse.parse(checkins));
  });

  router.get("/me/sessions",async (req,res)=>{
    res.json(GetMyWorkerSessionsResponse.parse(await store.getSessions((req as UserRequest).sombraUserId!)));
  });
  router.put("/me/sessions",async (req,res)=>{
    const parsed = SaveMyWorkerSessionBody.safeParse(req.body);
    if (!parsed.success || !validSession(parsed.data)) { invalidBody(req,res,"Check the recorded activity and try again."); return; }
    res.json(SaveMyWorkerSessionResponse.parse(await store.saveSession((req as UserRequest).sombraUserId!,parsed.data)));
  });

  router.post("/me/checkins", async (req, res) => {
    const parsed = SaveMyCheckinBody.safeParse(req.body);
    if (!parsed.success || Number.isNaN(Date.parse(parsed.data?.time ?? "")) || !validCheckin(parsed.data)) {
      invalidBody(req, res, "Check the check-in details and try again.");
      return;
    }
    const checkin = await store.saveCheckin(
      (req as UserRequest).sombraUserId!,
      parsed.data,
    );
    res.status(201).json(SaveMyCheckinResponse.parse(checkin));
  });

  router.post("/me/import", async (req, res) => {
    const parsed = ImportMyGuestDataBody.safeParse(req.body);
    if (
      !parsed.success ||
      parsed.data.checkins.some((checkin) => Number.isNaN(Date.parse(checkin.time)) || !validCheckin(checkin)) ||
      parsed.data.sessions?.some((session)=>!validSession(session))
    ) {
      invalidBody(req, res, "Guest data could not be imported. Check it and try again.");
      return;
    }
    const result = await store.importGuestData(
      (req as UserRequest).sombraUserId!,
      parsed.data,
    );
    res.json(ImportMyGuestDataResponse.parse(result));
  });

  router.delete("/me/account", async (req, res) => {
    const userId = (req as UserRequest).sombraUserId!;
    await store.deleteUserData(userId);
    try {
      await deleteAuthUser(userId);
    } catch (error) {
      req.log.error({ err: error }, "Sombra data removed but identity deletion failed");
      res.status(502).json(
        errorBody("Your Sombra data was removed, but account closure could not finish."),
      );
      return;
    }
    res.json(DeleteMyAccountResponse.parse({ deleted: true }));
  });

  return router;
}

export default createMeRouter();
