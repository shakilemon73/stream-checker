import { pgTable, serial, text, integer, timestamp, jsonb, numeric, index } from "drizzle-orm/pg-core";
import { playlistsTable } from "./playlists";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull().references(() => playlistsTable.id, { onDelete: "cascade" }),
  playlistName: text("playlist_name").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | paused | completed | cancelled | failed
  settings: jsonb("settings").notNull().$type<{
    concurrency: number;
    timeoutMs: number;
    retryCount: number;
    autoProbe: boolean;
    perHostConcurrency: number;
    userAgents?: string[];
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
}, (t) => [
  index("jobs_playlist_idx").on(t.playlistId),
  index("jobs_status_idx").on(t.status),
]);

export type Job = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;
