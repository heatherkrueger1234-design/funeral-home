import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./lib/http";
import { corsOptions } from "./lib/cors";

const app: Express = express();

// Replit terminates TLS and proxies to this process, so `req.ip` and the
// `secure` cookie flag are only correct once the proxy is trusted.
app.set("trust proxy", 1);

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
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(cookieParser());

app.use("/api", router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
