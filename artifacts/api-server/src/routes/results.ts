import { Router } from "express";
import { db } from "@workspace/db";
import { resultsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// PATCH /results/:id
router.patch("/results/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { category } = req.body as { category?: string | null };

  const [result] = await db
    .update(resultsTable)
    .set({ category: category ?? null })
    .where(eq(resultsTable.id, id))
    .returning();

  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  res.json({
    id: result.id,
    jobId: result.jobId,
    channelId: result.channelId,
    tvgName: result.tvgName,
    tvgLogo: result.tvgLogo,
    url: result.url,
    category: result.category,
    status: result.status,
    httpStatus: result.httpStatus,
    responseTimeMs: result.responseTimeMs,
    redirectCount: result.redirectCount,
    tlsValid: result.tlsValid,
    mimeType: result.mimeType,
    manifestValid: result.manifestValid,
    failureReason: result.failureReason,
    probeData: result.probeData ?? null,
    checkedAt: result.checkedAt,
  });
});

export default router;
