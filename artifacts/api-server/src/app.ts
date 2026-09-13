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

/**
 * How many proxies are in front of this process.
 *
 * One by default, which is the nginx in this repo — and was the only shape
 * that existed when this was hard-coded. It stops being right the moment a
 * second front end shares a domain with this one, because the thing that
 * terminates TLS for both then sits in front of that nginx and there are two.
 *
 * Getting it wrong is quiet and expensive. Express counts hops back from the
 * socket to decide which entry in `X-Forwarded-For` is the client, so one hop
 * too few makes `req.ip` the address of the *proxy* — identical for every
 * request on earth. The rate limiters then bucket the entire internet into one
 * key, and the public front door's thirty-a-minute ceiling is shared by every
 * grieving family at once.
 */
function trustedProxyHops(): number {
  const raw = process.env["TRUSTED_PROXY_HOPS"];
  if (raw === undefined || raw === "") return 1;

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `TRUSTED_PROXY_HOPS must be a non-negative integer, got "${raw}". ` +
        "It is the number of proxies between the internet and this process: " +
        "1 for the nginx in this repo on its own, 2 with a TLS terminator in " +
        "front of that.",
    );
  }

  return value;
}

// Whatever terminates TLS proxies to this process, so `req.ip` and the
// `secure` cookie flag are only correct once the right number of hops is
// trusted.
app.set("trust proxy", trustedProxyHops());

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
