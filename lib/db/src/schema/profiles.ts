import { boolean, text, timestamp, pgTable } from "drizzle-orm/pg-core";

export const profilesTable = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull(),
  language: text("language").notNull().default("en"),
  mode: text("mode").notNull().default("work"),
  usualIntensity: text("usual_intensity").notNull().default("moderate"),
  newToHeat: boolean("new_to_heat").notNull().default(false),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(false),
  guestDataImportedAt: timestamp("guest_data_imported_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SombraProfile = typeof profilesTable.$inferSelect;
export type NewSombraProfile = typeof profilesTable.$inferInsert;
