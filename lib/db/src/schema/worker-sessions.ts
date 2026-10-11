import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { WorkerSession } from "@workspace/heat-safety/session";

export const workerSessionsTable = pgTable("worker_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  workerName: text("worker_name").notNull(),
  date: text("date").notNull(),
  stateJson: jsonb("state_json").$type<WorkerSession>().notNull(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
}, (table) => [uniqueIndex("worker_sessions_user_worker_date_idx").on(table.userId, table.workerName, table.date)]);
