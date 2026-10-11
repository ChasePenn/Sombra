import { boolean, text, timestamp, uuid, pgTable, index } from "drizzle-orm/pg-core";

export const crewMembersTable = pgTable(
  "crew_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    intensity: text("intensity").notNull(),
    newToHeat: boolean("new_to_heat").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("crew_members_owner_id_idx").on(table.ownerId)],
);

export type CrewMember = typeof crewMembersTable.$inferSelect;
export type NewCrewMember = typeof crewMembersTable.$inferInsert;
