/**
 * StreamGuard — Cloudflare Workers entrypoint
 *
 * Framework : Hono
 * Database  : Drizzle ORM + @neondatabase/serverless (HTTP Postgres)
 * Real-time : Durable Objects + native WebSockets (replaces Socket.IO)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";

// Routes
import playlists from "./routes/playlists.js";
import jobs from "./routes/jobs.js";
import results from "./routes/results.js";
import settings from "./routes/settings.js";

// ── Re-export Durable Object class (required by wrangler) ────────────────────
export { JobRunnerDO } from "./durable-objects/job-runner.js";

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Disposition"],
  })
);

// Health check
app.get("/health", (c) => c.json({ ok: true, runtime: "cloudflare-workers" }));

// API routes
app.route("/playlists", playlists);
app.route("/jobs", jobs);
app.route("/results", results);
app.route("/settings", settings);

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error boundary
app.onError((err, c) => {
  console.error("[worker error]", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
