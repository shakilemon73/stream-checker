/**
 * JobRunnerDO — Durable Object that owns the lifecycle of a single check job.
 *
 * Responsibilities:
 *  • Runs the concurrent stream-check loop (replaces in-memory job-queue.ts)
 *  • Accepts WebSocket connections and broadcasts real-time progress
 *    (replaces Socket.IO)
 *  • Persists pause / cancel signals via Durable Object storage
 *
 * HTTP commands (sent from the Worker to the DO via stub.fetch()):
 *  POST /start    { jobId, databaseUrl }
 *  POST /pause
 *  POST /resume
 *  POST /cancel
 *  GET  /ws       — WebSocket upgrade for progress streaming
 */

import { getDb } from "../db.js";
import {
  jobsTable,
  resultsTable,
} from "../schema.js";
import { eq, and, sql } from "drizzle-orm";
import { checkStream, pickUserAgent } from "../lib/stream-checker.js";
import { createLimiter } from "../lib/limiter.js";

interface StartPayload {
  jobId: number;
  databaseUrl: string;
}

type BroadcastMessage =
  | { type: "job:progress"; jobId: number; checked: number; live: number; dead: number; geoblocked: number; suspicious: number; pending: number; etaSeconds: number; avgCheckMs: number }
  | { type: "job:result"; jobId: number; result: Record<string, unknown> }
  | { type: "job:status"; jobId: number; status: string };

export class JobRunnerDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    // Restore any WebSocket sessions after hibernation wake-up
    this.state.getWebSockets();
  }

  // ── Fetch handler (HTTP + WebSocket upgrades) ──────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade — client subscribes to job progress
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    const path = url.pathname.replace(/^.*\/do\/[^/]+/, ""); // strip DO prefix

    if (request.method === "POST" && path === "/start") {
      const payload = (await request.json()) as StartPayload;
      // Run the job in the background — keeps DO alive via waitUntil
      this.state.waitUntil(this.runJob(payload));
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && path === "/pause") {
      await this.state.storage.put("control", "paused");
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && path === "/resume") {
      await this.state.storage.put("control", "running");
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && path === "/cancel") {
      await this.state.storage.put("control", "cancelled");
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }

  // ── WebSocket hibernation callbacks ────────────────────────────────────────

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // Clients are receive-only — ignore any incoming messages
  }

  webSocketClose(_ws: WebSocket): void {
    // Nothing to clean up — hibernation API manages sessions
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    // Ignored
  }

  // ── Broadcast helpers ──────────────────────────────────────────────────────

  private broadcast(msg: BroadcastMessage): void {
    const encoded = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(encoded);
      } catch {
        // Client already closed — harmless
      }
    }
  }

  // ── Core job runner ────────────────────────────────────────────────────────

  private async runJob({ jobId, databaseUrl }: StartPayload): Promise<void> {
    const db = getDb(databaseUrl);

    // ── Load job & pending results ─────────────────────────────────────────
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) return;

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

    // ── Concurrency limiters ───────────────────────────────────────────────
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

    // ── Control-state helpers ──────────────────────────────────────────────
    const isCancelled = async () =>
      (await this.state.storage.get<string>("control")) === "cancelled";

    const waitIfPaused = async () => {
      while (true) {
        const ctrl = await this.state.storage.get<string>("control");
        if (ctrl !== "paused") break;
        await new Promise((r) => setTimeout(r, 400));
      }
    };

    // ── Progress tracking ──────────────────────────────────────────────────
    const counters = { live: 0, dead: 0, geoblocked: 0, suspicious: 0, checked: 0 };
    const checkTimes: number[] = [];

    // ── Process channels ───────────────────────────────────────────────────
    const tasks = pendingResults.map((result, idx) =>
      globalLimiter(async () => {
        if (await isCancelled()) return;
        await waitIfPaused();
        if (await isCancelled()) return;

        const hostLimiter = getHostLimiter(result.url);
        await hostLimiter(async () => {
          if (await isCancelled()) return;

          const t0 = Date.now();
          const checkResult = await checkStream(result.url, {
            timeoutMs: settings.timeoutMs ?? 8000,
            retryCount: settings.retryCount ?? 3,
            userAgent: pickUserAgent(idx),
          });
          const elapsed = Date.now() - t0;
          checkTimes.push(elapsed);
          if (checkTimes.length > 200) checkTimes.shift();

          // ── Persist result ───────────────────────────────────────────────
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

          // ── Update in-memory counters ────────────────────────────────────
          counters[checkResult.status]++;
          counters.checked++;

          const avgMs = checkTimes.reduce((a, b) => a + b, 0) / checkTimes.length;
          const remaining = pendingResults.length - counters.checked;
          const etaSec =
            remaining > 0 ? Math.round((remaining * avgMs) / (concurrency * 1000)) : 0;

          // ── Atomic DB counter increment ──────────────────────────────────
          const statusCol =
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
                    : "suspicious"]: sql`${statusCol} + 1`,
              checked: counters.checked,
              pending: Math.max(0, pendingResults.length - counters.checked),
              etaSeconds: etaSec,
              avgCheckMs: String(Math.round(avgMs)),
            })
            .where(eq(jobsTable.id, jobId));

          // ── Broadcast progress ───────────────────────────────────────────
          this.broadcast({
            type: "job:progress",
            jobId,
            checked: counters.checked,
            live: counters.live,
            dead: counters.dead,
            geoblocked: counters.geoblocked,
            suspicious: counters.suspicious,
            pending: Math.max(0, pendingResults.length - counters.checked),
            etaSeconds: etaSec,
            avgCheckMs: Math.round(avgMs),
          });

          // ── Broadcast per-result (fetch full row) ────────────────────────
          const [fullResult] = await db
            .select()
            .from(resultsTable)
            .where(eq(resultsTable.id, result.id));
          if (fullResult) {
            this.broadcast({ type: "job:result", jobId, result: fullResult as Record<string, unknown> });
          }
        });
      })
    );

    try {
      await Promise.all(tasks);
    } catch (err) {
      console.error("[JobRunnerDO] job execution error:", err);
    }

    // ── Finalise ───────────────────────────────────────────────────────────
    const cancelled = await isCancelled();
    const finalStatus = cancelled ? "cancelled" : "completed";

    await db
      .update(jobsTable)
      .set({
        status: finalStatus,
        completedAt: new Date(),
        ...(cancelled ? {} : { pending: 0 }),
      })
      .where(eq(jobsTable.id, jobId));

    this.broadcast({ type: "job:status", jobId, status: finalStatus });

    // Clean up storage
    await this.state.storage.delete("control");
  }
}
