import { Router, type IRouter } from "express";
import aftercareRouter from "./aftercare";
import arrangementsRouter from "./arrangements";
import memoryBookRouter from "./memory-book";
import messagesRouter from "./messages";
import photosRouter from "./photos";
import printRouter from "./print";
import sessionRouter from "./session";

/**
 * The family portal's entire API surface.
 *
 * Note what is missing from every path below: a case id. The link token
 * names exactly one case, `requireFamilyLink` has already resolved it, and
 * handlers read it from `familyCase(req)`. There is no id for a family
 * member to tamper with and no id for a handler to forget to check — which
 * is the property that makes this surface safe to hand to an unauthenticated
 * stranger holding a forwarded text message.
 */
const router: IRouter = Router();

// Order kept from the single file this was split from.
router.use(sessionRouter);
router.use(photosRouter);
router.use(arrangementsRouter);
router.use(printRouter);
router.use(messagesRouter);
router.use(aftercareRouter);
router.use(memoryBookRouter);

export default router;
