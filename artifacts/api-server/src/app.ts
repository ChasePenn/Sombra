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
// Requests arrive through the deployment's proxy; trust exactly one hop so req.ip is the
// real client address for rate limiting (and can't be spoofed with extra headers).
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
// The web app and API share an origin through artifact routing, so other websites get no
// cross-origin access at all.
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
// Per network address, per minute. A whole class or crew on one school or work Wi-Fi shares
// an address, so these are generous; they exist to stop a script hammering the weather, map
// and AI services. Check-ins also keep their own 5-second AI limit per person.
app.use("/api/check-in", rateLimit({ limit: 60, windowMs: 60_000 }));
app.use(["/api/weather", "/api/conditions", "/api/places"], rateLimit({ limit: 120, windowMs: 60_000 }));
app.use("/api", rateLimit({ limit: 600, windowMs: 60_000 }));
app.use("/api", router);

export default app;
