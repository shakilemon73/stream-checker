import { Hono } from "hono";
import { eq, ilike, and, count } from "drizzle-orm";
import { getDb } from "../db.js";
import { playlistsTable, channelsTable } from "../schema.js";
import { parseM3U } from "../lib/m3u-parser.js";
import type { Env } from "../types.js";

const playlists = new Hono<{ Bindings: Env }>();

function fmtPlaylist(p: typeof playlistsTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    sourceType: p.sourceType,
    sourceUrl: p.sourceUrl,
    entryCount: p.entryCount,
    duplicatesFound: p.duplicatesFound,
    parseWarnings: p.parseWarnings,
    groups: p.groups,
    createdAt: p.createdAt,
  };
}

// GET /playlists
playlists.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db.select().from(playlistsTable).orderBy(playlistsTable.createdAt);
  return c.json(rows.map(fmtPlaylist));
});

// POST /playlists
playlists.post("/", async (c) => {
  const body = await c.req.json<{
    name?: string;
    sourceType?: string;
    content?: string;
    url?: string;
  }>();

  const { name, sourceType, content, url } = body;

  if (!name || !sourceType)
    return c.json({ error: "name and sourceType are required" }, 400);
  if (!["text", "url", "file"].includes(sourceType))
    return c.json({ error: "sourceType must be text, url, or file" }, 400);

  let rawContent = "";
  let sourceUrl: string | null = null;

  if (sourceType === "text") {
    if (!content) return c.json({ error: "content is required for sourceType=text" }, 400);
    rawContent = content;
  } else if (sourceType === "url") {
    if (!url) return c.json({ error: "url is required for sourceType=url" }, 400);
    sourceUrl = url;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch(url, {
        headers: { "User-Agent": "StreamGuard/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return c.json({ error: `Failed to fetch URL: HTTP ${res.status}` }, 400);
      rawContent = await res.text();
    } catch (err) {
      return c.json({ error: `Failed to fetch URL: ${(err as Error).message}` }, 400);
    }
  } else if (sourceType === "file") {
    if (!content) return c.json({ error: "content (base64) is required for sourceType=file" }, 400);
    try {
      // CF Workers: atob + TextDecoder instead of Buffer
      const binary = atob(content);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      rawContent = new TextDecoder().decode(bytes);
    } catch {
      rawContent = content;
    }
  }

  const parsed = parseM3U(rawContent);
  const db = getDb(c.env.DATABASE_URL);

  const [playlist] = await db
    .insert(playlistsTable)
    .values({
      name,
      sourceType,
      sourceUrl,
      entryCount: parsed.channels.length,
      duplicatesFound: parsed.duplicateCount,
      parseWarnings: parsed.warnings.slice(0, 50),
      groups: parsed.groups,
    })
    .returning();

  if (parsed.channels.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < parsed.channels.length; i += batchSize) {
      const batch = parsed.channels.slice(i, i + batchSize).map((ch, idx) => ({
        playlistId: playlist!.id,
        tvgId: ch.tvgId ?? null,
        tvgName: ch.tvgName ?? null,
        tvgLogo: ch.tvgLogo ?? null,
        groupTitle: ch.groupTitle ?? null,
        language: ch.language ?? null,
        country: ch.country ?? null,
        userAgent: ch.userAgent ?? null,
        referrer: ch.referrer ?? null,
        url: ch.url,
        position: i + idx,
      }));
      await db.insert(channelsTable).values(batch);
    }
  }

  return c.json(fmtPlaylist(playlist!), 201);
});

// GET /playlists/:id
playlists.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = getDb(c.env.DATABASE_URL);
  const [playlist] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, id));
  if (!playlist) return c.json({ error: "Playlist not found" }, 404);
  return c.json(fmtPlaylist(playlist));
});

// DELETE /playlists/:id
playlists.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = getDb(c.env.DATABASE_URL);
  await db.delete(playlistsTable).where(eq(playlistsTable.id, id));
  return new Response(null, { status: 204 });
});

// GET /playlists/:id/channels
playlists.get("/:id/channels", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query("limit") ?? "100", 10)));
  const offset = (page - 1) * limit;
  const group = c.req.query("group");
  const search = c.req.query("search");

  const conditions = [eq(channelsTable.playlistId, id)];
  if (group) conditions.push(eq(channelsTable.groupTitle, group));
  if (search) conditions.push(ilike(channelsTable.tvgName, `%${search}%`));

  const db = getDb(c.env.DATABASE_URL);
  const [totalRow] = await db
    .select({ count: count() })
    .from(channelsTable)
    .where(and(...conditions));

  const channels = await db
    .select()
    .from(channelsTable)
    .where(and(...conditions))
    .orderBy(channelsTable.position)
    .limit(limit)
    .offset(offset);

  return c.json({ channels, total: Number(totalRow?.count ?? 0), page, limit });
});

export default playlists;
