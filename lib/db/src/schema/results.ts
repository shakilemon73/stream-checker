import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { channelsTable } from "./channels";

export const resultsTable = pgTable("results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  channelId: integer("channel_id").notNull().references(() => channelsTable.id, { onDelete: "cascade" }),
  tvgName: text("tvg_name"),
  tvgLogo: text("tvg_logo"),
  url: text("url").notNull(),
  category: text("category"),
  status: text("status").notNull().default("pending"), // live | dead | geoblocked | suspicious | pending
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
}, (t) => [
  index("results_job_idx").on(t.jobId),
  index("results_status_idx").on(t.jobId, t.status),
  index("results_category_idx").on(t.jobId, t.category),
]);

export type Result = typeof resultsTable.$inferSelect;
export type InsertResult = typeof resultsTable.$inferInsert;
