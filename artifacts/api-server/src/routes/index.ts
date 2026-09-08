import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/require-auth";
import healthRouter from "./health";
import authRouter from "./auth";
import googleRouter from "./google";
import profileRouter from "./profile";
import memoriesRouter from "./memories";
import journalRouter from "./journal";
import lettersRouter from "./letters";
import creativeRouter from "./creative";
import documentsRouter from "./documents";
import quotesRouter from "./quotes";
import tributeRouter from "./tribute";
import todosRouter from "./todos";
import affirmationsRouter from "./affirmations";
import milestonesRouter from "./milestones";
import storiesRouter from "./stories";
import signsRouter from "./signs";
import uploadsRouter from "./uploads";
import belongingsRouter from "./belongings";
import giftsRouter from "./gifts";
import contactsRouter from "./contacts";
import obituariesRouter from "./obituaries";
import memorialRouter from "./memorial";
import sharesRouter, { publicSharesRouter } from "./shares";
import communityRouter from "./community";
import keepsakesRouter from "./keepsakes";
import albumsRouter from "./albums";
import guidesRouter from "./guides";

const router: IRouter = Router();

// Public surface: liveness, and the endpoints used to obtain a session.
router.use(healthRouter);
router.use(authRouter);
router.use(googleRouter);

/**
 * Read-only share links, which are public by design — the point of one is
 * that it opens for someone with no account. It is mounted here, above the
 * gate, and kept in its own router so that the public half and the owning
 * half of shares.ts cannot be merged by accident. What it will return is
 * narrow: one named row, by token digest, scoped to the sharer.
 */
router.use(publicSharesRouter);

/**
 * Searching the guides is public for the same reason the guides are: the
 * parent who needs the chapter on viewing a body is in a hospital corridor and
 * is not about to register for anything. It reads a fixed catalogue of public
 * chapter titles and returns ids — there is no account data anywhere near it.
 */
router.use(guidesRouter);

/**
 * Everything below this line requires a session. The gate is mounted once,
 * here, rather than per route file — adding a router cannot accidentally
 * expose someone's memories because a handler forgot its middleware.
 *
 * Handlers then read the owner via `currentUser(req)` and scope every query
 * to `user.id`. Both halves are required: this gate proves *someone* is
 * signed in, the query scope proves they are looking at their own data.
 */
router.use(requireAuth);

router.use(profileRouter);
router.use(memoriesRouter);
router.use(journalRouter);
router.use(lettersRouter);
router.use(creativeRouter);
router.use(documentsRouter);
router.use(quotesRouter);
router.use(tributeRouter);
router.use(todosRouter);
router.use(affirmationsRouter);
router.use(milestonesRouter);
router.use(storiesRouter);
router.use(signsRouter);
router.use(uploadsRouter);
router.use(belongingsRouter);
router.use(giftsRouter);
router.use(contactsRouter);
router.use(obituariesRouter);
router.use(memorialRouter);
router.use(sharesRouter);

/**
 * The shared room. Mounted here, below the gate, on purpose: the guides are
 * public because a parent in a hospital corridor will not register for
 * anything, but a room where people write about their child's death is not the
 * same thing. Making it public later is one line; making it private again
 * after a search engine has indexed it is not.
 */
router.use(communityRouter);
router.use(keepsakesRouter);
router.use(albumsRouter);

export default router;
