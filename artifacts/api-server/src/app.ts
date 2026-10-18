import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import { rateLimit, securityHeaders } from "./middlewares/security";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
app.disable("x-powered-by");
// Requests arrive through the deployment's proxy.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// The web app and API share an origin through artifact routing, so other websites get no cross-origin access at all.
app.use(cors({ origin: false }));
app.use(express.json({ limit: "200kb" }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", securityHeaders);
// Per network address, per minute.
app.use("/api/check-in", rateLimit({ limit: 60, windowMs: 60_000 }));
app.use(["/api/weather", "/api/conditions", "/api/places"], rateLimit({ limit: 120, windowMs: 60_000 }));
app.use("/api/push/run", rateLimit({ limit: 6, windowMs: 60_000 }));
app.use("/api/push", rateLimit({ limit: 60, windowMs: 60_000 }));
app.use("/api", rateLimit({ limit: 600, windowMs: 60_000 }));
app.use("/api", router);

// Errors answer in plain JSON and never include stack traces or file paths.
app.use((err: { status?: number; statusCode?: number; type?: string }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.type === "entity.parse.failed") return void res.status(400).json({ error: "That request wasn't valid JSON." });
  if (err.type === "entity.too.large") return void res.status(413).json({ error: "That request was too large." });
  req.log?.error({ err }, "Unhandled error");
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: "Something went wrong. Try again." });
});

export default app;
