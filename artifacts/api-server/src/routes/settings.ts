import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function formatSettings(s: typeof appSettingsTable.$inferSelect) {
  return {
    defaultConcurrency: s.defaultConcurrency,
    defaultTimeoutMs: s.defaultTimeoutMs,
    defaultRetryCount: s.defaultRetryCount,
    maxConcurrency: s.maxConcurrency,
    perHostConcurrency: s.perHostConcurrency,
    autoProbeDefault: s.autoProbeDefault,
    ffprobePath: s.ffprobePath,
  };
}

async function getOrCreateSettings() {
  const rows = await db.select().from(appSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [s] = await db.insert(appSettingsTable).values({}).returning();
  return s;
}

// GET /settings
router.get("/settings", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  res.json(formatSettings(s));
});

// PUT /settings
router.put("/settings", async (req, res): Promise<void> => {
  const body = req.body as {
    defaultConcurrency?: number | null;
    defaultTimeoutMs?: number | null;
    defaultRetryCount?: number | null;
    maxConcurrency?: number | null;
    perHostConcurrency?: number | null;
    autoProbeDefault?: boolean | null;
    ffprobePath?: string | null;
  };

  const s = await getOrCreateSettings();

  const updates: Partial<typeof appSettingsTable.$inferInsert> = {};
  if (body.defaultConcurrency != null) updates.defaultConcurrency = body.defaultConcurrency;
  if (body.defaultTimeoutMs != null) updates.defaultTimeoutMs = body.defaultTimeoutMs;
  if (body.defaultRetryCount != null) updates.defaultRetryCount = body.defaultRetryCount;
  if (body.maxConcurrency != null) updates.maxConcurrency = body.maxConcurrency;
  if (body.perHostConcurrency != null) updates.perHostConcurrency = body.perHostConcurrency;
  if (body.autoProbeDefault != null) updates.autoProbeDefault = body.autoProbeDefault;
  if (body.ffprobePath != null) updates.ffprobePath = body.ffprobePath;

  const [updated] = await db
    .update(appSettingsTable)
    .set(updates)
    .where(eq(appSettingsTable.id, s.id))
    .returning();

  res.json(formatSettings(updated ?? s));
});

export default router;
