import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { appSettingsTable } from "../schema.js";
import type { Env } from "../types.js";

const settings = new Hono<{ Bindings: Env }>();

function fmtSettings(s: typeof appSettingsTable.$inferSelect) {
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

async function getOrCreate(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(appSettingsTable).limit(1);
  if (rows.length > 0) return rows[0]!;
  const [s] = await db.insert(appSettingsTable).values({}).returning();
  return s!;
}

// GET /settings
settings.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const s = await getOrCreate(db);
  return c.json(fmtSettings(s));
});

// PUT /settings
settings.put("/", async (c) => {
  const body = await c.req.json<{
    defaultConcurrency?: number | null;
    defaultTimeoutMs?: number | null;
    defaultRetryCount?: number | null;
    maxConcurrency?: number | null;
    perHostConcurrency?: number | null;
    autoProbeDefault?: boolean | null;
    ffprobePath?: string | null;
  }>();

  const db = getDb(c.env.DATABASE_URL);
  const s = await getOrCreate(db);

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

  return c.json(fmtSettings(updated ?? s));
});

export default settings;
