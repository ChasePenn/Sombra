import type { Request } from "express";
import { getAuth } from "@clerk/express";

export const authEnabled = Boolean(process.env.CLERK_SECRET_KEY);

export function userIdOf(req: Request): string | undefined {
  return authEnabled ? (getAuth(req).userId ?? undefined) : undefined;
}
