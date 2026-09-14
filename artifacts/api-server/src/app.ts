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

const app: Express = express();

/*
 * How many proxies are in front of this process.
 *
 * Both `req.secure` -- which decides whether a Secure session cookie is being
 * issued over a connection that can actually return it -- and the rate
 * limiter's idea of who the client is are read this many entries from the
 * right of X-Forwarded-For. So the number has to match the deployment, and
 * the two ways of getting it wrong fail differently:
 *
 *   too low  -- the rate limiter counts the innermost proxy's address as the
 *               client, so every family shares one bucket and one family's
 *               retries throttle everybody;
 *   too high -- a client can spoof its own address by sending an
 *               X-Forwarded-For, which hands it somebody else's rate budget.
 *
 * One is right for the single-proxy deployments: Replit, or this repo's
 * docker-compose.yml where nginx is the only hop. Two is right once TLS is
 * terminated in front of that nginx, which is what docker-compose.tls.yml
 * does and what any real host needs -- see DEPLOY.md.
 */
function trustProxyHops(): number {
  const raw = process.env["TRUST_PROXY_HOPS"];
  if (raw === undefined || raw.trim() === "") return 1;

  const hops = Number(raw);

  if (!Number.isInteger(hops) || hops < 0) {
    // Refuse rather than quietly fall back. A typo here is a security
    // setting that silently reverts to a value nobody chose.
    throw new Error(
      `TRUST_PROXY_HOPS must be a non-negative integer, got "${raw}".`,
    );
  }

  return hops;
}

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

/*
 * Stripe's webhook, ahead of every body parser.
 *
 * Stripe signs the exact bytes it sent, so verifying the signature needs
 * those bytes. `express.json()` below consumes the request stream and leaves
 * a parsed object behind, and body-parser will not read a stream twice -- so
 * a webhook mounted after it receives an object where it expects a Buffer,
 * hashes the string "[object Object]", and rejects every genuine event
 * Stripe ever sends. That is where this route used to be.
 *
 * Nothing else may be added above the parsers. This is the one route in the
 * application that needs the raw body, and it brings its own `express.raw()`.
 */
app.use("/api", billingWebhookRouter);

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(cookieParser());

app.use("/api", router);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
