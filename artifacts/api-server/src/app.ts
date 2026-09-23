import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { billingWebhookRouter } from "./routes/billing";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./lib/http";
import { corsOptions } from "./lib/cors";
import { trustProxyHops } from "./lib/trust-proxy";

const app: Express = express();

// Something always terminates TLS in front of this process, so `req.ip` and
// `req.secure` are only correct once the proxies are trusted, and only as
// many of them as there really are. See lib/trust-proxy.ts.
app.set("trust proxy", trustProxyHops());

// Journals, letters and obituaries can be long-form; the 100kb default is
// tight enough that a single entry could be rejected.
const BODY_LIMIT = "1mb";

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
app.use(
  helmet({
    // This process serves JSON and uploaded files, never HTML, so a CSP
    // here would only constrain documents it does not produce. The
    // frontend ships its own.
    contentSecurityPolicy: false,
    // Uploaded photos are fetched by the frontend, which the platform
    // router serves from the same site.
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use(cors(corsOptions()));

// Stripe signs the exact bytes it sent, so this must be reachable before the
// global body parsers below consume the request stream. body-parser will not
// re-read a body that has already been read, so mounting this any later —
// even inside a sub-router — makes its own `express.raw()` a silent no-op and
// every legitimate webhook fails signature verification.
app.use("/api", billingWebhookRouter);

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(cookieParser());

app.use("/api", router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
