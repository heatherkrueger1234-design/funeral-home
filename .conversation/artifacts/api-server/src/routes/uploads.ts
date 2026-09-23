import { Router, type IRouter } from "express";
import { badRequest, parseId } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { photoUpload, serveUpload, storeUpload } from "../lib/media";

const router: IRouter = Router();

/**
 * Staff uploads: the home's logo, and photographs a director adds on the
 * family's behalf when somebody posts prints to the office.
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
