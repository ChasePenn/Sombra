import webpush from "web-push";
import { pool } from "@workspace/db";
import type { PushConfig } from "./push-send";

// Push works with zero setup.
export const PUSH_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS "app_settings" (
    "key" text PRIMARY KEY NOT NULL,
    "value" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "endpoint" text NOT NULL,
    "p256dh" text NOT NULL,
    "auth" text NOT NULL,
    "token_hash" text NOT NULL,
    "language" text DEFAULT 'en' NOT NULL,
    "lat" double precision,
    "lon" double precision,
    "failures" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint")`,
  `CREATE TABLE IF NOT EXISTS "push_reminders" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "subscription_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "key" text NOT NULL,
    "time_local" text,
    "fire_at" timestamp with time zone,
    "done_at" timestamp with time zone,
    CONSTRAINT "push_reminders_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "push_reminders_unique_idx" ON "push_reminders" USING btree ("subscription_id","kind","key")`,
  `CREATE INDEX IF NOT EXISTS "push_reminders_subscription_idx" ON "push_reminders" USING btree ("subscription_id")`,
  `CREATE TABLE IF NOT EXISTS "push_sent" (
    "subscription_id" uuid NOT NULL,
    "dedupe_key" text NOT NULL,
    "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "push_sent_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "push_sent_unique_idx" ON "push_sent" USING btree ("subscription_id","dedupe_key")`,
];

let schemaReady: Promise<void> | null = null;

// Creates the push tables once per process if they're missing.
export function ensurePushSchema() {
  schemaReady ??= (async () => {
    const client = await pool.connect();
    try {
      // One server at a time, so two instances starting together can't trip over each other.
      await client.query("SELECT pg_advisory_lock(727401)");
      for (const statement of PUSH_SCHEMA_SQL) await client.query(statement);
    } finally {
      await client.query("SELECT pg_advisory_unlock(727401)").catch(() => {});
      client.release();
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

let configPromise: Promise<PushConfig> | null = null;
const SUBJECT = () => process.env.VAPID_SUBJECT?.trim() || "https://sombraheat.com";

// The server's push signing keys.
export function getPushConfig(): Promise<PushConfig> {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return Promise.resolve({ publicKey, privateKey, subject: SUBJECT() });
  configPromise ??= (async () => {
    await ensurePushSchema();
    const read = async () => (await pool.query("SELECT value FROM app_settings WHERE key = 'vapid'")).rows[0]?.value as string | undefined;
    let stored = await read();
    if (!stored) {
      const fresh = webpush.generateVAPIDKeys();
      // If another server made a pair at the same moment, its pair wins and both use it.
      await pool.query("INSERT INTO app_settings (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(fresh)]);
      stored = await read();
    }
    const keys = JSON.parse(stored!) as { publicKey: string; privateKey: string };
    return { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: SUBJECT() };
  })().catch((error) => {
    configPromise = null;
    throw error;
  });
  return configPromise;
}

/** For tests: forget cached keys and schema state. */
export function resetPushSetupForTests() {
  schemaReady = null;
  configPromise = null;
}
