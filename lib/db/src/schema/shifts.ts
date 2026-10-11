import { date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const shiftsTable = pgTable(
  "shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    location: text("location").notNull(),
    planJson: jsonb("plan_json").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("shifts_user_id_idx").on(table.userId)],
);

export type SombraShift = typeof shiftsTable.$inferSelect;
export type NewSombraShift = typeof shiftsTable.$inferInsert;
