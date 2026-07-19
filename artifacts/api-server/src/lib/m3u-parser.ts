export interface M3UChannel {
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  language?: string;
  country?: string;
  userAgent?: string;
  referrer?: string;
  url: string;
  duration?: number;
}

export interface ParseResult {
  channels: M3UChannel[];
  warnings: string[];
  duplicateCount: number;
  groups: string[];
}

export function parseM3U(content: string): ParseResult {
  // Strip BOM
  const text = content.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const channels: M3UChannel[] = [];
  const warnings: string[] = [];
  const seenUrls = new Set<string>();
  const groups = new Set<string>();
  let duplicateCount = 0;
  let pending: Partial<M3UChannel> | null = null;
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (lineNum === 1 && !trimmed.startsWith("#EXTM3U")) {
      warnings.push(`Line 1: Missing #EXTM3U header, attempting to parse anyway`);
    }

    if (trimmed.startsWith("#EXTINF:")) {
      const match = trimmed.match(/^#EXTINF:(-?\d+(?:\.\d+)?)\s*,?\s*(.*)$/);
      if (!match) {
        warnings.push(`Line ${lineNum}: Malformed #EXTINF, skipping`);
        continue;
      }
      pending = { duration: parseFloat(match[1]) };
      const attrStr = match[2];

      const attrRx = /([\w-]+)\s*=\s*"([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = attrRx.exec(attrStr)) !== null) {
        const k = m[1].toLowerCase();
        const v = m[2];
        switch (k) {
          case "tvg-id":
            pending.tvgId = v;
            break;
          case "tvg-name":
            pending.tvgName = v;
            break;
          case "tvg-logo":
            pending.tvgLogo = v;
            break;
          case "group-title":
            pending.groupTitle = v;
            if (v) groups.add(v);
            break;
          case "tvg-language":
            pending.language = v;
            break;
          case "tvg-country":
            pending.country = v;
            break;
        }
      }

      // Display name after last comma
      const ci = attrStr.lastIndexOf(",");
      if (ci >= 0) {
        const displayName = attrStr.substring(ci + 1).trim();
        if (displayName && !pending.tvgName) pending.tvgName = displayName;
      } else if (!pending.tvgName) {
        const stripped = attrStr.replace(/([\w-]+=\s*"[^"]*"\s*)/g, "").trim();
        if (stripped) pending.tvgName = stripped;
      }
    } else if (trimmed.startsWith("#EXTVLCOPT:")) {
      if (pending) {
        const val = trimmed.substring("#EXTVLCOPT:".length);
        if (val.startsWith("http-user-agent="))
          pending.userAgent = val.substring(16);
        else if (val.startsWith("http-referrer="))
          pending.referrer = val.substring(14);
      }
    } else if (trimmed.startsWith("#EXTGRP:")) {
      if (pending) {
        const g = trimmed.substring("#EXTGRP:".length).trim();
        pending.groupTitle = g;
        if (g) groups.add(g);
      }
    } else if (!trimmed.startsWith("#")) {
      const url = trimmed;
      if (!url) continue;

      if (seenUrls.has(url)) {
        duplicateCount++;
      } else {
        seenUrls.add(url);
        const ch: M3UChannel = { url, ...pending };
        // Auto-detect category from name if group is missing
        if (!ch.groupTitle && ch.tvgName) {
          const detected = detectCategory(ch.tvgName);
          if (detected) {
            ch.groupTitle = detected;
            groups.add(detected);
          }
        }
        channels.push(ch);
      }
      pending = null;
    }
  }

  return { channels, warnings, duplicateCount, groups: Array.from(groups).sort() };
}

function detectCategory(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/news|noticias|nachrichten|nouvelles|breaking/.test(n)) return "News";
  if (/sport|sports|futbol|football|soccer|nfl|nba|mlb|cricket|tennis|golf/.test(n))
    return "Sports";
  if (/movie|film|cinema|kino|cine|flix/.test(n)) return "Movies";
  if (/kids|child|junior|cartoon|toon|anime|disney/.test(n)) return "Kids";
  if (/music|musik|musique|radio|hits|pop|rock/.test(n)) return "Music";
  if (/docu|documentary|national\s*geo|discovery/.test(n)) return "Documentary";
  if (/comedy|humor|fun/.test(n)) return "Entertainment";
  return undefined;
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    ["token", "pass", "password", "user", "username", "key", "apikey", "auth"].forEach((p) => {
      if (u.searchParams.has(p)) u.searchParams.set(p, "[REDACTED]");
    });
    return u.toString();
  } catch {
    return "[invalid-url]";
  }
}
