import { Router } from "express";
import { db } from "@workspace/db";
import { playlistsTable, channelsTable } from "@workspace/db";
import { eq, ilike, and, count } from "drizzle-orm";
import { parseM3U } from "../lib/m3u-parser.js";
import { logger } from "../lib/logger.js";

const router = Router();

// GET /playlists
router.get("/playlists", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(playlistsTable)
    .orderBy(playlistsTable.createdAt);
  res.json(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      sourceType: p.sourceType,
      sourceUrl: p.sourceUrl,
      entryCount: p.entryCount,
      duplicatesFound: p.duplicatesFound,
      parseWarnings: p.parseWarnings,
      groups: p.groups,
      createdAt: p.createdAt,
    }))
  );
});

// POST /playlists
router.post("/playlists", async (req, res): Promise<void> => {
  const { name, sourceType, content, url } = req.body as {
    name?: string;
    sourceType?: string;
    content?: string;
    url?: string;
  };

  if (!name || !sourceType) {
    res.status(400).json({ error: "name and sourceType are required" });
    return;
  }
  if (!["text", "url", "file"].includes(sourceType)) {
    res.status(400).json({ error: "sourceType must be text, url, or file" });
    return;
  }

  let rawContent = "";
  let sourceUrl: string | null = null;

  if (sourceType === "text") {
    if (!content) {
      res.status(400).json({ error: "content is required for sourceType=text" });
      return;
    }
    rawContent = content;
  } else if (sourceType === "url") {
    if (!url) {
      res.status(400).json({ error: "url is required for sourceType=url" });
      return;
    }
    sourceUrl = url;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, {
        headers: { "User-Agent": "StreamGuard/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        res.status(400).json({ error: `Failed to fetch URL: HTTP ${response.status}` });
        return;
      }
      rawContent = await response.text();
    } catch (err) {
      req.log.error({ err }, "Failed to fetch playlist URL");
      res.status(400).json({ error: `Failed to fetch URL: ${(err as Error).message}` });
      return;
    }
  } else if (sourceType === "file") {
    if (!content) {
      res.status(400).json({ error: "content (base64) is required for sourceType=file" });
      return;
    }
    try {
      rawContent = Buffer.from(content, "base64").toString("utf-8");
    } catch {
      rawContent = content;
    }
  }

  const parsed = parseM3U(rawContent);
  req.log.info(
    { channelCount: parsed.channels.length, warnings: parsed.warnings.length },
    "Parsed M3U playlist"
  );

  const [playlist] = await db
    .insert(playlistsTable)
    .values({
      name,
      sourceType,
      sourceUrl,
      entryCount: parsed.channels.length,
      duplicatesFound: parsed.duplicateCount,
      parseWarnings: parsed.warnings.slice(0, 50), // cap warnings
      groups: parsed.groups,
    })
    .returning();

  if (parsed.channels.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < parsed.channels.length; i += batchSize) {
      const batch = parsed.channels.slice(i, i + batchSize).map((ch, idx) => ({
        playlistId: playlist.id,
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

  res.status(201).json({
    id: playlist.id,
    name: playlist.name,
    sourceType: playlist.sourceType,
    sourceUrl: playlist.sourceUrl,
    entryCount: playlist.entryCount,
    duplicatesFound: playlist.duplicatesFound,
    parseWarnings: playlist.parseWarnings,
    groups: playlist.groups,
    createdAt: playlist.createdAt,
  });
});

// GET /playlists/:id
router.get("/playlists/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [playlist] = await db
    .select()
    .from(playlistsTable)
    .where(eq(playlistsTable.id, id));

  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }

  res.json({
    id: playlist.id,
    name: playlist.name,
    sourceType: playlist.sourceType,
    sourceUrl: playlist.sourceUrl,
    entryCount: playlist.entryCount,
    duplicatesFound: playlist.duplicatesFound,
    parseWarnings: playlist.parseWarnings,
    groups: playlist.groups,
    createdAt: playlist.createdAt,
  });
});

// DELETE /playlists/:id
router.delete("/playlists/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(playlistsTable).where(eq(playlistsTable.id, id));
  res.status(204).send();
});

// GET /playlists/:id/channels
router.get("/playlists/:id/channels", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10)));
  const offset = (page - 1) * limit;
  const group = req.query.group as string | undefined;
  const search = req.query.search as string | undefined;

  const conditions = [eq(channelsTable.playlistId, id)];
  if (group) conditions.push(eq(channelsTable.groupTitle, group));
  if (search)
    conditions.push(ilike(channelsTable.tvgName, `%${search}%`));

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

  res.json({ channels, total: Number(totalRow?.count ?? 0), page, limit });
});

export default router;
