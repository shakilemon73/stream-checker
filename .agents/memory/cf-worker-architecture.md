---
name: CF Worker architecture
description: How the StreamGuard Cloudflare Workers port is structured and what differs from the Express server
---

## Location
`artifacts/cf-worker/` — standalone pnpm package, not a registered artifact type (createArtifact has no CF Workers type)

## Stack
- **Framework**: Hono (replaces Express)
- **DB**: Drizzle ORM + `@neondatabase/serverless` HTTP driver — works in Workers without Hyperdrive
- **Schema**: `src/schema.ts` is a copy of `lib/db/src/schema/` — same Postgres DDL, no migration needed if pointing at the same DB
- **Real-time**: Durable Objects + native WebSocket API (replaces Socket.IO)
- **Job runner**: `JobRunnerDO` Durable Object — one instance per job ID, runs via `state.waitUntil()`

## Key differences from Express server
| Feature | Express | CF Worker |
|---|---|---|
| ffprobe probe | execFile child_process | 501 Not Implemented |
| p-limit | npm package | custom `createLimiter()` in `src/lib/limiter.ts` |
| timers/promises | Node import | `new Promise(r => setTimeout(r, ms))` |
| Buffer.from(b64) | Node Buffer | `atob()` + TextDecoder |
| Socket.IO | socket.io package | DO WebSockets at `GET /jobs/:id/ws` |
| In-memory activeJobs | Map in job-queue.ts | DO storage (`state.storage.put("control", ...)`) |

## DO command routing
Worker → DO via `stub.fetch("https://do/do/<jobId>/<path>")`:
- `POST /start` — begins job, `state.waitUntil(runJob())`
- `POST /pause` — sets `state.storage` key "control" = "paused"
- `POST /resume` — sets key to "running"
- `POST /cancel` — sets key to "cancelled"
- `GET /ws` (WebSocket upgrade) — `state.acceptWebSocket(server)`, broadcasts `job:progress`, `job:result`, `job:status`

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
