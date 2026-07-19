# StreamGuard — Cloudflare Workers API

A full port of the Express/Node.js API to the Cloudflare Workers edge runtime.

| Feature | Implementation |
|---|---|
| Framework | [Hono](https://hono.dev/) |
| Database | Drizzle ORM + [@neondatabase/serverless](https://github.com/neondatabase/serverless) (HTTP Postgres) |
| Real-time progress | Durable Objects + native WebSockets |
| Job runner | `JobRunnerDO` Durable Object (replaces in-memory queue + Socket.IO) |
| ffprobe deep-probe | ❌ Not supported at the edge — `/jobs/:id/probe` returns 501 |

---

## Local development

### 1. Create `.dev.vars`

```bash
cp .dev.vars.example .dev.vars
# Fill in DATABASE_URL with your Postgres connection string
```

### 2. Install dependencies

```bash
cd artifacts/cf-worker
pnpm install
```

### 3. Start the local dev server

```bash
pnpm dev
# Listens on http://localhost:8787 by default
# Wrangler loads .dev.vars automatically
```

---

## Deploy to Cloudflare

### Prerequisites

- A Cloudflare account with Workers & Durable Objects enabled (paid plan required for Durable Objects)
- A Postgres database reachable from Cloudflare's network — recommended options:
  - **[Neon](https://neon.tech)** (serverless, free tier, HTTP-compatible)
  - **[Supabase](https://supabase.com)** (managed Postgres)
  - **[Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)** (if you have an existing Postgres)

### 1. Authenticate wrangler

```bash
npx wrangler login
```

### 2. Set the database URL secret

```bash
npx wrangler secret put DATABASE_URL
# Paste your Postgres connection string when prompted
```

### 3. Deploy

```bash
pnpm deploy
```

### 4. (Optional) Point a custom domain

Edit `wrangler.toml` and add:

```toml
[env.production]
routes = [
  { pattern = "your-domain.com/api/*", zone_name = "your-domain.com" }
]
```

---

## Frontend WebSocket connection

The frontend connects to job progress via WebSocket at:

```
wss://<worker-domain>/jobs/<jobId>/ws
```

Update `artifacts/streamguard/src/lib/socket.ts` (or wherever `io()` is called) to use this endpoint instead of Socket.IO:

```ts
const ws = new WebSocket(`wss://your-worker.workers.dev/jobs/${jobId}/ws`);
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "job:progress") { /* update counters */ }
  if (msg.type === "job:result")   { /* append result row */ }
  if (msg.type === "job:status")   { /* job finished */ }
});
```

---

## Schema

The DB schema is identical to the Postgres schema in `lib/db/`. Run migrations
against your target Postgres using the existing `lib/db` drizzle-kit config,
then point the Worker at the same database.

```bash
# From repo root — pushes schema to whichever DB is in DATABASE_URL
cd lib/db && DATABASE_URL=<your-target-db> pnpm push
```
