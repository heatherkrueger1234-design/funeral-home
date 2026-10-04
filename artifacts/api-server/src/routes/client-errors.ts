import { Router, type IRouter } from "express";
import { ReportClientErrorBody } from "@workspace/api-zod";
import { parseBody } from "../lib/http";
import { reportError, scrubPath, scrubText } from "../lib/error-tracking";

const router: IRouter = Router();

/**
 * A screen that crashed in somebody's browser.
 *
 * Without this, the first anybody here heard of a broken screen was a
 * director saying so -- and a family who met a blank page was never heard
 * from at all, because they have no account to complain from and every
 * reason not to bother. Each front end catches its own failures and sends
 * them here rather than to a third party directly, which keeps every
 * family's IP address off a vendor's servers (the same reason the fonts are
 * self-hosted) and keeps the CSP's `connect-src` to this origin.
 *
 * Nothing is stored. The report is scrubbed again on arrival -- the browser
 * already strips a family link's token, but the server does not take that on
 * trust -- logged, and handed to the error tracker when one is configured.
 */
router.post("/", (req, res) => {
  const report = parseBody(ReportClientErrorBody, req.body);

  const message = scrubText(report.message).slice(0, 500);
  const path = scrubPath(report.path);
  const stack = report.stack ? scrubText(report.stack) : undefined;

  req.log.warn(
    { app: report.app, kind: report.kind, path, message },
    "A screen failed in a browser",
  );

  // Rebuilt as an Error so the tracker groups it by its own stack, and named
  // for where it happened, so a family-portal crash never hides among the
  // console's.
  const error = new Error(message);
  error.name = `${report.app} ${report.kind}`;
  if (stack) error.stack = stack;

  reportError(error, { source: report.app, route: path });

  res.status(204).end();
});

export default router;
