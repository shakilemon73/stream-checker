# StreamGuard — Cloudflare Workers Deploy Guide

Zero paid features. Runs on the Cloudflare **free plan**.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 18 | https://nodejs.org |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Wrangler CLI | ≥ 4 (included) | already in `devDependencies` |
| Cloudflare account | Free | https://dash.cloudflare.com/sign-up |
| Neon Postgres | Free | https://neon.tech (or Supabase) |

---

## One-time setup (do this once, ever)

### 1 — Log in to Cloudflare

```bash
cd artifacts/cf-worker
npx wrangler login
```

A browser window opens. Approve access. Your credentials are cached in `~/.wrangler`.

---

### 2 — Store your database URL as a secret

```bash
npx wrangler secret put DATABASE_URL
```

Paste your Neon / Supabase connection string when prompted.  
The value is encrypted and stored by Cloudflare — it never touches your filesystem or git.

> **Your URL (already set):**
> ```
> postgresql://neondb_owner:...@ep-jolly-lake-...neon.tech/neondb?sslmode=require
> ```

---

### 3 — Push the schema to Neon (first deploy only)

Run from the repo root:

```bash
DATABASE_URL="<your-neon-url>" pnpm --filter @workspace/db push
```

✅ Already done — skip if the tables are already there.

---

### 4 — Deploy

```bash
cd artifacts/cf-worker
pnpm run deploy
```

Wrangler bundles `src/index.ts`, uploads it, and prints your worker URL:

```
✅  https://streamguard.<your-subdomain>.workers.dev
```

---

## Subsequent deploys

Every code change:

```bash
cd artifacts/cf-worker
pnpm run deploy
```

That's it. Wrangler re-bundles and re-uploads in ~10 seconds.

---

## CI/CD via GitHub Actions (auto-deploy on push)

The file `.github/workflows/deploy-cf-worker.yml` is already committed.  
It deploys automatically whenever you push to `main` and any file under `artifacts/cf-worker/` changes.

### Add GitHub Secrets (one-time)

1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**
2. Add these two secrets:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → **My Profile → API Tokens → Create Token** → use the **"Edit Cloudflare Workers"** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → right sidebar on the **Workers & Pages** overview page |

After saving both secrets, the next `git push` to `main` will trigger a deploy.

---

## Verify the deployment

```bash
# Health check
curl https://streamguard.<your-subdomain>.workers.dev/health
# → {"ok":true,"runtime":"cloudflare-workers","plan":"free"}

# List jobs
curl https://streamguard.<your-subdomain>.workers.dev/jobs
```

---

## Update the frontend to point at the deployed worker

In `artifacts/streamguard`, change the API base URL from the Express server to your worker URL.

**In `.env.production` (create if missing):**

```env
VITE_API_BASE_URL=https://streamguard.<your-subdomain>.workers.dev
```

**Replace Socket.IO polling with the new batch loop:**

```typescript
// Before (Socket.IO)
const socket = io({ path: '/api/socket.io' });

// After (CF Worker polling)
async function runJob(jobId: number, onProgress: (p: BatchProgress) => void) {
  while (true) {
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/jobs/${jobId}/process`, {
      method: 'POST',
    });
    const progress: BatchProgress = await res.json();
    onProgress(progress);
    if (progress.done) break;

    // Paused/cancelled — stop the loop
    const job = await fetch(`${import.meta.env.VITE_API_BASE_URL}/jobs/${jobId}`).then(r => r.json());
    if (job.status === 'paused' || job.status === 'cancelled') break;
  }
}
```

---

## Custom domain (optional)

After your first deploy, uncomment the `[[routes]]` block in `wrangler.toml`:

```toml
[[routes]]
pattern = "api.yourdomain.com/*"
zone_name = "yourdomain.com"
```

Then redeploy:

```bash
pnpm run deploy
```

---

## Troubleshoot

| Symptom | Fix |
|---|---|
| `Missing binding: DATABASE_URL` | Run `npx wrangler secret put DATABASE_URL` |
| `relation "jobs" does not exist` | Run `pnpm --filter @workspace/db push` against your Neon URL |
| `subrequest limit exceeded` | Reduce batch size: `POST /jobs/:id/process?batch=5` |
| CORS errors from frontend | `wrangler.toml` has `cors()` for `*`; check the deployed URL matches `VITE_API_BASE_URL` |
| Local dev not connecting to DB | Confirm `artifacts/cf-worker/.dev.vars` contains `DATABASE_URL=...` |

---

## Free-tier limits recap

| Resource | Free allowance | StreamGuard usage |
|---|---|---|
| Worker requests | 100,000 / day | 1 request per 10 channels checked |
| CPU time | 10 ms / request | < 2 ms (rest is I/O wait) |
| Subrequests | 50 / request | ≤ 42 per batch of 10 |
| Workers (deployments) | Unlimited | 1 |
| Custom domains | 1 | optional |
