import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema/index.js";

const { Pool } = pg;

export type DbClient = ReturnType<typeof drizzlePg<typeof schema>>;

let poolInstance: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;
let dbInstance: DbClient;

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS playlists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  duplicates_found INTEGER NOT NULL DEFAULT 0,
  parse_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  github_repo TEXT,
  github_branch TEXT,
  github_path TEXT,
  auto_push_github BOOLEAN NOT NULL DEFAULT FALSE,
  last_pushed_at TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS github_repo TEXT;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS github_branch TEXT;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS github_path TEXT;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS auto_push_github BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS last_pushed_at TEXT;

CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  tvg_id TEXT,
  tvg_name TEXT,
  tvg_logo TEXT,
  group_title TEXT,
  language TEXT,
  country TEXT,
  user_agent TEXT,
  referrer TEXT,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS channels_playlist_idx ON channels(playlist_id);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  playlist_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  settings JSONB NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  live INTEGER NOT NULL DEFAULT 0,
  dead INTEGER NOT NULL DEFAULT 0,
  geoblocked INTEGER NOT NULL DEFAULT 0,
  suspicious INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  eta_seconds INTEGER,
  avg_check_ms NUMERIC,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS jobs_playlist_idx ON jobs(playlist_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);

CREATE TABLE IF NOT EXISTS results (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  tvg_name TEXT,
  tvg_logo TEXT,
  url TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  response_time_ms INTEGER,
  redirect_count INTEGER,
  tls_valid BOOLEAN,
  mime_type TEXT,
  manifest_valid BOOLEAN,
  failure_reason TEXT,
  probe_data JSONB,
  checked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS results_job_idx ON results(job_id);
CREATE INDEX IF NOT EXISTS results_status_idx ON results(job_id, status);
CREATE INDEX IF NOT EXISTS results_category_idx ON results(job_id, category);

CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  default_concurrency INTEGER NOT NULL DEFAULT 10,
  default_timeout_ms INTEGER NOT NULL DEFAULT 5000,
  default_retry_count INTEGER NOT NULL DEFAULT 1,
  max_concurrency INTEGER NOT NULL DEFAULT 50,
  per_host_concurrency INTEGER NOT NULL DEFAULT 3,
  auto_probe_default BOOLEAN NOT NULL DEFAULT TRUE,
  ffprobe_path TEXT,
  github_token TEXT,
  github_owner TEXT,
  github_repo TEXT,
  github_branch TEXT,
  github_path TEXT,
  github_auto_push BOOLEAN NOT NULL DEFAULT FALSE,
  github_last_push_at TEXT,
  github_last_push_status TEXT
);

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_token TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_owner TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_repo TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_branch TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_path TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_auto_push BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_last_push_at TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS github_last_push_status TEXT;
`;

if (process.env.DATABASE_URL) {
  const isSsl =
    process.env.DATABASE_URL.includes("neon.tech") ||
    process.env.DATABASE_URL.includes("sslmode=require") ||
    process.env.DATABASE_URL.includes("ssl=true");

  poolInstance = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ssl: isSsl ? { rejectUnauthorized: false } : undefined,
  });
  dbInstance = drizzlePg(poolInstance, { schema }) as unknown as DbClient;
} else {
  const dataDir = path.resolve(process.cwd(), ".data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  pgliteInstance = new PGlite(path.join(dataDir, "streamguard.db"));
  dbInstance = drizzlePglite(pgliteInstance, { schema }) as unknown as DbClient;
}

export async function initDb(): Promise<void> {
  if (pgliteInstance) {
    await pgliteInstance.exec(SCHEMA_DDL);
  } else if (poolInstance) {
    const client = await poolInstance.connect();
    try {
      await client.query(SCHEMA_DDL);
    } finally {
      client.release();
    }
  }
}

export const pool = poolInstance;
export const db = dbInstance;
export * from "./schema/index.js";
