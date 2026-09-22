import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { resultsTable } from "../schema.js";
import type { Env } from "../types.js";

const results = new Hono<{ Bindings: Env }>();

// PATCH /results/:id
results.patch("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const { category } = await c.req.json<{ category?: string | null }>();
  const db = getDb(c.env.DATABASE_URL);

  const [result] = await db
    .update(resultsTable)
    .set({ category: category ?? null })
    .where(eq(resultsTable.id, id))
    .returning();

  if (!result) return c.json({ error: "Result not found" }, 404);

  return c.json({
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

export default results;
