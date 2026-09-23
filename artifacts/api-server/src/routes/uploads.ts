import { Router, type IRouter } from "express";
import { badRequest, parseId } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { photoUpload, serveUpload, storeUpload } from "../lib/media";

const router: IRouter = Router();

/**
 * Staff uploads that belong to no case: the home's logo.
 *
 * A photograph for a case does not come through here. A file stored with no
 * case never reaches that case's bin, pack or slideshow, which is how a print
 * posted to the office used to vanish; those go to `POST
 * /cases/:caseId/photos` in `photos.ts`.
 */
router.post("/uploads", photoUpload.single("file"), async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);

  if (!req.file) throw badRequest("Please attach a file.");

  const stored = await storeUpload({
    funeralHomeId: home.id,
    caseId: null,
    uploadedByUserId: user.id,
    file: req.file,
  });

  res.status(201).json(stored);
});

router.get("/uploads/:uploadId", async (req, res) => {
  const home = tenant(req);
  await serveUpload(res, {
    uploadId: parseId(req.params.uploadId),
    funeralHomeId: home.id,
  });
});

export default router;
