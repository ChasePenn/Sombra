/*
  Decides which push reminders are due. Pure functions with no database or network, so
  every rule is easy to test. All times are Arizona time (UTC-7, no daylight saving).
*/

export type PushReminder = {
  kind: "care" | "window";
  key: string;
  timeLocal?: string | null; // "HH:MM", daily, for care
  fireAt?: Date | null; // one-off, for window
  doneAt?: Date | null; // when the person was last marked checked
};

export type HeatAlert = { event: string; ends: string | null };

export type PushPayload =
  | { type: "care"; key: string; stage: "first" | "overdue" | "afternoon" }
  | { type: "window"; key: string }
  | { type: "heat"; event: string; ends: string | null }
  | { type: "test" };

export type DueMessage = {
  dedupeKey: string;
  payload: PushPayload;
  ttlSeconds: number; // how long the push service should keep trying if the phone is off
  urgency: "normal" | "high";
  alsoMarkSent?: string[]; // earlier stages skipped because the server woke up late
};

const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;
export const ESCALATE_AFTER_MIN = 120;
const FIRST_WINDOW_MIN = 6 * 60; // don't send a morning reminder late at night
const OVERDUE_WINDOW_MIN = 8 * 60;
const AFTERNOON_START = 16 * 60; // 4 PM second check during heat warnings
const CHECKED_AFTER_FOR_AFTERNOON = 13 * 60; // a check after 1 PM counts for the afternoon
const DAY_END = 21 * 60; // nothing after 9 PM
const HEAT_ALERT_START = 6 * 60;
const WINDOW_LATE_MS = 30 * 60 * 1000;

export function phoenixParts(at: Date) {
  const iso = new Date(at.getTime() - PHOENIX_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), minutes: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) };
}

export function clockMinutes(value: string | null | undefined) {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function dueMessages({
  now,
  reminders,
  sent,
  heatAlert,
}: {
  now: Date;
  reminders: PushReminder[];
  sent: Set<string>;
  heatAlert: HeatAlert | null;
}): DueMessage[] {
  const { date: today, minutes: nowMin } = phoenixParts(now);
  const out: DueMessage[] = [];

  for (const reminder of reminders) {
    if (reminder.kind === "care") {
      const time = clockMinutes(reminder.timeLocal);
      if (time === null) continue;
      const done = reminder.doneAt ? phoenixParts(reminder.doneAt) : null;
      const doneToday = done?.date === today;
      const key = (stage: string) => `care:${reminder.key}:${today}:${stage}`;
      const firstDue = !doneToday && nowMin >= time && nowMin < Math.min(time + FIRST_WINDOW_MIN, DAY_END);
      const overdueDue = !doneToday && nowMin >= time + ESCALATE_AFTER_MIN && nowMin < Math.min(time + OVERDUE_WINDOW_MIN, DAY_END);
      const afternoonDue = Boolean(heatAlert) && nowMin >= AFTERNOON_START && nowMin < DAY_END &&
        !(doneToday && done!.minutes >= CHECKED_AFTER_FOR_AFTERNOON);

      // If the server woke up late, send only the most urgent stage and skip the ones it replaces.
      if (overdueDue && !sent.has(key("overdue"))) {
        out.push({ dedupeKey: key("overdue"), payload: { type: "care", key: reminder.key, stage: "overdue" }, ttlSeconds: 2 * 3600, urgency: "high", alsoMarkSent: [key("first")] });
      } else if (firstDue && !sent.has(key("first")) && !sent.has(key("overdue"))) {
        out.push({ dedupeKey: key("first"), payload: { type: "care", key: reminder.key, stage: "first" }, ttlSeconds: 2 * 3600, urgency: "high" });
      } else if (afternoonDue && !sent.has(key("afternoon"))) {
        out.push({ dedupeKey: key("afternoon"), payload: { type: "care", key: reminder.key, stage: "afternoon" }, ttlSeconds: 2 * 3600, urgency: "high" });
      }
    } else if (reminder.kind === "window" && reminder.fireAt) {
      const lateBy = now.getTime() - reminder.fireAt.getTime();
      const dedupeKey = `window:${reminder.key}`;
      if (lateBy >= 0 && lateBy < WINDOW_LATE_MS && !sent.has(dedupeKey)) {
        out.push({ dedupeKey, payload: { type: "window", key: reminder.key }, ttlSeconds: 30 * 60, urgency: "normal" });
      }
    }
  }

  if (heatAlert && nowMin >= HEAT_ALERT_START && nowMin < DAY_END) {
    const dedupeKey = `heat:${heatAlert.event}:${heatAlert.ends ?? today}`;
    if (!sent.has(dedupeKey)) {
      out.push({ dedupeKey, payload: { type: "heat", event: heatAlert.event, ends: heatAlert.ends }, ttlSeconds: 3 * 3600, urgency: "high" });
    }
  }
  return out;
}

/** Checks and cleans what the phone sends, so the scheduler only ever sees sane reminders. */
export function parseReminders(input: unknown): PushReminder[] | null {
  if (!Array.isArray(input) || input.length > 50) return null;
  const out: PushReminder[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    if (typeof r.key !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(r.key)) return null;
    const doneAt = typeof r.doneAt === "string" && !Number.isNaN(Date.parse(r.doneAt)) ? new Date(r.doneAt) : null;
    if (r.kind === "care") {
      if (typeof r.time !== "string" || clockMinutes(r.time) === null) return null;
      out.push({ kind: "care", key: r.key, timeLocal: r.time, doneAt });
    } else if (r.kind === "window") {
      if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) return null;
      out.push({ kind: "window", key: r.key, fireAt: new Date(r.at) });
    } else {
      return null;
    }
  }
  return out;
}
