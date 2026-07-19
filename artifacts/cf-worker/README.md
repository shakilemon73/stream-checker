# StreamGuard — Cloudflare Workers API (Free Tier)

Runs entirely within the Cloudflare Workers **free plan** — no paid features required.

| Feature | Implementation |
|---|---|
| Framework | [Hono](https://hono.dev/) |
| Database | Drizzle ORM + [@neondatabase/serverless](https://github.com/neondatabase/serverless) (HTTP Postgres) |
| Job execution | **Client-orchestrated batch polling** — client calls `POST /jobs/:id/process` in a loop |
| Real-time progress | Client reads `BatchProgress` from each `/process` response — no WebSockets needed |
| Pause / Resume | DB-persisted `status` field — client stops/resumes its loop |
| Durable Objects | ❌ Not used |
| KV / Queues / R2 | ❌ Not used |
| ffprobe deep-probe | ❌ Not supported at the edge (`/probe` returns 501) |

---

## Free-tier budget per `/process` call

CF Workers free limits and how each batch call fits:

| Limit | Free allowance | Per-batch usage |
|---|---|---|
| CPU time | 10 ms | < 2 ms — nearly all time is I/O wait |
| Subrequests | 50 | ≤ 42 (10 checks × 3 retries + 10 DB writes + 2 overhead) |
| Wall-clock time | 30 s | ≈ 8–12 s (10 concurrent checks × 8 s timeout) |
| Requests/day | 100,000 | 1 request per batch of 10 channels |

---

## Client integration

Replace Socket.IO with a simple polling loop on the frontend:

```typescript
// Start the job
const job = await fetch('/jobs', {
  method: 'POST',
  body: JSON.stringify({ playlistId }),
}).then(r => r.json());

// Drive the checking loop
async function runJob(jobId: number) {
  while (true) {
    const progress = await fetch(`/jobs/${jobId}/process`, {
      method: 'POST',
    }).then(r => r.json());

    // progress: { done, checked, live, dead, geoblocked, suspicious, pending, total, etaSeconds }
    updateUI(progress);

    if (progress.done) break;

    // Check if the user paused/cancelled (optimistic — next call will see status)
    const currentStatus = await fetch(`/jobs/${jobId}`).then(r => r.json());
    if (currentStatus.status === 'paused' || currentStatus.status === 'cancelled') break;
  }
}
```

WebSocket message shape → polling shape mapping:

| Socket.IO `job:progress` field | `/process` response field |
|---|---|
| `checked` | `checked` |
| `live` | `live` |
| `dead` | `dead` |
| `geoblocked` | `geoblocked` |
| `suspicious` | `suspicious` |
| `pending` | `pending` |
| `etaSeconds` | `etaSeconds` |

---

## Local development

```bash
# 1. Copy env file and set your Postgres URL
cp artifacts/cf-worker/.dev.vars.example artifacts/cf-worker/.dev.vars
# Edit .dev.vars: DATABASE_URL=postgres://...

# 2. Install deps (from repo root)
pnpm --filter @workspace/cf-worker install

# 3. Start the dev server (Replit workflow: "artifacts/cf-worker: Wrangler Dev")
pnpm --filter @workspace/cf-worker run dev
# → http://localhost:8787
```

---

## Deploy to Cloudflare (free plan)

```bash
cd artifacts/cf-worker

# Authenticate
npx wrangler login

# Store your Postgres connection string as a secret
npx wrangler secret put DATABASE_URL
# Paste: postgres://user:pass@host/db  (Neon, Supabase, or any accessible Postgres)

# Deploy
pnpm run deploy
```

### Recommended free Postgres options

| Provider | Free tier | Notes |
|---|---|---|
| [Neon](https://neon.tech) | 0.5 GB, HTTP driver native | Best fit — driver already configured |
| [Supabase](https://supabase.com) | 500 MB | Use connection pooler URL |
| [Aiven](https://aiven.io) | 5 GB (trial) | Standard Postgres URL |

### Point existing Postgres at Neon

If you want to migrate the Replit Postgres data to Neon:

```bash
# Dump from Replit Postgres
pg_dump $DATABASE_URL > dump.sql

# Restore to Neon
psql $NEON_DATABASE_URL < dump.sql
```

---

## Schema

The `src/schema.ts` is identical to `lib/db/src/schema/`. Push it to your target DB:

```bash
cd lib/db
DATABASE_URL=<your-neon-url> pnpm push
```
