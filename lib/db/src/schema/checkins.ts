import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const checkinsTable = pgTable(
  "checkins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    workerName: text("worker_name").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    level: text("level").notNull(),
    symptomsJson: jsonb("symptoms_json").$type<string[]>().notNull().default([]),
    detailsJson: jsonb("details_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("checkins_user_id_idx").on(table.userId)],
);

export type SombraCheckin = typeof checkinsTable.$inferSelect;
export type NewSombraCheckin = typeof checkinsTable.$inferInsert;
