import { pgTable, serial, text, integer, index } from "drizzle-orm/pg-core";
import { playlistsTable } from "./playlists";

export const channelsTable = pgTable("channels", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull().references(() => playlistsTable.id, { onDelete: "cascade" }),
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
}, (t) => [
  index("channels_playlist_idx").on(t.playlistId),
]);

export type Channel = typeof channelsTable.$inferSelect;
export type InsertChannel = typeof channelsTable.$inferInsert;
