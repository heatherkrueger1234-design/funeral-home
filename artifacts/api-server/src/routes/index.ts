import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/require-auth";
import { requireFamilyLink } from "../middleware/require-family";
import { familyRateLimit, publicRateLimit } from "../middleware/rate-limit";
import healthRouter from "./health";
import authRouter from "./auth";
import platformAuthRouter from "./platform-auth";
import tasksRouter from "./tasks";
import billingRouter from "./billing";
import familyRouter from "./family";
import publicRouter from "./public";
import intakeRouter from "./intake";
import homeRouter from "./home";
import casesRouter from "./cases";
import exportRouter from "./export";
import importRouter from "./import";
import contactsRouter from "./contacts";
import photosRouter from "./photos";
import obituaryRouter from "./obituary";
import selectionsRouter from "./selections";
import catalogueRouter from "./catalogue";
import ordersRouter, { familyStorefrontRouter } from "./orders";
import messagesRouter from "./messages";
import deadlinesRouter from "./deadlines";
import belongingsRouter from "./belongings";
import vendorsRouter from "./vendors";
import vitalsRouter from "./vitals";
import printRouter from "./print";
import aftercareRouter from "./aftercare";
import uploadsRouter from "./uploads";

const router: IRouter = Router();

/**
 * Three tiers, and the order they are mounted in is the security model.
 *
 * 1. Public: liveness, the endpoints used to obtain a staff session, and the
 *    home's own front door.
 * 2. The family surface, gated by a link token.
 * 3. The staff surface, gated by a session cookie.
 *
 * Both gates are mounted once, here, rather than per route file. Adding a
 * router below a gate cannot accidentally expose a family's photographs
 * because a handler forgot its middleware — the only way to be reachable
 * without authentication is to be mounted above one of these lines, which is
 * a visible edit to this file rather than an omission somewhere else.
 */

router.use(healthRouter);
router.use(authRouter);

/**
 * Signing in to the platform console. Above every gate for the same reason
 * the staff sign-in is: you cannot present a session cookie you do not have
 * yet. Everything else under `/admin` carries `requirePlatformAdmin`, which
 * attaches no tenant at all — see `middleware/require-platform-admin.ts` for
 * why an admin route cannot accidentally be written as a staff one.
 */
router.use(platformAuthRouter);

/**
 * The front door. Reachable with no credential at all, and the only place in
 * this API that an unauthenticated stranger can write to.
 *
 * It is mounted here, above every gate, on purpose and with its own limiter:
 * the people it exists for are a family whose person died an hour ago and
 * someone arranging their own funeral in advance, and neither of them has
 * been sent a link. What it cannot do is reach a case, or create one — a
 * request lands in a queue a director accepts, which is what stops this being
 * a way to write into a director's working list.
 *
 * Mounted *under a path*, like the family surface and for the same reason:
 * `router.use(middleware, router)` with no prefix runs that middleware for
 * every request in the application, not just this router's. This limiter is
 * sized for one person filling in one form, so leaking it upward throttles
 * every director in every home.
 */
router.use("/public", publicRateLimit, publicRouter);

/**
 * Scheduled work. Above the session gate because a scheduler has no cookie,
 * and guarded by its own shared secret instead — see `tasks.ts`.
 */
router.use(tasksRouter);

/*
 * Stripe's webhook is NOT mounted here, and must not be.
 *
 * It needs the raw request bytes to check Stripe's signature, and by the time
 * a request reaches this router `app.ts` has already run `express.json()` over
 * it -- which consumes the stream and leaves `req.body` as a parsed object.
 * The webhook's own `express.raw()` then finds the body already read and
 * passes that object straight through, so the signature gets computed over
 * the string "[object Object]" and no genuine Stripe event can ever verify.
 *
 * It fails silently and only where it costs money: subscriptions never
 * change state, a home that pays stays on `trial` until the trial cuts it
 * off, a home that cancels keeps working forever, and Stripe retries for
 * three days and disables the endpoint. The test suite passed throughout,
 * because every test asserted that a *bad* signature is rejected and none
 * asserted that a good one is accepted.
 *
 * So it is mounted in `app.ts`, ahead of the body parsers. See the comment
 * there.
 */

/**
 * The family surface, mounted under `/family` so the gate applies to those
 * paths and only those paths — mounting the middleware without a prefix would
 * put it in front of every staff route as well.
 *
 * Everything here is reached with the token from a texted link and is scoped
 * to the single case that token names. No path below carries a case id, so
 * there is nothing for a handler to check and nothing for a family member to
 * tamper with.
 */
/*
 * `familyStorefrontRouter` rides the same mount rather than taking one of
 * its own. It is a separate file because the storefront is one component's
 * work and a thousand-line `family.ts` that six people edit is a merge
 * conflict with a queue — but mounting it again under `/family` would run
 * the limiter and the token lookup twice for every request that fell
 * through to it, halving a family's budget and writing their "last seen"
 * twice for one page load.
 */
router.use(
  "/family",
  familyRateLimit,
  requireFamilyLink,
  familyRouter,
  familyStorefrontRouter,
);

/**
 * Everything below requires a staff session. Handlers then scope every query
 * with `tenant(req).id`, which is read off the signed-in user's own row.
 * Both halves are required: the gate proves somebody is signed in, the scope
 * proves they are looking at their own home's cases.
 */
router.use(requireAuth);

router.use(billingRouter);
router.use(homeRouter);
router.use(importRouter);
router.use(casesRouter);
router.use(exportRouter);
router.use(intakeRouter);
router.use(contactsRouter);
router.use(photosRouter);
router.use(obituaryRouter);
router.use(selectionsRouter);
router.use(catalogueRouter);
router.use(ordersRouter);
router.use(messagesRouter);
router.use(deadlinesRouter);
router.use(belongingsRouter);
router.use(vendorsRouter);
router.use(vitalsRouter);
router.use(printRouter);
router.use(aftercareRouter);
router.use(uploadsRouter);

export default router;
