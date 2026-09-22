import { Router } from "express";
import { db } from "@workspace/db";
import { resultsTable, channelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// PATCH /results/:id
router.patch("/results/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { tvgName, tvgLogo, url, category, status } = req.body as {
    tvgName?: string | null;
    tvgLogo?: string | null;
    url?: string | null;
    category?: string | null;
    status?: string | null;
  };

  const updatePayload: Record<string, any> = {};
  if (tvgName !== undefined) updatePayload.tvgName = tvgName;
  if (tvgLogo !== undefined) updatePayload.tvgLogo = tvgLogo;
  if (url !== undefined) updatePayload.url = url;
  if (category !== undefined) updatePayload.category = category;
  if (status !== undefined) updatePayload.status = status;

  if (Object.keys(updatePayload).length === 0) {
    res.status(400).json({ error: "No fields provided to update" });
    return;
  }

  const [result] = await db
    .update(resultsTable)
    .set(updatePayload)
    .where(eq(resultsTable.id, id))
    .returning();

  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  // If there's an associated channel, update channelsTable too
  if (result.channelId) {
    const channelUpdate: Record<string, any> = {};
    if (tvgName !== undefined) channelUpdate.tvgName = tvgName;
    if (tvgLogo !== undefined) channelUpdate.tvgLogo = tvgLogo;
    if (url !== undefined) channelUpdate.url = url;
    if (category !== undefined) channelUpdate.groupTitle = category;

    if (Object.keys(channelUpdate).length > 0) {
      await db
        .update(channelsTable)
        .set(channelUpdate)
        .where(eq(channelsTable.id, result.channelId));
    }
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
    tlsValid: result.tls_valid,
    mimeType: result.mimeType,
    manifestValid: result.manifestValid,
    failureReason: result.failureReason,
    probeData: result.probeData ?? null,
    checkedAt: result.checkedAt,
  });
});

export default router;
