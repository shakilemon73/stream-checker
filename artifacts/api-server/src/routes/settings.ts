import { Router } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { testGitHubConnection } from "../lib/github-sync.js";

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
    githubToken: s.githubToken,
    githubOwner: s.githubOwner,
    githubRepo: s.githubRepo,
    githubBranch: s.githubBranch,
    githubPath: s.githubPath,
    githubAutoPush: s.githubAutoPush,
    githubLastPushAt: s.githubLastPushAt,
    githubLastPushStatus: s.githubLastPushStatus,
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
    githubToken?: string | null;
    githubOwner?: string | null;
    githubRepo?: string | null;
    githubBranch?: string | null;
    githubPath?: string | null;
    githubAutoPush?: boolean | null;
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
  if (body.githubToken !== undefined) updates.githubToken = body.githubToken ? body.githubToken.trim() : null;
  if (body.githubOwner !== undefined) updates.githubOwner = body.githubOwner ? body.githubOwner.trim() : null;
  if (body.githubRepo !== undefined) updates.githubRepo = body.githubRepo ? body.githubRepo.trim() : null;
  if (body.githubBranch !== undefined) updates.githubBranch = body.githubBranch ? body.githubBranch.trim() : null;
  if (body.githubPath !== undefined) updates.githubPath = body.githubPath ? body.githubPath.trim() : null;
  if (body.githubAutoPush !== undefined) updates.githubAutoPush = !!body.githubAutoPush;

  const [updated] = await db
    .update(appSettingsTable)
    .set(updates)
    .where(eq(appSettingsTable.id, s.id))
    .returning();

  res.json(formatSettings(updated ?? s));
});

// POST /settings/github/test - Test GitHub token and connection
router.post("/settings/github/test", async (req, res): Promise<void> => {
  const { token } = req.body as { token?: string };
  const s = await getOrCreateSettings();
  const tokenToTest = token || s.githubToken;

  if (!tokenToTest) {
    res.status(400).json({ valid: false, error: "No GitHub token provided" });
    return;
  }

  const result = await testGitHubConnection(tokenToTest);
  if (!result.valid) {
    res.status(400).json(result);
    return;
  }

  res.json(result);
});

export default router;
