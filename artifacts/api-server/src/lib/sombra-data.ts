import { and, desc, eq } from "drizzle-orm";
import { emptySession, phoenixDate, sessionContext, type WorkerSession } from "@workspace/heat-safety/session";
import { evaluateSafety, enforceSafetyFloor } from "@workspace/heat-safety/safety";
import { fillTemplate } from "@workspace/heat-safety/templates";
import {
  checkinsTable,
  crewMembersTable,
  db,
  profilesTable,
  shiftsTable,
  workerSessionsTable,
} from "@workspace/db";

export type ProfileInput = {
  name: string;
  language: "en" | "es";
  mode?: string;
  usualIntensity: "easy" | "moderate" | "hard";
  newToHeat: boolean;
  notificationsEnabled: boolean;
};

export type CrewInput = {
  name: string;
  intensity: "easy" | "moderate" | "hard";
  newToHeat: boolean;
};

export type SavedShiftInput = {
  date: string;
  location: string;
  planJson: Record<string, unknown>;
};

export type CheckinInput = {
  id?: string;
  workerName: string;
  time: string;
  level: string;
  symptomsJson: string[];
  detailsJson?: Record<string, unknown>;
};

function safeCheckin(input: CheckinInput, sessions: WorkerSession[]) {
  // Older check-ins only recorded attendance; keep them. New ones always go through the safety rules.
  if (!["OK","CAUTION","DANGER"].includes(input.level) && input.symptomsJson.length === 0) return input;
  const at = Date.parse(input.time);
  const session = sessions.find((s)=>s.workerName === input.workerName && s.date === phoenixDate(at)) ?? emptySession(input.workerName,phoenixDate(at));
  const context = sessionContext(session,at);
  const ruleLevel = evaluateSafety({...context,symptoms:input.symptomsJson});
  const level = enforceSafetyFloor(ruleLevel,input.level);
  const language = input.detailsJson?.language === "es" ? "es" : "en";
  const mode = typeof input.detailsJson?.mode === "string" ? input.detailsJson.mode : "work";
  const details = {...input.detailsJson,context};
  if (level === "DANGER" || level !== input.level) {
    Object.assign(details,{response:{level,...fillTemplate(level,context,language,mode),source:"template"},recheckAt:new Date(at+15*60000).toISOString()});
  }
  delete (details as Record<string,unknown>).pendingSync;
  return {...input,level,detailsJson:details};
}

function profileView(profile: typeof profilesTable.$inferSelect) {
  return {
    name: profile.name,
    language: profile.language as "en" | "es",
    mode: profile.mode,
    usualIntensity: profile.usualIntensity as "easy" | "moderate" | "hard",
    newToHeat: profile.newToHeat,
    notificationsEnabled: profile.notificationsEnabled,
  };
}

function shiftView(shift: typeof shiftsTable.$inferSelect) {
  return {
    id: shift.id,
    date: shift.date,
    location: shift.location,
    planJson: shift.planJson,
    createdAt: shift.createdAt.toISOString(),
  };
}

function checkinView(checkin: typeof checkinsTable.$inferSelect) {
  return {
    id: checkin.id,
    workerName: checkin.workerName,
    time: checkin.time.toISOString(),
    level: checkin.level,
    symptomsJson: checkin.symptomsJson,
    detailsJson: checkin.detailsJson,
    createdAt: checkin.createdAt.toISOString(),
  };
}

export const sombraData = {
  async getProfile(userId: string) {
    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .limit(1);
    return profile ? profileView(profile) : null;
  },

  async saveProfile(userId: string, input: ProfileInput) {
    const normalized = { ...input, mode: input.mode ?? "work" };
    const [profile] = await db
      .insert(profilesTable)
      .values({ userId, ...normalized })
      .onConflictDoUpdate({
        target: profilesTable.userId,
        set: { ...normalized, updatedAt: new Date() },
      })
      .returning();
    return profileView(profile);
  },

  async getCrew(userId: string) {
    return db
      .select({
        id: crewMembersTable.id,
        name: crewMembersTable.name,
        intensity: crewMembersTable.intensity,
        newToHeat: crewMembersTable.newToHeat,
      })
      .from(crewMembersTable)
      .where(eq(crewMembersTable.ownerId, userId))
      .orderBy(crewMembersTable.createdAt);
  },

  async saveCrew(userId: string, crew: CrewInput[]) {
    return db.transaction(async (tx) => {
      await tx
        .delete(crewMembersTable)
        .where(eq(crewMembersTable.ownerId, userId));
      if (crew.length === 0) return [];
      return tx
        .insert(crewMembersTable)
        .values(crew.map((member) => ({ ...member, ownerId: userId })))
        .returning({
          id: crewMembersTable.id,
          name: crewMembersTable.name,
          intensity: crewMembersTable.intensity,
          newToHeat: crewMembersTable.newToHeat,
        });
    });
  },

  async getShifts(userId: string) {
    const shifts = await db
      .select()
      .from(shiftsTable)
      .where(eq(shiftsTable.userId, userId))
      .orderBy(desc(shiftsTable.createdAt));
    return shifts.map(shiftView);
  },

  async saveShift(userId: string, input: SavedShiftInput) {
    const [shift] = await db
      .insert(shiftsTable)
      .values({ ...input, userId })
      .returning();
    return shiftView(shift);
  },

  async getCheckins(userId: string) {
    const checkins = await db
      .select()
      .from(checkinsTable)
      .where(eq(checkinsTable.userId, userId))
      .orderBy(desc(checkinsTable.time));
    return checkins.map(checkinView);
  },

  async getSessions(userId: string): Promise<WorkerSession[]> {
    const rows = await db.select({state:workerSessionsTable.stateJson}).from(workerSessionsTable).where(eq(workerSessionsTable.userId,userId)).orderBy(desc(workerSessionsTable.updatedAt));
    return rows.map((row)=>row.state);
  },

  async saveSession(userId: string, session: WorkerSession) {
    const [row] = await db.insert(workerSessionsTable).values({userId,workerName:session.workerName,date:session.date,stateJson:session}).onConflictDoUpdate({
      target:[workerSessionsTable.userId,workerSessionsTable.workerName,workerSessionsTable.date],
      set:{stateJson:session,updatedAt:new Date()},
    }).returning();
    return row.stateJson;
  },

  async saveCheckin(userId: string, input: CheckinInput) {
    input = safeCheckin(input, await this.getSessions(userId));
    const checkinTime = new Date(input.time);
    const [checkin] = await db
      .insert(checkinsTable)
      .values({
        ...(input.id ? {id:input.id} : {}),
        userId,
        workerName: input.workerName,
        time: checkinTime,
        level: input.level,
        symptomsJson: input.symptomsJson,
        detailsJson: input.detailsJson ?? {},
      })
      .onConflictDoNothing({target:checkinsTable.id})
      .returning();
    if (checkin) return checkinView(checkin);
    const [existing] = await db.select().from(checkinsTable).where(and(eq(checkinsTable.id,input.id!),eq(checkinsTable.userId,userId))).limit(1);
    if (!existing) throw new Error("Check-in could not be saved.");
    return checkinView(existing);
  },

  async importGuestData(
    userId: string,
    data: {
      profile: ProfileInput;
      crew: CrewInput[];
      shifts: SavedShiftInput[];
      checkins: CheckinInput[];
      sessions?: WorkerSession[];
    },
  ) {
    return db.transaction(async (tx) => {
      await tx
        .insert(profilesTable)
        .values({ userId, ...data.profile, mode: data.profile.mode ?? "work" })
        .onConflictDoNothing({ target: profilesTable.userId });
      const [existing] = await tx
        .select({
          userId: profilesTable.userId,
          importedAt: profilesTable.guestDataImportedAt,
        })
        .from(profilesTable)
        .where(eq(profilesTable.userId, userId))
        .limit(1)
        .for("update");
      if (existing?.importedAt) {
        return { imported: false, reason: "already-imported" as const };
      }

      await tx
        .update(profilesTable)
        .set({ ...data.profile, mode: data.profile.mode ?? "work", guestDataImportedAt: new Date(), updatedAt: new Date() })
        .where(eq(profilesTable.userId, userId));

      if (data.crew.length > 0) {
        await tx.insert(crewMembersTable).values(
          data.crew.map((member) => ({ ...member, ownerId: userId })),
        );
      }
      if (data.shifts.length > 0) {
        await tx
          .insert(shiftsTable)
          .values(data.shifts.map((shift) => ({ ...shift, userId })));
      }
      if (data.checkins.length > 0) {
        await tx.insert(checkinsTable).values(
          data.checkins.map((original) => {
            const checkin = safeCheckin(original,data.sessions ?? []);
            return {
            userId,
            workerName: checkin.workerName,
            time: new Date(checkin.time),
            level: checkin.level,
            symptomsJson: checkin.symptomsJson,
            detailsJson: checkin.detailsJson ?? {},
          };}),
        );
      }
      if (data.sessions?.length) {
        await tx.insert(workerSessionsTable).values(data.sessions.map((session)=>({userId,workerName:session.workerName,date:session.date,stateJson:session}))).onConflictDoNothing();
      }
      return { imported: true, reason: null };
    });
  },

  async deleteUserData(userId: string) {
    await db.transaction(async (tx) => {
      await tx.delete(workerSessionsTable).where(eq(workerSessionsTable.userId,userId));
      await tx
        .delete(checkinsTable)
        .where(eq(checkinsTable.userId, userId));
      await tx.delete(shiftsTable).where(eq(shiftsTable.userId, userId));
      await tx
        .delete(crewMembersTable)
        .where(eq(crewMembersTable.ownerId, userId));
      await tx.delete(profilesTable).where(eq(profilesTable.userId, userId));
    });
  },
};
