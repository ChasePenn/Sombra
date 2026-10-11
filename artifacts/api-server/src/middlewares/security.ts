import type { NextFunction, Request, Response } from "express";

/*
  Basic protections for the API. This is not a full security review; it covers response
  headers and a per-address request limit so one client can't flood the weather, map and
  AI services sombra depends on.
*/

/** Standard safety headers for JSON API responses. */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Only promise HTTPS when the request actually arrived over HTTPS (the deployment's proxy says so).
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

type Window = { count: number; resetAt: number };

/**
 * Fixed-window limit per client address. Memory-only, so each server instance counts on
 * its own; that's fine for protecting upstream services, not a hard quota.
 */
export function rateLimit({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }) {
  const windows = new Map<string, Window>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const time = now();
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowMs };
      windows.set(key, entry);
      if (windows.size > 20_000) {
        for (const [k, w] of windows) if (w.resetAt <= time) windows.delete(k);
      }
    }
    entry.count += 1;
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    if (entry.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - time) / 1000)));
      res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
      return;
    }
    next();
  };
}
