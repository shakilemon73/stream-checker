---
name: CF Worker architecture
description: How the StreamGuard Cloudflare Workers port is structured and what differs from the Express server
---

## Location
`artifacts/cf-worker/` — standalone pnpm package, not a registered artifact type (createArtifact has no CF Workers type)

## Stack — FREE TIER (no Durable Objects, no KV, no Queues)
- **Framework**: Hono (replaces Express)
- **DB**: Drizzle ORM + `@neondatabase/serverless` HTTP driver — works in Workers without Hyperdrive
- **Schema**: `src/schema.ts` is a copy of `lib/db/src/schema/` — same Postgres DDL, no migration needed if pointing at the same DB
- **Job runner**: client-orchestrated batch polling — client calls `POST /jobs/:id/process` in a loop, each call checks ≤10 channels concurrently and returns `BatchProgress { done, checked, live, dead, ... }`
- **Pause/cancel**: stored in `jobs.status` DB column — process endpoint returns early if status is paused/cancelled

## Free-tier budget per /process call (batch=10)
- CPU: <2ms (pure I/O wait — under 10ms limit) ✅
- Subrequests: ≤42 (10 checks × 3 retries + 10 DB writes + 2 overhead — under 50 limit) ✅
- Wall clock: ~8–12s (10 concurrent × 8s timeout — under 30s limit) ✅

## Key differences from Express server
| Feature | Express | CF Worker |
|---|---|---|
| ffprobe probe | execFile child_process | 501 Not Implemented |
| p-limit | npm package | custom `createLimiter()` in `src/lib/limiter.ts` |
| timers/promises | Node import | `new Promise(r => setTimeout(r, ms))` |
| Buffer.from(b64) | Node Buffer | `atob()` + TextDecoder |
| Socket.IO | socket.io + WebSockets | client polls `/jobs/:id/process` response |
| In-memory activeJobs | Map in job-queue.ts | DB `jobs.status` column |

## Dev setup
1. Copy `.dev.vars.example` → `.dev.vars`, fill `DATABASE_URL`
2. `pnpm --filter @workspace/cf-worker run dev` (workflow: `artifacts/cf-worker: Wrangler Dev`)
3. Listens on `$PORT` (defaults to 8787)

## Deploy
```bash
wrangler secret put DATABASE_URL   # paste Neon/Supabase/Hyperdrive URL
pnpm --filter @workspace/cf-worker run deploy
```
Requires Cloudflare paid plan for Durable Objects.

## Workers-types note
Peer dependency requires `@cloudflare/workers-types@^5.x`; wrangler 4.x ships with it.
`DurableObjectNamespace` is used without generic (avoids brand constraint); this is safe at runtime.
