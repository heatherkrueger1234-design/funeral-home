import { Router, type IRouter } from "express";
import { tenant } from "../middleware/require-auth";
import { aftercareForCase } from "../lib/aftercare";
import { loadCase } from "./cases";

const router: IRouter = Router();

router.get("/cases/:caseId/aftercare", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await aftercareForCase(row.id, home.id));
});

export default router;
