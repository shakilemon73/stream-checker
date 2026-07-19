import { Router } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  channelsTable,
  resultsTable,
  playlistsTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, and, ilike, count, asc, desc, sql } from "drizzle-orm";
import { startJob, getActiveJob } from "../lib/job-queue.js";
import { logger } from "../lib/logger.js";

const router = Router();

function formatJob(j: typeof jobsTable.$inferSelect) {
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

function formatResult(r: typeof resultsTable.$inferSelect) {
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

// GET /jobs
router.get("/jobs", async (_req, res): Promise<void> => {
  const jobs = await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt));
  res.json(jobs.map(formatJob));
});

// POST /jobs
router.post("/jobs", async (req, res): Promise<void> => {
  const { playlistId, settings: userSettings } = req.body as {
    playlistId?: number;
    settings?: Partial<{
      concurrency: number;
      timeoutMs: number;
      retryCount: number;
      autoProbe: boolean;
      perHostConcurrency: number;
    }>;
  };

  if (!playlistId) {
    res.status(400).json({ error: "playlistId is required" });
    return;
  }

  const [playlist] = await db
    .select()
    .from(playlistsTable)
    .where(eq(playlistsTable.id, playlistId));
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  // Load default settings
  let defaults = await db.select().from(appSettingsTable).limit(1);
  if (defaults.length === 0) {
    await db.insert(appSettingsTable).values({});
    defaults = await db.select().from(appSettingsTable).limit(1);
  }
  const d = defaults[0];

  const jobSettings = {
    concurrency: Math.min(d.maxConcurrency, userSettings?.concurrency ?? d.defaultConcurrency),
    timeoutMs: userSettings?.timeoutMs ?? d.defaultTimeoutMs,
    retryCount: userSettings?.retryCount ?? d.defaultRetryCount,
    autoProbe: userSettings?.autoProbe ?? d.autoProbeDefault,
    perHostConcurrency: userSettings?.perHostConcurrency ?? d.perHostConcurrency,
  };

  const channels = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.playlistId, playlistId))
    .orderBy(channelsTable.position);

  if (channels.length === 0) {
    res.status(400).json({ error: "Playlist has no channels" });
    return;
  }

  const [job] = await db
    .insert(jobsTable)
    .values({
      playlistId,
      playlistName: playlist.name,
      status: "queued",
      settings: jobSettings,
      total: channels.length,
      checked: 0,
      live: 0,
      dead: 0,
      geoblocked: 0,
      suspicious: 0,
      pending: channels.length,
    })
    .returning();

  // Create pending result rows
  const batchSize = 500;
  for (let i = 0; i < channels.length; i += batchSize) {
    const batch = channels.slice(i, i + batchSize).map((ch) => ({
      jobId: job.id,
      channelId: ch.id,
      tvgName: ch.tvgName,
      tvgLogo: ch.tvgLogo,
      url: ch.url,
      category: ch.groupTitle,
      status: "pending",
    }));
    await db.insert(resultsTable).values(batch);
  }

  // Start job asynchronously
  startJob(job.id).catch((err) => logger.error({ err, jobId: job.id }, "Job failed"));

  res.status(201).json(formatJob(job));
});

// GET /jobs/:id
router.get("/jobs/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(formatJob(job));
});

// DELETE /jobs/:id
router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const control = getActiveJob(id);
  if (control) control.cancel();
  await db.delete(jobsTable).where(eq(jobsTable.id, id));
  res.status(204).send();
});

// POST /jobs/:id/pause
router.post("/jobs/:id/pause", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const control = getActiveJob(id);
  if (control) control.pause();

  const [job] = await db
    .update(jobsTable)
    .set({ status: "paused" })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(formatJob(job));
});

// POST /jobs/:id/resume
router.post("/jobs/:id/resume", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const control = getActiveJob(id);
  if (control) control.resume();

  const [job] = await db
    .update(jobsTable)
    .set({ status: "running" })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(formatJob(job));
});

// POST /jobs/:id/cancel
router.post("/jobs/:id/cancel", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const control = getActiveJob(id);
  if (control) control.cancel();

  const [job] = await db
    .update(jobsTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(formatJob(job));
});

// GET /jobs/:id/results
router.get("/jobs/:id/results", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10)));
  const offset = (page - 1) * limit;
  const status = req.query.status as string | undefined;
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;
  const sortBy = (req.query.sortBy as string) ?? "name";
  const sortDir = (req.query.sortDir as string) ?? "asc";

  const conditions = [eq(resultsTable.jobId, id)];
  if (status) conditions.push(eq(resultsTable.status, status));
  if (category) conditions.push(eq(resultsTable.category, category));
  if (search) conditions.push(ilike(resultsTable.tvgName, `%${search}%`));

  const [totalRow] = await db
    .select({ count: count() })
    .from(resultsTable)
    .where(and(...conditions));

  const sortColMap: Record<string, typeof resultsTable.tvgName | typeof resultsTable.responseTimeMs | typeof resultsTable.checkedAt | typeof resultsTable.status> = {
    name: resultsTable.tvgName,
    status: resultsTable.status,
    responseTime: resultsTable.responseTimeMs,
    checkedAt: resultsTable.checkedAt,
  };
  const sortCol = sortColMap[sortBy] ?? resultsTable.tvgName;
  const orderFn = sortDir === "desc" ? desc : asc;

  const results = await db
    .select()
    .from(resultsTable)
    .where(and(...conditions))
    .orderBy(orderFn(sortCol))
    .limit(limit)
    .offset(offset);

  res.json({
    results: results.map(formatResult),
    total: Number(totalRow?.count ?? 0),
    page,
    limit,
  });
});

// GET /jobs/:id/summary
router.get("/jobs/:id/summary", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const checked = job.checked || 1;
  const livePercent = Math.round((job.live / checked) * 100);
  const deadPercent = Math.round((job.dead / checked) * 100);
  const progressPercent = job.total > 0 ? Math.round((job.checked / job.total) * 100) : 0;

  // Top categories with breakdown
  const categoryRows = await db
    .select({
      category: resultsTable.category,
      status: resultsTable.status,
      cnt: count(),
    })
    .from(resultsTable)
    .where(eq(resultsTable.jobId, id))
    .groupBy(resultsTable.category, resultsTable.status);

  const catMap = new Map<string, { live: number; dead: number; geoblocked: number; suspicious: number; pending: number; total: number }>();
  for (const row of categoryRows) {
    const cat = row.category ?? "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { live: 0, dead: 0, geoblocked: 0, suspicious: 0, pending: 0, total: 0 });
    const c = catMap.get(cat)!;
    const n = Number(row.cnt);
    (c as Record<string, number>)[row.status] = n;
    c.total += n;
  }
  const topCategories = Array.from(catMap.entries())
    .map(([category, counts]) => ({ category, ...counts }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  res.json({
    jobId: id,
    status: job.status,
    total: job.total,
    checked: job.checked,
    live: job.live,
    dead: job.dead,
    geoblocked: job.geoblocked,
    suspicious: job.suspicious,
    pending: job.pending,
    livePercent,
    deadPercent,
    progressPercent,
    avgCheckMs: job.avgCheckMs ? parseFloat(String(job.avgCheckMs)) : null,
    etaSeconds: job.etaSeconds,
    topCategories,
  });
});

// GET /jobs/:id/categories
router.get("/jobs/:id/categories", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db
    .select({
      category: resultsTable.category,
      status: resultsTable.status,
      cnt: count(),
    })
    .from(resultsTable)
    .where(eq(resultsTable.jobId, id))
    .groupBy(resultsTable.category, resultsTable.status);

  const catMap = new Map<string, { live: number; dead: number; geoblocked: number; suspicious: number; pending: number; total: number }>();
  for (const row of rows) {
    const cat = row.category ?? "Uncategorized";
    if (!catMap.has(cat)) catMap.set(cat, { live: 0, dead: 0, geoblocked: 0, suspicious: 0, pending: 0, total: 0 });
    const c = catMap.get(cat)!;
    const n = Number(row.cnt);
    (c as Record<string, number>)[row.status] = n;
    c.total += n;
  }

  const categories = Array.from(catMap.entries())
    .map(([category, counts]) => ({ category, ...counts }))
    .sort((a, b) => b.total - a.total);

  res.json(categories);
});

// POST /jobs/:id/probe
router.post("/jobs/:id/probe", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { resultIds } = req.body as { resultIds?: number[] };
  if (!resultIds || !Array.isArray(resultIds) || resultIds.length === 0) {
    res.status(400).json({ error: "resultIds array is required" });
    return;
  }

  // Run ffprobe in background
  runProbe(id, resultIds).catch((err) =>
    logger.error({ err, jobId: id }, "Probe failed")
  );

  res.status(202).json({ message: `Probing ${resultIds.length} channels` });
});

async function runProbe(jobId: number, resultIds: number[]): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const [settingsRow] = await db.select().from(appSettingsTable).limit(1);
  const ffprobePath = settingsRow?.ffprobePath ?? "ffprobe";

  for (const resultId of resultIds) {
    const [result] = await db
      .select()
      .from(resultsTable)
      .where(eq(resultsTable.id, resultId));
    if (!result) continue;

    try {
      const { stdout } = await execFileAsync(
        ffprobePath,
        [
          "-v", "quiet",
          "-print_format", "json",
          "-show_streams",
          "-show_format",
          "-timeout", "10000000",
          result.url,
        ],
        { timeout: 12000 }
      );

      const data = JSON.parse(stdout);
      const videoStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
      const audioStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");

      const width = videoStream?.width ?? null;
      const height = videoStream?.height ?? null;

      // Check for mislabeling
      const name = (result.tvgName ?? "").toLowerCase();
      let mislabeled = false;
      let mislabelReason: string | null = null;
      if (height !== null) {
        if (name.includes("4k") && height < 2000) {
          mislabeled = true;
          mislabelReason = `Name claims 4K but resolution is ${width}x${height}`;
        } else if (name.includes("1080") && height < 900) {
          mislabeled = true;
          mislabelReason = `Name claims 1080p but resolution is ${width}x${height}`;
        } else if (name.includes("720") && height < 600) {
          mislabeled = true;
          mislabelReason = `Name claims 720p but resolution is ${width}x${height}`;
        }
      }

      const framerate = videoStream?.r_frame_rate
        ? eval(videoStream.r_frame_rate)
        : null;

      await db
        .update(resultsTable)
        .set({
          probeData: {
            videoCodec: videoStream?.codec_name ?? null,
            audioCodec: audioStream?.codec_name ?? null,
            width,
            height,
            framerate: framerate ? parseFloat(framerate.toFixed(2)) : null,
            bitrate: data.format?.bit_rate ? parseInt(data.format.bit_rate) : null,
            container: data.format?.format_name ?? null,
            thumbnailUrl: null,
            mislabeled,
            mislabelReason,
          },
        })
        .where(eq(resultsTable.id, resultId));
    } catch (err) {
      logger.warn({ err, resultId }, "ffprobe failed for result");
    }
  }
}

// GET /jobs/:id/export
router.get("/jobs/:id/export", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const format = (req.query.format as string) ?? "m3u";
  const statusFilter = req.query.status as string | undefined;
  const categoryFilter = req.query.category as string | undefined;

  const conditions = [eq(resultsTable.jobId, id)];
  if (statusFilter) {
    const statuses = statusFilter.split(",").map((s) => s.trim());
    if (statuses.length === 1) conditions.push(eq(resultsTable.status, statuses[0]));
  }
  if (categoryFilter) conditions.push(eq(resultsTable.category, categoryFilter));

  const results = await db
    .select()
    .from(resultsTable)
    .where(and(...conditions))
    .orderBy(resultsTable.category, resultsTable.tvgName);

  if (format === "m3u") {
    let output = "#EXTM3U\n";
    for (const r of results) {
      const duration = -1;
      const attrs = [
        r.tvgName ? `tvg-name="${r.tvgName}"` : "",
        r.tvgLogo ? `tvg-logo="${r.tvgLogo}"` : "",
        r.category ? `group-title="${r.category}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      output += `#EXTINF:${duration} ${attrs},${r.tvgName ?? r.url}\n`;
      output += `${r.url}\n`;
    }
    res.setHeader("Content-Type", "audio/x-mpegurl");
    res.setHeader("Content-Disposition", `attachment; filename="streamguard-export.m3u"`);
    res.send(output);
  } else if (format === "csv") {
    const header = "name,url,status,category,httpStatus,responseTimeMs,mimeType,failureReason,checkedAt\n";
    const rows = results
      .map(
        (r) =>
          [
            `"${(r.tvgName ?? "").replace(/"/g, '""')}"`,
            `"${r.url.replace(/"/g, '""')}"`,
            r.status,
            `"${(r.category ?? "").replace(/"/g, '""')}"`,
            r.httpStatus ?? "",
            r.responseTimeMs ?? "",
            r.mimeType ?? "",
            `"${(r.failureReason ?? "").replace(/"/g, '""')}"`,
            r.checkedAt?.toISOString() ?? "",
          ].join(",")
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="streamguard-report.csv"`);
    res.send(header + rows);
  } else {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="streamguard-report.json"`);
    res.json(results.map(formatResult));
  }
});

// GET /jobs/:id/diff/:compareId
router.get("/jobs/:id/diff/:compareId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawCmp = Array.isArray(req.params.compareId) ? req.params.compareId[0] : req.params.compareId;
  const id = parseInt(rawId, 10);
  const compareId = parseInt(rawCmp, 10);
  if (isNaN(id) || isNaN(compareId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const resultsA = await db.select().from(resultsTable).where(eq(resultsTable.jobId, id));
  const resultsB = await db.select().from(resultsTable).where(eq(resultsTable.jobId, compareId));

  const mapA = new Map(resultsA.map((r) => [r.channelId, r]));
  const mapB = new Map(resultsB.map((r) => [r.channelId, r]));

  const newlyDead: (typeof resultsTable.$inferSelect)[] = [];
  const newlyLive: (typeof resultsTable.$inferSelect)[] = [];
  let unchanged = 0;

  for (const [channelId, rA] of mapA.entries()) {
    const rB = mapB.get(channelId);
    if (!rB) continue;
    if (rA.status === "live" && rB.status !== "live") newlyDead.push(rB);
    else if (rA.status !== "live" && rB.status === "live") newlyLive.push(rB);
    else unchanged++;
  }

  res.json({
    jobId: id,
    compareJobId: compareId,
    newlyDead: newlyDead.map(formatResult),
    newlyLive: newlyLive.map(formatResult),
    unchanged,
    summary: `${newlyDead.length} went dead, ${newlyLive.length} came back live, ${unchanged} unchanged`,
  });
});

export default router;
