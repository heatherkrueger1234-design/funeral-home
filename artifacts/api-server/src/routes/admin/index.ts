import { Router, type IRouter } from "express";
import accessRouter from "./access";
import commercialRouter from "./commercial";
import groupsRouter from "./groups";
import homesRouter from "./homes";
import licensureRouter from "./licensure";
import overviewRouter from "./overview";
import { actor, requirePlatformAdmin } from "./shared";

/** The platform console's API, split by screen. Every route is behind the gate. */
const router: IRouter = Router();

router.use("/admin", requirePlatformAdmin);

/**
 * Whether the signed-in account may use this console at all.
 *
 * The console asks this once, before it draws anything, so that a director who
 * follows a link here is told once that there is nothing for them -- rather
 * than being shown the platform's navigation, an "Add a home" button and a
 * row of "Not found" errors, which is what happened while the only way to find
 * out was to try a real screen and fail.
 *
 * Not audited, and it is the second route besides the log that is not. It
 * reads no home and names no customer; it only repeats back what the gate
 * above already decided.
 */
router.get("/admin/me", (req, res) => {
  res.json({ email: actor(req).email });
});

router.use(homesRouter);
router.use(licensureRouter);
router.use(overviewRouter);
router.use(accessRouter);
router.use(commercialRouter);
router.use(groupsRouter);

export default router;
