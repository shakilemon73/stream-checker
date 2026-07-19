import { pgTable, serial, integer, boolean, text } from "drizzle-orm/pg-core";

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

export type AppSettings = typeof appSettingsTable.$inferSelect;
