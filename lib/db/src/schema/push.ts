import { doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Push reminders that arrive while sombra is closed.

// One row per phone that turned on push reminders.
export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // Only a hash of the phone's manage token is stored, like a password.
    tokenHash: text("token_hash").notNull(),
    language: text("language").notNull().default("en"),
    // Rounded to about 1 km, only used to look up official heat warnings.
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    failures: integer("failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint)],
);

/** Daily check-on reminders ("care") and one-off Best time reminders ("window"). */
export const pushRemindersTable = pgTable(
  "push_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id").notNull().references(() => pushSubscriptionsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    timeLocal: text("time_local"),
    fireAt: timestamp("fire_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("push_reminders_unique_idx").on(table.subscriptionId, table.kind, table.key),
    index("push_reminders_subscription_idx").on(table.subscriptionId),
  ],
);

// What has already been sent, so a reminder never goes out twice.
export const pushSentTable = pgTable(
  "push_sent",
  {
    subscriptionId: uuid("subscription_id").notNull().references(() => pushSubscriptionsTable.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("push_sent_unique_idx").on(table.subscriptionId, table.dedupeKey)],
);

/** Small server settings, such as the push signing keys the server makes for itself on first run. */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;
export type PushReminderRow = typeof pushRemindersTable.$inferSelect;
