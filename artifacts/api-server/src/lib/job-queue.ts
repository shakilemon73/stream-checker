import pLimit from "p-limit";
import { db } from "@workspace/db";
import {
  jobsTable,
  resultsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { checkStream, pickUserAgent } from "./stream-checker.js";
import { emitJobProgress, emitJobResult, emitJobStatus } from "./socket-server.js";
import { logger } from "./logger.js";

interface JobControl {
  status: "running" | "paused" | "cancelled";
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

const activeJobs = new Map<number, JobControl>();

export function getActiveJob(jobId: number): JobControl | undefined {
  return activeJobs.get(jobId);
}

export async function startJob(jobId: number): Promise<void> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);

  const pendingResults = await db
    .select({ id: resultsTable.id, url: resultsTable.url })
    .from(resultsTable)
    .where(and(eq(resultsTable.jobId, jobId), eq(resultsTable.status, "pending")));

  if (pendingResults.length === 0) return;

  const settings = job.settings;
  const concurrency = settings.concurrency ?? 30;
  const perHostConcurrency = settings.perHostConcurrency ?? 10;

  await db
    .update(jobsTable)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(jobsTable.id, jobId));

  const globalLimiter = pLimit(concurrency);
  const hostLimiters = new Map<string, ReturnType<typeof pLimit>>();

  const getHostLimiter = (url: string) => {
    try {
      const host = new URL(url).hostname;
      if (!hostLimiters.has(host)) {
        hostLimiters.set(host, pLimit(perHostConcurrency));
      }
      return hostLimiters.get(host)!;
    } catch {
      return pLimit(perHostConcurrency);
    }
  };

  let isPaused = false;
  let isCancelled = false;

  // In-memory counters
  const counters = { live: 0, dead: 0, geoblocked: 0, suspicious: 0, checked: 0 };
  const checkTimes: number[] = [];

  const control: JobControl = {
    status: "running",
    pause() {
      isPaused = true;
      this.status = "paused";
    },
    resume() {
      isPaused = false;
      this.status = "running";
    },
    cancel() {
      isCancelled = true;
      this.status = "cancelled";
    },
  };
  activeJobs.set(jobId, control);

  const waitIfPaused = async () => {
    while (isPaused && !isCancelled) {
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const tasks = pendingResults.map((result, idx) =>
    globalLimiter(async () => {
      if (isCancelled) return;
      await waitIfPaused();
      if (isCancelled) return;

      const hostLimiter = getHostLimiter(result.url);
      await hostLimiter(async () => {
        if (isCancelled) return;

        const t0 = Date.now();
        const checkResult = await checkStream(result.url, {
          timeoutMs: settings.timeoutMs ?? 8000,
          retryCount: settings.retryCount ?? 3,
          userAgent: pickUserAgent(idx),
        });
        const elapsed = Date.now() - t0;
        checkTimes.push(elapsed);
        if (checkTimes.length > 200) checkTimes.shift();

        // Update result row
        await db
          .update(resultsTable)
          .set({
            status: checkResult.status,
            httpStatus: checkResult.httpStatus ?? null,
            responseTimeMs: checkResult.responseTimeMs,
            redirectCount: checkResult.redirectCount ?? null,
            tlsValid: checkResult.tlsValid ?? null,
            mimeType: checkResult.mimeType ?? null,
            manifestValid: checkResult.manifestValid ?? null,
            failureReason: checkResult.failureReason ?? null,
            checkedAt: new Date(),
          })
          .where(eq(resultsTable.id, result.id));

        // Update in-memory counters
        counters[checkResult.status]++;
        counters.checked++;

        const avgMs = checkTimes.reduce((a, b) => a + b, 0) / checkTimes.length;
        const remaining = pendingResults.length - counters.checked;
        const etaSec =
          remaining > 0 ? Math.round((remaining * avgMs) / (concurrency * 1000)) : 0;

        // Increment status counter in DB atomically
        const incCol =
          checkResult.status === "live"
            ? jobsTable.live
            : checkResult.status === "dead"
              ? jobsTable.dead
              : checkResult.status === "geoblocked"
                ? jobsTable.geoblocked
                : jobsTable.suspicious;

        await db
          .update(jobsTable)
          .set({
            [checkResult.status === "live"
              ? "live"
              : checkResult.status === "dead"
                ? "dead"
                : checkResult.status === "geoblocked"
                  ? "geoblocked"
                  : "suspicious"]: sql`${incCol} + 1`,
            checked: counters.checked,
            pending: Math.max(0, pendingResults.length - counters.checked),
            etaSeconds: etaSec,
            avgCheckMs: String(Math.round(avgMs)),
          })
          .where(eq(jobsTable.id, jobId));

        // Emit progress event
        emitJobProgress(jobId, {
          checked: counters.checked,
          live: counters.live,
          dead: counters.dead,
          geoblocked: counters.geoblocked,
          suspicious: counters.suspicious,
          pending: Math.max(0, pendingResults.length - counters.checked),
          etaSeconds: etaSec,
          avgCheckMs: Math.round(avgMs),
        });

        // Emit individual result
        const [fullResult] = await db
          .select()
          .from(resultsTable)
          .where(eq(resultsTable.id, result.id));
        if (fullResult) {
          emitJobResult(jobId, fullResult);
        }
      });
    })
  );

  try {
    await Promise.all(tasks);
  } catch (err) {
    logger.error({ err, jobId }, "Job execution error");
  }

  activeJobs.delete(jobId);

  if (isCancelled) {
    await db
      .update(jobsTable)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(jobsTable.id, jobId));
    emitJobStatus(jobId, "cancelled");
  } else {
    await db
      .update(jobsTable)
      .set({ status: "completed", completedAt: new Date(), pending: 0 })
      .where(eq(jobsTable.id, jobId));
    emitJobStatus(jobId, "completed");
  }
}
