import { Hono } from "hono";
import { eq, and, ilike, count, asc, desc } from "drizzle-orm";
import { getDb } from "../db.js";
import {
  jobsTable,
  channelsTable,
  resultsTable,
  playlistsTable,
  appSettingsTable,
} from "../schema.js";
import { processBatch } from "../lib/job-processor.js";
import type { Env } from "../types.js";

const jobs = new Hono<{ Bindings: Env }>();

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtJob(j: typeof jobsTable.$inferSelect) {
  return {
    id: j.id,
    playlistId: j.playlistId,
    playlistName: j.playlistName,
    status: j.status,
    settings: j.settings,
    total: j.total,
    checked: j.checked,
    live: j.live,
    dead: j.dead,
    geoblocked: j.geoblocked,
    suspicious: j.suspicious,
    pending: j.pending,
    etaSeconds: j.etaSeconds,
    avgCheckMs: j.avgCheckMs ? parseFloat(String(j.avgCheckMs)) : null,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    completedAt: j.completedAt,
  };
}

function fmtResult(r: typeof resultsTable.$inferSelect) {
  return {
    id: r.id,
    jobId: r.jobId,
    channelId: r.channelId,
    tvgName: r.tvgName,
    tvgLogo: r.tvgLogo,
    url: r.url,
    category: r.category,
    status: r.status,
    httpStatus: r.httpStatus,
    responseTimeMs: r.responseTimeMs,
    redirectCount: r.redirectCount,
    tlsValid: r.tlsValid,
    mimeType: r.mimeType,
    manifestValid: r.manifestValid,
    failureReason: r.failureReason,
    probeData: r.probeData ?? null,
    checkedAt: r.checkedAt,
  };
}

// ── GET /jobs ──────────────────────────────────────────────────────────────────

jobs.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt));
  return c.json(rows.map(fmtJob));
});

// ── POST /jobs — create job + result rows ──────────────────────────────────────
// The client must then call POST /jobs/:id/process in a loop to run checks.

jobs.post("/", async (c) => {
  const body = await c.req.json<{
    playlistId?: number;
    settings?: Partial<{
      concurrency: number;
      timeoutMs: number;
      retryCount: number;
      autoProbe: boolean;
      perHostConcurrency: number;
    }>;
  }>();

  if (!body.playlistId) return c.json({ error: "playlistId is required" }, 400);

  const db = getDb(c.env.DATABASE_URL);

  const [playlist] = await db
    .select()
    .from(playlistsTable)
    .where(eq(playlistsTable.id, body.playlistId));
  if (!playlist) return c.json({ error: "Playlist not found" }, 404);

  let defaults = await db.select().from(appSettingsTable).limit(1);
  if (defaults.length === 0) {
    await db.insert(appSettingsTable).values({});
    defaults = await db.select().from(appSettingsTable).limit(1);
  }
  const d = defaults[0]!;

  // Cap concurrency conservatively for CF free plan (subrequest limit: 50)
  const maxBatchConcurrency = 10;
  const jobSettings = {
    concurrency:       Math.min(d.maxConcurrency, maxBatchConcurrency, body.settings?.concurrency ?? d.defaultConcurrency),
    timeoutMs:         body.settings?.timeoutMs         ?? d.defaultTimeoutMs,
    retryCount:        Math.min(body.settings?.retryCount ?? d.defaultRetryCount, 2), // cap to keep subrequests low
    autoProbe:         body.settings?.autoProbe          ?? d.autoProbeDefault,
    perHostConcurrency: Math.min(body.settings?.perHostConcurrency ?? d.perHostConcurrency, 3),
  };

  const channels = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.playlistId, body.playlistId))
    .orderBy(channelsTable.position);

  if (channels.length === 0) return c.json({ error: "Playlist has no channels" }, 400);

  const [job] = await db
    .insert(jobsTable)
    .values({
      playlistId: body.playlistId,
      playlistName: playlist.name,
      status: "queued",
      settings: jobSettings,
      total: channels.length,
      checked: 0, live: 0, dead: 0, geoblocked: 0, suspicious: 0,
      pending: channels.length,
    })
    .returning();

  const batchSize = 500;
  for (let i = 0; i < channels.length; i += batchSize) {
    const batch = channels.slice(i, i + batchSize).map((ch) => ({
      jobId: job!.id,
      channelId: ch.id,
      tvgName: ch.tvgName,
      tvgLogo: ch.tvgLogo,
      url: ch.url,
      category: ch.groupTitle,
      status: "pending",
    }));
    await db.insert(resultsTable).values(batch);
  }

  return c.json(fmtJob(job!), 201);
});

// ── POST /jobs/:id/process — run one batch of stream checks ───────────────────
//
// This is the key free-tier endpoint. The client calls this in a loop:
//
//   while (!progress.done) {
//     progress = await fetch(`/jobs/${id}/process`, { method: 'POST' });
//   }
//
// Query params:
//   batch  (number, default 10, max 15)  — channels per call
//
// CF free limits per invocation:
//   • 50 subrequests  → batch 10 × 3 retries + 10 writes + 2 overhead = 42 max ✅
//   • 30 s wall clock → 10 concurrent × 8 s timeout ≈ 8–12 s ✅
//   • 10 ms CPU       → pure I/O workload ✅

jobs.post("/:id/process", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const batchSize = Math.min(
    15,
    Math.max(1, parseInt(c.req.query("batch") ?? "10", 10))
  );

  const db = getDb(c.env.DATABASE_URL);
  const progress = await processBatch(db, id, batchSize);
  return c.json(progress);
});

// ── GET /jobs/:id ──────────────────────────────────────────────────────────────

jobs.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = getDb(c.env.DATABASE_URL);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(fmtJob(job));
});

// ── DELETE /jobs/:id ───────────────────────────────────────────────────────────

jobs.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = getDb(c.env.DATABASE_URL);
  await db.delete(jobsTable).where(eq(jobsTable.id, id));
  return new Response(null, { status: 204 });
});

// ── POST /jobs/:id/pause ───────────────────────────────────────────────────────
// Sets status in DB; the client stops calling /process when it sees "paused".

jobs.post("/:id/pause", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = getDb(c.env.DATABASE_URL);
  const [job] = await db
    .update(jobsTable).set({ status: "paused" })
    .where(eq(jobsTable.id, id)).returning();
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(fmtJob(job));
});

// ── POST /jobs/:id/resume ──────────────────────────────────────────────────────
// Sets status back to running; client resumes its /process loop.

jobs.post("/:id/resume", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = getDb(c.env.DATABASE_URL);
  const [job] = await db
    .update(jobsTable).set({ status: "running" })
    .where(eq(jobsTable.id, id)).returning();
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(fmtJob(job));
});

// ── POST /jobs/:id/cancel ──────────────────────────────────────────────────────

jobs.post("/:id/cancel", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = getDb(c.env.DATABASE_URL);
  const [job] = await db
    .update(jobsTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(jobsTable.id, id)).returning();
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(fmtJob(job));
});

// ── GET /jobs/:id/results ──────────────────────────────────────────────────────

jobs.get("/:id/results", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const page  = Math.max(1, parseInt(c.req.query("page")  ?? "1",   10));
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query("limit") ?? "100", 10)));
  const offset = (page - 1) * limit;
  const status   = c.req.query("status");
  const category = c.req.query("category");
  const search   = c.req.query("search");
  const sortBy   = c.req.query("sortBy")  ?? "name";
  const sortDir  = c.req.query("sortDir") ?? "asc";

  const conditions = [eq(resultsTable.jobId, id)];
  if (status)   conditions.push(eq(resultsTable.status,   status));
  if (category) conditions.push(eq(resultsTable.category, category));
  if (search)   conditions.push(ilike(resultsTable.tvgName, `%${search}%`));

  const db = getDb(c.env.DATABASE_URL);

  const [totalRow] = await db
    .select({ count: count() }).from(resultsTable).where(and(...conditions));

  type SC = typeof resultsTable.tvgName | typeof resultsTable.responseTimeMs | typeof resultsTable.checkedAt | typeof resultsTable.status;
  const sortColMap: Record<string, SC> = {
    name: resultsTable.tvgName, status: resultsTable.status,
    responseTime: resultsTable.responseTimeMs, checkedAt: resultsTable.checkedAt,
  };
  const sortCol = sortColMap[sortBy] ?? resultsTable.tvgName;
  const orderFn = sortDir === "desc" ? desc : asc;

  const rows = await db
    .select().from(resultsTable).where(and(...conditions))
    .orderBy(orderFn(sortCol)).limit(limit).offset(offset);

  return c.json({ results: rows.map(fmtResult), total: Number(totalRow?.count ?? 0), page, limit });
});

// ── GET /jobs/:id/summary ──────────────────────────────────────────────────────

jobs.get("/:id/summary", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = getDb(c.env.DATABASE_URL);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) return c.json({ error: "Job not found" }, 404);

  const checked = job.checked || 1;
  const categoryRows = await db
    .select({ category: resultsTable.category, status: resultsTable.status, cnt: count() })
    .from(resultsTable).where(eq(resultsTable.jobId, id))
    .groupBy(resultsTable.category, resultsTable.status);

  type CE = { live: number; dead: number; geoblocked: number; suspicious: number; pending: number; total: number };
  const catMap = new Map<string, CE>();
  for (const row of categoryRows) {
    const cat = row.category ?? "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { live: 0, dead: 0, geoblocked: 0, suspicious: 0, pending: 0, total: 0 });
    const e = catMap.get(cat)!;
    (e as Record<string, number>)[row.status] = Number(row.cnt);
    e.total += Number(row.cnt);
  }

  return c.json({
    jobId: id, status: job.status,
    total: job.total, checked: job.checked,
    live: job.live, dead: job.dead, geoblocked: job.geoblocked, suspicious: job.suspicious, pending: job.pending,
    livePercent: Math.round((job.live / checked) * 100),
    deadPercent: Math.round((job.dead / checked) * 100),
    progressPercent: job.total > 0 ? Math.round((job.checked / job.total) * 100) : 0,
    avgCheckMs: job.avgCheckMs ? parseFloat(String(job.avgCheckMs)) : null,
    etaSeconds: job.etaSeconds,
    topCategories: Array.from(catMap.entries())
      .map(([category, counts]) => ({ category, ...counts }))
      .sort((a, b) => b.total - a.total).slice(0, 10),
  });
});

// ── GET /jobs/:id/categories ───────────────────────────────────────────────────

jobs.get("/:id/categories", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = getDb(c.env.DATABASE_URL);
  const rows = await db
    .select({ category: resultsTable.category, status: resultsTable.status, cnt: count() })
    .from(resultsTable).where(eq(resultsTable.jobId, id))
    .groupBy(resultsTable.category, resultsTable.status);

  type CE = { live: number; dead: number; geoblocked: number; suspicious: number; pending: number; total: number };
  const catMap = new Map<string, CE>();
  for (const row of rows) {
    const cat = row.category ?? "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { live: 0, dead: 0, geoblocked: 0, suspicious: 0, pending: 0, total: 0 });
    const e = catMap.get(cat)!;
    (e as Record<string, number>)[row.status] = Number(row.cnt);
    e.total += Number(row.cnt);
  }

  return c.json(
    Array.from(catMap.entries())
      .map(([category, counts]) => ({ category, ...counts }))
      .sort((a, b) => b.total - a.total)
  );
});

// ── POST /jobs/:id/probe — not available at edge ───────────────────────────────

jobs.post("/:id/probe", (c) =>
  c.json({ error: "ffprobe is not available in the Cloudflare Workers runtime." }, 501)
);

// ── GET /jobs/:id/export ───────────────────────────────────────────────────────

jobs.get("/:id/export", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const format         = c.req.query("format")   ?? "m3u";
  const statusFilter   = c.req.query("status");
  const categoryFilter = c.req.query("category");

  const conditions = [eq(resultsTable.jobId, id)];
  if (statusFilter) {
    const statuses = statusFilter.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) conditions.push(eq(resultsTable.status, statuses[0]!));
  }
  if (categoryFilter) conditions.push(eq(resultsTable.category, categoryFilter));

  const db = getDb(c.env.DATABASE_URL);
  const rows = await db
    .select().from(resultsTable).where(and(...conditions))
    .orderBy(resultsTable.category, resultsTable.tvgName);

  if (format === "m3u") {
    let out = "#EXTM3U\n";
    for (const r of rows) {
      const attrs = [
        r.tvgName  ? `tvg-name="${r.tvgName}"`     : "",
        r.tvgLogo  ? `tvg-logo="${r.tvgLogo}"`     : "",
        r.category ? `group-title="${r.category}"` : "",
      ].filter(Boolean).join(" ");
      out += `#EXTINF:-1 ${attrs},${r.tvgName ?? r.url}\n${r.url}\n`;
    }
    return new Response(out, { headers: { "Content-Type": "audio/x-mpegurl", "Content-Disposition": 'attachment; filename="streamguard-export.m3u"' } });
  }

  if (format === "csv") {
    const header = "name,url,status,category,httpStatus,responseTimeMs,mimeType,failureReason,checkedAt\n";
    const body = rows.map((r) => [
      `"${(r.tvgName ?? "").replace(/"/g, '""')}"`,
      `"${r.url.replace(/"/g, '""')}"`,
      r.status,
      `"${(r.category ?? "").replace(/"/g, '""')}"`,
      r.httpStatus ?? "", r.responseTimeMs ?? "", r.mimeType ?? "",
      `"${(r.failureReason ?? "").replace(/"/g, '""')}"`,
      r.checkedAt?.toISOString() ?? "",
    ].join(",")).join("\n");
    return new Response(header + body, { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="streamguard-report.csv"' } });
  }

  return new Response(JSON.stringify(rows.map(fmtResult)), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="streamguard-report.json"' },
  });
});

// ── GET /jobs/:id/diff/:compareId ─────────────────────────────────────────────

jobs.get("/:id/diff/:compareId", async (c) => {
  const id        = parseInt(c.req.param("id"),        10);
  const compareId = parseInt(c.req.param("compareId"), 10);
  if (isNaN(id) || isNaN(compareId)) return c.json({ error: "Invalid id" }, 400);

  const db = getDb(c.env.DATABASE_URL);
  const [ra, rb] = await Promise.all([
    db.select().from(resultsTable).where(eq(resultsTable.jobId, id)),
    db.select().from(resultsTable).where(eq(resultsTable.jobId, compareId)),
  ]);

  const mapA = new Map(ra.map((r) => [r.channelId, r]));
  const mapB = new Map(rb.map((r) => [r.channelId, r]));
  const newlyDead: typeof ra = [], newlyLive: typeof ra = [];
  let unchanged = 0;

  for (const [cid, rA] of mapA) {
    const rB = mapB.get(cid);
    if (!rB) continue;
    if (rA.status === "live" && rB.status !== "live") newlyDead.push(rB);
    else if (rA.status !== "live" && rB.status === "live") newlyLive.push(rB);
    else unchanged++;
  }

  return c.json({
    jobId: id, compareJobId: compareId,
    newlyDead: newlyDead.map(fmtResult),
    newlyLive: newlyLive.map(fmtResult),
    unchanged,
    summary: `${newlyDead.length} went dead, ${newlyLive.length} came back live, ${unchanged} unchanged`,
  });
});

export default jobs;
