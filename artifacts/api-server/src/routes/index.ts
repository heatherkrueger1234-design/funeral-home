import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/require-auth";
import { requireFamilyLink } from "../middleware/require-family";
import { familyRateLimit } from "../middleware/rate-limit";
import healthRouter from "./health";
import authRouter from "./auth";
import familyRouter from "./family";
import homeRouter from "./home";
import casesRouter from "./cases";
import contactsRouter from "./contacts";
import photosRouter from "./photos";
import obituaryRouter from "./obituary";
import selectionsRouter from "./selections";
import messagesRouter from "./messages";
import deadlinesRouter from "./deadlines";
import belongingsRouter from "./belongings";
import aftercareRouter from "./aftercare";
import uploadsRouter from "./uploads";

const router: IRouter = Router();

/**
 * Three tiers, and the order they are mounted in is the security model.
 *
 * 1. Public: liveness, and the endpoints used to obtain a staff session.
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
 * The family surface, mounted under `/family` so the gate applies to those
 * paths and only those paths — mounting the middleware without a prefix would
 * put it in front of every staff route as well.
 *
 * Everything here is reached with the token from a texted link and is scoped
 * to the single case that token names. No path below carries a case id, so
 * there is nothing for a handler to check and nothing for a family member to
 * tamper with.
 */
router.use("/family", familyRateLimit, requireFamilyLink, familyRouter);

/**
 * Everything below requires a staff session. Handlers then scope every query
 * with `tenant(req).id`, which is read off the signed-in user's own row.
 * Both halves are required: the gate proves somebody is signed in, the scope
 * proves they are looking at their own home's cases.
 */
router.use(requireAuth);

router.use(homeRouter);
router.use(casesRouter);
router.use(contactsRouter);
router.use(photosRouter);
router.use(obituaryRouter);
router.use(selectionsRouter);
router.use(messagesRouter);
router.use(deadlinesRouter);
router.use(belongingsRouter);
router.use(aftercareRouter);
router.use(uploadsRouter);

export default router;
