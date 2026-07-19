/**
 * StreamGuard — Cloudflare Workers API (free-tier compatible)
 *
 * Framework  : Hono
 * Database   : Drizzle ORM + @neondatabase/serverless (HTTP Postgres)
 * Real-time  : Client polls POST /jobs/:id/process in a loop
 *              (no Durable Objects, no WebSockets, no KV — all free tier)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";

import playlists from "./routes/playlists.js";
import jobs      from "./routes/jobs.js";
import results   from "./routes/results.js";
import settings  from "./routes/settings.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["Content-Disposition"],
}));

app.get("/health", (c) =>
  c.json({ ok: true, runtime: "cloudflare-workers", plan: "free" })
);

app.route("/playlists", playlists);
app.route("/jobs",      jobs);
app.route("/results",   results);
app.route("/settings",  settings);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("[worker]", err);
  return c.json({ error: "Internal server error" }, 500);
});

// No Durable Object exports — not needed on free plan
export default app;
