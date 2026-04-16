import { Router } from "express";
import { z } from "zod";
import {
  getRequestHistoryFilePath,
  getRequestHistoryMaxEntries,
  readRecentRequestHistory,
} from "../lib/request-history.js";
import { requestHistoryAuthMiddleware } from "../middleware/request-history-auth.js";

const router = Router();
router.use(requestHistoryAuthMiddleware);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  requestId: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  method: z.string().trim().min(1).optional(),
  feature: z.string().trim().min(1).optional(),
  jobStatus: z.string().trim().min(1).optional(),
  status: z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    z.coerce.number().int().min(100).max(599).optional(),
  ),
});

router.get("/", async (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const items = await readRecentRequestHistory(parsed.data.limit, {
      requestId: parsed.data.requestId,
      path: parsed.data.path,
      method: parsed.data.method,
      status: parsed.data.status,
      feature: parsed.data.feature,
      jobStatus: parsed.data.jobStatus,
    });

    res.json({
      filePath: getRequestHistoryFilePath(),
      maxEntries: getRequestHistoryMaxEntries(),
      count: items.length,
      items,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
