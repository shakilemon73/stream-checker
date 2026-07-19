/**
 * Drizzle schema — mirrors the Postgres schema in lib/db exactly.
 * Uses pg-core so the same SQL DDL applies.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
} from "drizzle-orm/pg-core";

// ── Playlists ──────────────────────────────────────────────────────────────────

export const playlistsTable = pgTable("playlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  entryCount: integer("entry_count").notNull().default(0),
  duplicatesFound: integer("duplicates_found").notNull().default(0),
  parseWarnings: jsonb("parse_warnings").notNull().$type<string[]>().default([]),
  groups: jsonb("groups").notNull().$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Channels ───────────────────────────────────────────────────────────────────

export const channelsTable = pgTable(
  "channels",
  {
    id: serial("id").primaryKey(),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlistsTable.id, { onDelete: "cascade" }),
    tvgId: text("tvg_id"),
    tvgName: text("tvg_name"),
    tvgLogo: text("tvg_logo"),
    groupTitle: text("group_title"),
    language: text("language"),
    country: text("country"),
    userAgent: text("user_agent"),
    referrer: text("referrer"),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("channels_playlist_idx").on(t.playlistId)]
);

// ── Jobs ───────────────────────────────────────────────────────────────────────

export const jobsTable = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlistsTable.id, { onDelete: "cascade" }),
    playlistName: text("playlist_name").notNull(),
    status: text("status").notNull().default("queued"),
    settings: jsonb("settings")
      .notNull()
      .$type<{
        concurrency: number;
        timeoutMs: number;
        retryCount: number;
        autoProbe: boolean;
        perHostConcurrency: number;
      }>(),
    total: integer("total").notNull().default(0),
    checked: integer("checked").notNull().default(0),
    live: integer("live").notNull().default(0),
    dead: integer("dead").notNull().default(0),
    geoblocked: integer("geoblocked").notNull().default(0),
    suspicious: integer("suspicious").notNull().default(0),
    pending: integer("pending").notNull().default(0),
    etaSeconds: integer("eta_seconds"),
    avgCheckMs: numeric("avg_check_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("jobs_playlist_idx").on(t.playlistId),
    index("jobs_status_idx").on(t.status),
  ]
);

// ── Results ────────────────────────────────────────────────────────────────────

export const resultsTable = pgTable(
  "results",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => channelsTable.id, { onDelete: "cascade" }),
    tvgName: text("tvg_name"),
    tvgLogo: text("tvg_logo"),
    url: text("url").notNull(),
    category: text("category"),
    status: text("status").notNull().default("pending"),
    httpStatus: integer("http_status"),
    responseTimeMs: integer("response_time_ms"),
    redirectCount: integer("redirect_count"),
    tlsValid: boolean("tls_valid"),
    mimeType: text("mime_type"),
    manifestValid: boolean("manifest_valid"),
    failureReason: text("failure_reason"),
    probeData: jsonb("probe_data").$type<{
      videoCodec?: string | null;
      audioCodec?: string | null;
      width?: number | null;
      height?: number | null;
      framerate?: number | null;
      bitrate?: number | null;
      container?: string | null;
      thumbnailUrl?: string | null;
      mislabeled?: boolean;
      mislabelReason?: string | null;
    } | null>(),
    checkedAt: timestamp("checked_at"),
  },
  (t) => [
    index("results_job_idx").on(t.jobId),
    index("results_status_idx").on(t.jobId, t.status),
    index("results_category_idx").on(t.jobId, t.category),
  ]
);

// ── App settings ───────────────────────────────────────────────────────────────

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  defaultConcurrency: integer("default_concurrency").notNull().default(30),
  defaultTimeoutMs: integer("default_timeout_ms").notNull().default(8000),
  defaultRetryCount: integer("default_retry_count").notNull().default(3),
  maxConcurrency: integer("max_concurrency").notNull().default(100),
  perHostConcurrency: integer("per_host_concurrency").notNull().default(10),
  autoProbeDefault: boolean("auto_probe_default").notNull().default(false),
  ffprobePath: text("ffprobe_path").notNull().default("ffprobe"),
});
