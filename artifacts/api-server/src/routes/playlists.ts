import { Router } from "express";
import { db } from "@workspace/db";
import { playlistsTable, channelsTable, appSettingsTable } from "@workspace/db";
import { eq, ilike, and, count, desc, inArray, sql } from "drizzle-orm";
import { parseM3U } from "../lib/m3u-parser.js";
import { generateM3UString, pushPlaylistToGitHub } from "../lib/github-sync.js";
import { logger } from "../lib/logger.js";

const router = Router();

// GET /playlists
router.get("/playlists", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(playlistsTable)
    .orderBy(desc(playlistsTable.createdAt));
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
      githubRepo: p.githubRepo,
      githubBranch: p.githubBranch,
      githubPath: p.githubPath,
      autoPushGithub: p.autoPushGithub,
      lastPushedAt: p.lastPushedAt,
      createdAt: p.createdAt,
    }))
  );
});

// POST /playlists
router.post("/playlists", async (req, res): Promise<void> => {
  const { name, sourceType, content, url, githubRepo, githubBranch, githubPath, autoPushGithub } = req.body as {
    name?: string;
    sourceType?: string;
    content?: string;
    url?: string;
    githubRepo?: string;
    githubBranch?: string;
    githubPath?: string;
    autoPushGithub?: boolean;
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
        headers: { "User-Agent": "StreamGuard/2.0" },
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
      parseWarnings: parsed.warnings.slice(0, 50),
      groups: parsed.groups,
      githubRepo: githubRepo ?? null,
      githubBranch: githubBranch ?? null,
      githubPath: githubPath ?? null,
      autoPushGithub: autoPushGithub ?? false,
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
    githubRepo: playlist.githubRepo,
    githubBranch: playlist.githubBranch,
    githubPath: playlist.githubPath,
    autoPushGithub: playlist.autoPushGithub,
    lastPushedAt: playlist.lastPushedAt,
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
    githubRepo: playlist.githubRepo,
    githubBranch: playlist.githubBranch,
    githubPath: playlist.githubPath,
    autoPushGithub: playlist.autoPushGithub,
    lastPushedAt: playlist.lastPushedAt,
    createdAt: playlist.createdAt,
  });
});

// PUT /playlists/:id - Update playlist metadata / GitHub config
router.put("/playlists/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as {
    name?: string;
    githubRepo?: string | null;
    githubBranch?: string | null;
    githubPath?: string | null;
    autoPushGithub?: boolean | null;
  };

  const updates: Partial<typeof playlistsTable.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.githubRepo !== undefined) updates.githubRepo = body.githubRepo ? body.githubRepo.trim() : null;
  if (body.githubBranch !== undefined) updates.githubBranch = body.githubBranch ? body.githubBranch.trim() : null;
  if (body.githubPath !== undefined) updates.githubPath = body.githubPath ? body.githubPath.trim() : null;
  if (body.autoPushGithub !== undefined) updates.autoPushGithub = !!body.autoPushGithub;

  const [updated] = await db
    .update(playlistsTable)
    .set(updates)
    .where(eq(playlistsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Playlist not found" }); return; }
  res.json(updated);
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
  if (group && group !== "all") conditions.push(eq(channelsTable.groupTitle, group));
  if (search) {
    conditions.push(
      sql`(${channelsTable.tvgName} ILIKE ${`%${search}%`} OR ${channelsTable.url} ILIKE ${`%${search}%`} OR ${channelsTable.groupTitle} ILIKE ${`%${search}%`})`
    );
  }

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

// POST /playlists/:id/channels - Add new channel
router.post("/playlists/:id/channels", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const playlistId = parseInt(raw, 10);
  if (isNaN(playlistId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { tvgName, tvgLogo, url, groupTitle, userAgent, referrer, tvgId, language, country } = req.body as {
    tvgName?: string;
    tvgLogo?: string;
    url?: string;
    groupTitle?: string;
    userAgent?: string;
    referrer?: string;
    tvgId?: string;
    language?: string;
    country?: string;
  };

  if (!url || !url.trim()) {
    res.status(400).json({ error: "Stream URL is required" });
    return;
  }

  // Get current max position
  const [maxPos] = await db
    .select({ max: sql<number>`MAX(${channelsTable.position})` })
    .from(channelsTable)
    .where(eq(channelsTable.playlistId, playlistId));

  const nextPos = (maxPos?.max ?? 0) + 1;

  const [channel] = await db
    .insert(channelsTable)
    .values({
      playlistId,
      tvgName: tvgName?.trim() || "New Channel",
      tvgLogo: tvgLogo?.trim() || null,
      url: url.trim(),
      groupTitle: groupTitle?.trim() || "General",
      userAgent: userAgent?.trim() || null,
      referrer: referrer?.trim() || null,
      tvgId: tvgId?.trim() || null,
      language: language?.trim() || null,
      country: country?.trim() || null,
      position: nextPos,
    })
    .returning();

  // Update playlist count and groups
  await refreshPlaylistStats(playlistId);

  res.status(201).json(channel);
});

// PUT /playlists/:id/channels/:channelId - Edit channel
router.put("/playlists/:id/channels/:channelId", async (req, res): Promise<void> => {
  const playlistId = parseInt(String(req.params.id), 10);
  const channelId = parseInt(String(req.params.channelId), 10);
  if (isNaN(playlistId) || isNaN(channelId)) {
    res.status(400).json({ error: "Invalid playlist or channel ID" });
    return;
  }

  const { tvgName, tvgLogo, url, groupTitle, userAgent, referrer, tvgId, language, country, position } = req.body as {
    tvgName?: string;
    tvgLogo?: string | null;
    url?: string;
    groupTitle?: string | null;
    userAgent?: string | null;
    referrer?: string | null;
    tvgId?: string | null;
    language?: string | null;
    country?: string | null;
    position?: number;
  };

  const updates: Partial<typeof channelsTable.$inferInsert> = {};
  if (tvgName !== undefined) updates.tvgName = tvgName ? tvgName.trim() : "Channel";
  if (tvgLogo !== undefined) updates.tvgLogo = tvgLogo ? tvgLogo.trim() : null;
  if (url !== undefined) {
    if (!url.trim()) {
      res.status(400).json({ error: "Stream URL cannot be empty" });
      return;
    }
    updates.url = url.trim();
  }
  if (groupTitle !== undefined) updates.groupTitle = groupTitle ? groupTitle.trim() : null;
  if (userAgent !== undefined) updates.userAgent = userAgent ? userAgent.trim() : null;
  if (referrer !== undefined) updates.referrer = referrer ? referrer.trim() : null;
  if (tvgId !== undefined) updates.tvgId = tvgId ? tvgId.trim() : null;
  if (language !== undefined) updates.language = language ? language.trim() : null;
  if (country !== undefined) updates.country = country ? country.trim() : null;
  if (position !== undefined) updates.position = position;

  const [updated] = await db
    .update(channelsTable)
    .set(updates)
    .where(and(eq(channelsTable.id, channelId), eq(channelsTable.playlistId, playlistId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  await refreshPlaylistStats(playlistId);
  res.json(updated);
});

// DELETE /playlists/:id/channels/:channelId - Delete channel
router.delete("/playlists/:id/channels/:channelId", async (req, res): Promise<void> => {
  const playlistId = parseInt(String(req.params.id), 10);
  const channelId = parseInt(String(req.params.channelId), 10);
  if (isNaN(playlistId) || isNaN(channelId)) {
    res.status(400).json({ error: "Invalid playlist or channel ID" });
    return;
  }

  await db
    .delete(channelsTable)
    .where(and(eq(channelsTable.id, channelId), eq(channelsTable.playlistId, playlistId)));

  await refreshPlaylistStats(playlistId);
  res.status(204).send();
});

// POST /playlists/:id/channels/bulk-delete - Delete multiple channels
router.post("/playlists/:id/channels/bulk-delete", async (req, res): Promise<void> => {
  const playlistId = parseInt(String(req.params.id), 10);
  if (isNaN(playlistId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { channelIds } = req.body as { channelIds?: number[] };
  if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
    res.status(400).json({ error: "channelIds array is required" });
    return;
  }

  await db
    .delete(channelsTable)
    .where(and(eq(channelsTable.playlistId, playlistId), inArray(channelsTable.id, channelIds)));

  await refreshPlaylistStats(playlistId);
  res.json({ success: true, deletedCount: channelIds.length });
});

// POST /playlists/:id/channels/bulk-update - Bulk update category or user-agent
router.post("/playlists/:id/channels/bulk-update", async (req, res): Promise<void> => {
  const playlistId = parseInt(String(req.params.id), 10);
  if (isNaN(playlistId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { channelIds, groupTitle, userAgent, referrer } = req.body as {
    channelIds?: number[];
    groupTitle?: string;
    userAgent?: string;
    referrer?: string;
  };

  if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
    res.status(400).json({ error: "channelIds array is required" });
    return;
  }

  const updates: Partial<typeof channelsTable.$inferInsert> = {};
  if (groupTitle !== undefined) updates.groupTitle = groupTitle.trim() || null;
  if (userAgent !== undefined) updates.userAgent = userAgent.trim() || null;
  if (referrer !== undefined) updates.referrer = referrer.trim() || null;

  if (Object.keys(updates).length > 0) {
    await db
      .update(channelsTable)
      .set(updates)
      .where(and(eq(channelsTable.playlistId, playlistId), inArray(channelsTable.id, channelIds)));
  }

  await refreshPlaylistStats(playlistId);
  res.json({ success: true, updatedCount: channelIds.length });
});

// GET /playlists/:id/export - Generate M3U file
router.get("/playlists/:id/export", async (req, res): Promise<void> => {
  const playlistId = parseInt(String(req.params.id), 10);
  if (isNaN(playlistId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [playlist] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, playlistId));
  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }

  const group = req.query.group as string | undefined;
  const search = req.query.search as string | undefined;
  const idsParam = req.query.channelIds as string | undefined;

  const conditions = [eq(channelsTable.playlistId, playlistId)];

  if (idsParam) {
    const ids = idsParam.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    if (ids.length > 0) {
      conditions.push(inArray(channelsTable.id, ids));
    }
  }
  if (group && group !== "all") {
    conditions.push(eq(channelsTable.groupTitle, group));
  }
  if (search?.trim()) {
    const term = search.trim();
    conditions.push(
      sql`(${channelsTable.tvgName} ILIKE ${`%${term}%`} OR ${channelsTable.url} ILIKE ${`%${term}%`} OR ${channelsTable.groupTitle} ILIKE ${`%${term}%`})`
    );
  }

  const channels = await db
    .select()
    .from(channelsTable)
    .where(and(...conditions))
    .orderBy(channelsTable.position);

  const m3uContent = generateM3UString(channels, playlist.name);
  const suffix = idsParam ? "_selected" : (group || search ? "_filtered" : "");
  const filename = `${playlist.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}${suffix}.m3u8`;

  res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(m3uContent);
});

// POST /playlists/:id/github-push - Push playlist to GitHub
router.post("/playlists/:id/github-push", async (req, res): Promise<void> => {
  const playlistId = parseInt(String(req.params.id), 10);
  if (isNaN(playlistId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [playlist] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, playlistId));
  if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }

  const body = req.body as {
    token?: string;
    owner?: string;
    repo?: string;
    branch?: string;
    path?: string;
    message?: string;
  };

  // Check if settings or payload provides credentials
  const [globalSettings] = await db.select().from(appSettingsTable).limit(1);

  const token = body.token || globalSettings?.githubToken;
  const owner = body.owner || globalSettings?.githubOwner;
  const repo = body.repo || playlist.githubRepo || globalSettings?.githubRepo;
  const branch = body.branch || playlist.githubBranch || globalSettings?.githubBranch || "main";
  const defaultPath = playlist.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_") + ".m3u8";
  const path = body.path || playlist.githubPath || globalSettings?.githubPath || defaultPath;

  if (!token) {
    res.status(400).json({ error: "GitHub Personal Access Token is required. Configure it in Settings or pass 'token'." });
    return;
  }
  if (!owner || !repo) {
    res.status(400).json({ error: "GitHub Owner and Repo are required." });
    return;
  }

  const channels = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.playlistId, playlistId))
    .orderBy(channelsTable.position);

  const m3uContent = generateM3UString(channels, playlist.name);

  const result = await pushPlaylistToGitHub({
    token,
    owner,
    repo,
    branch,
    path,
    content: m3uContent,
    message: body.message || `Update ${playlist.name} M3U via StreamGuard (${channels.length} channels)`,
  });

  if (!result.success) {
    res.status(400).json({ error: result.error || "GitHub push failed" });
    return;
  }

  const now = new Date().toISOString();
  // Update playlist GitHub record
  await db
    .update(playlistsTable)
    .set({
      githubRepo: repo,
      githubBranch: branch,
      githubPath: path,
      lastPushedAt: now,
    })
    .where(eq(playlistsTable.id, playlistId));

  if (globalSettings) {
    await db
      .update(appSettingsTable)
      .set({
        githubLastPushAt: now,
        githubLastPushStatus: "success",
      })
      .where(eq(appSettingsTable.id, globalSettings.id));
  }

  res.json({
    success: true,
    commitSha: result.commitSha,
    commitUrl: result.commitUrl,
    fileUrl: result.fileUrl,
    message: result.message,
    lastPushedAt: now,
  });
});

async function refreshPlaylistStats(playlistId: number): Promise<void> {
  const channels = await db
    .select({ groupTitle: channelsTable.groupTitle })
    .from(channelsTable)
    .where(eq(channelsTable.playlistId, playlistId));

  const groupsSet = new Set<string>();
  for (const ch of channels) {
    if (ch.groupTitle?.trim()) groupsSet.add(ch.groupTitle.trim());
  }

  await db
    .update(playlistsTable)
    .set({
      entryCount: channels.length,
      groups: Array.from(groupsSet),
    })
    .where(eq(playlistsTable.id, playlistId));
}

export default router;
