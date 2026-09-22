/**
 * Stateless batch stream-checker for CF Workers free tier.
 *
 * CF free-tier constraints respected:
 *  • 10ms CPU time per request (I/O waits don't count — we're 99 % I/O)
 *  • 50 subrequests per invocation
 *    → batch ≤ 10 channels: 10 checks (×1–3 retries) + 10 DB writes + 2 overhead = ≤ 42
 *  • 30 s wall-clock request timeout
 *    → 10 concurrent checks at 8 s timeout each ≈ 8–12 s per batch
 *  • No Durable Objects, no KV, no Queues
 *
 * The client is responsible for calling POST /jobs/:id/process in a loop
 * until the response field `done` is true.
 */

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { jobsTable, resultsTable } from "../schema.js";
import { checkStream, pickUserAgent } from "./stream-checker.js";
import { createLimiter } from "./limiter.js";

export interface BatchProgress {
  jobId: number;
  status: string;
  processed: number;   // channels handled in this batch
  checked: number;     // cumulative total checked
  live: number;
  dead: number;
  geoblocked: number;
  suspicious: number;
  pending: number;
  total: number;
  done: boolean;       // true when no more pending channels remain
  etaSeconds: number;
}

export async function processBatch(
  db: Db,
  jobId: number,
  batchSize: number
): Promise<BatchProgress> {
  // ── Load job ───────────────────────────────────────────────────────────────
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);

  // If the job is paused or cancelled, return current state immediately
  if (job.status === "paused" || job.status === "cancelled" || job.status === "completed") {
    return {
      jobId,
      status: job.status,
      processed: 0,
      checked: job.checked,
      live: job.live,
      dead: job.dead,
      geoblocked: job.geoblocked,
      suspicious: job.suspicious,
      pending: job.pending,
      total: job.total,
      done: job.status === "completed" || job.status === "cancelled",
      etaSeconds: 0,
    };
  }

  const settings = job.settings;
  const concurrency = Math.min(settings.concurrency ?? 10, batchSize);
  const perHostConcurrency = settings.perHostConcurrency ?? 3;

  // Mark as running if it's still queued
  if (job.status === "queued") {
    await db
      .update(jobsTable)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(jobsTable.id, jobId));
  }

  // ── Fetch one batch of pending results ─────────────────────────────────────
  const pending = await db
    .select({ id: resultsTable.id, url: resultsTable.url })
    .from(resultsTable)
    .where(and(eq(resultsTable.jobId, jobId), eq(resultsTable.status, "pending")))
    .limit(batchSize);

  if (pending.length === 0) {
    // No more pending — mark completed
    await db
      .update(jobsTable)
      .set({ status: "completed", completedAt: new Date(), pending: 0 })
      .where(eq(jobsTable.id, jobId));

    return {
      jobId,
      status: "completed",
      processed: 0,
      checked: job.checked,
      live: job.live,
      dead: job.dead,
      geoblocked: job.geoblocked,
      suspicious: job.suspicious,
      pending: 0,
      total: job.total,
      done: true,
      etaSeconds: 0,
    };
  }

  // ── Check streams concurrently within this batch ───────────────────────────
  const globalLimiter = createLimiter(concurrency);
  const hostLimiters = new Map<string, ReturnType<typeof createLimiter>>();

  const getHostLimiter = (url: string) => {
    try {
      const host = new URL(url).hostname;
      if (!hostLimiters.has(host)) hostLimiters.set(host, createLimiter(perHostConcurrency));
      return hostLimiters.get(host)!;
    } catch {
      return createLimiter(perHostConcurrency);
    }
  };

  const batchCounters = { live: 0, dead: 0, geoblocked: 0, suspicious: 0 };
  const checkTimes: number[] = [];

  const tasks = pending.map((row, idx) =>
    globalLimiter(async () => {
      const hostLimiter = getHostLimiter(row.url);
      await hostLimiter(async () => {
        const t0 = Date.now();
        const result = await checkStream(row.url, {
          timeoutMs: settings.timeoutMs ?? 8000,
          retryCount: settings.retryCount ?? 2, // keep retries low to respect subrequest limit
          userAgent: pickUserAgent(idx),
        });
        checkTimes.push(Date.now() - t0);

        await db
          .update(resultsTable)
          .set({
            status: result.status,
            httpStatus: result.httpStatus ?? null,
            responseTimeMs: result.responseTimeMs,
            redirectCount: result.redirectCount ?? null,
            tlsValid: result.tlsValid ?? null,
            mimeType: result.mimeType ?? null,
            manifestValid: result.manifestValid ?? null,
            failureReason: result.failureReason ?? null,
            checkedAt: new Date(),
          })
          .where(eq(resultsTable.id, row.id));

        batchCounters[result.status]++;
      });
    })
  );

  await Promise.all(tasks);

  // ── Update job counters ────────────────────────────────────────────────────
  const avgMs =
    checkTimes.length > 0
      ? checkTimes.reduce((a, b) => a + b, 0) / checkTimes.length
      : 0;

  const processed = pending.length;
  const newChecked = job.checked + processed;
  const newPending = Math.max(0, job.pending - processed);
  const remainingAfter = newPending;
  const currentConcurrency = concurrency;
  const etaSec =
    remainingAfter > 0 && avgMs > 0
      ? Math.round((remainingAfter * avgMs) / (currentConcurrency * 1000))
      : 0;

  await db
    .update(jobsTable)
    .set({
      live:        sql`${jobsTable.live}        + ${batchCounters.live}`,
      dead:        sql`${jobsTable.dead}        + ${batchCounters.dead}`,
      geoblocked:  sql`${jobsTable.geoblocked}  + ${batchCounters.geoblocked}`,
      suspicious:  sql`${jobsTable.suspicious}  + ${batchCounters.suspicious}`,
      checked:     sql`${jobsTable.checked}     + ${processed}`,
      pending:     sql`GREATEST(${jobsTable.pending} - ${processed}, 0)`,
      etaSeconds:  etaSec,
      avgCheckMs:  String(Math.round(avgMs)),
    })
    .where(eq(jobsTable.id, jobId));

  // Reload updated job row
  const [updated] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));

  const isDone = (updated?.pending ?? 0) === 0;

  if (isDone) {
    await db
      .update(jobsTable)
      .set({ status: "completed", completedAt: new Date(), pending: 0 })
      .where(eq(jobsTable.id, jobId));
  }

  return {
    jobId,
    status: isDone ? "completed" : "running",
    processed,
    checked: updated?.checked ?? newChecked,
    live: updated?.live ?? 0,
    dead: updated?.dead ?? 0,
    geoblocked: updated?.geoblocked ?? 0,
    suspicious: updated?.suspicious ?? 0,
    pending: updated?.pending ?? newPending,
    total: job.total,
    done: isDone,
    etaSeconds: etaSec,
  };
}
