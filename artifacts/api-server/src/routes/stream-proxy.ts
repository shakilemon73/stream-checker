import type { Request, Response } from "express";
import { Readable } from "node:stream";

const MAX_HEADER_LENGTH = 1024;

function cleanHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[\r\n\0]/g, "").trim();
  return cleaned ? cleaned.slice(0, MAX_HEADER_LENGTH) : undefined;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host === "0.0.0.0"
  ) return true;

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}

function getTargetUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 8192) return null;
  try {
    const target = new URL(raw);
    if (!["http:", "https:"].includes(target.protocol) || isBlockedHost(target.hostname)) return null;
    return target;
  } catch {
    return null;
  }
}

function isHlsUrl(url: string, contentType?: string): boolean {
  if (/\.m3u8?(?:$|[?#])/i.test(url)) return true;
  if (contentType && /mpegurl|x-mpegurl|vnd\.apple\.mpegurl/i.test(contentType)) return true;
  return false;
}

function isDashUrl(url: string, contentType?: string): boolean {
  if (/\.mpd(?:$|[?#])/i.test(url)) return true;
  if (contentType && /dash\+xml/i.test(contentType)) return true;
  return false;
}

function toProxyUrl(request: Request, target: string, userAgent?: string, referrer?: string): string {
  const endpoint = new URL(`${request.protocol}://${request.get("host")}/api/stream-proxy`);
  endpoint.searchParams.set("url", target);
  if (userAgent) endpoint.searchParams.set("userAgent", userAgent);
  if (referrer) endpoint.searchParams.set("referrer", referrer);
  return `${endpoint.pathname}${endpoint.search}`;
}

function rewriteHlsManifest(
  manifest: string,
  baseUrl: string,
  request: Request,
  userAgent?: string,
  referrer?: string,
): string {
  const proxy = (raw: string) => {
    if (!raw || raw.startsWith("#") || raw.startsWith("data:")) return raw;
    try {
      return toProxyUrl(request, new URL(raw, baseUrl).toString(), userAgent, referrer);
    } catch {
      return raw;
    }
  };

  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Handle URI="..." attributes in tags like #EXT-X-KEY, #EXT-X-STREAM-INF, #EXT-X-MEDIA, #EXT-X-MAP, etc.
      if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${proxy(uri)}"`);
      }

      // Handle segment / playlist URLs (lines not starting with #)
      if (!trimmed.startsWith("#")) {
        return proxy(trimmed);
      }

      return line;
    })
    .join("\n");
}

function rewriteDashManifest(
  manifest: string,
  baseUrl: string,
  request: Request,
  userAgent?: string,
  referrer?: string,
): string {
  const proxy = (raw: string) => {
    if (!raw || raw.startsWith("data:")) return raw;
    try {
      return toProxyUrl(request, new URL(raw, baseUrl).toString(), userAgent, referrer);
    } catch {
      return raw;
    }
  };

  // Rewrite <BaseURL> tags
  let result = manifest.replace(/<BaseURL>([^<]+)<\/BaseURL>/gi, (_match, url: string) => {
    return `<BaseURL>${proxy(url.trim())}</BaseURL>`;
  });

  // Rewrite media="..." or initialization="..." in SegmentTemplate if absolute or relative
  result = result.replace(/initialization="([^"]+)"/gi, (_match, uri: string) => {
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      return `initialization="${proxy(uri)}"`;
    }
    return _match;
  });

  return result;
}

export async function streamProxy(req: Request, res: Response): Promise<void> {
  // CORS Headers for preflight & all responses
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  });

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const target = getTargetUrl(req.query.url);
  if (!target) {
    res.status(400).json({ error: "A valid public http(s) stream URL is required" });
    return;
  }

  const userAgent = cleanHeader(typeof req.query.userAgent === "string" ? req.query.userAgent : undefined);
  const referrer = cleanHeader(typeof req.query.referrer === "string" ? req.query.referrer : undefined);
  
  const headers: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  };

  if (typeof req.headers.range === "string") {
    headers.Range = req.headers.range;
  }
  if (referrer?.startsWith("http://") || referrer?.startsWith("https://")) {
    headers.Referer = referrer;
    headers.Origin = new URL(referrer).origin;
  } else {
    // Default origin to stream host origin to satisfy strict hotlink protections
    headers.Origin = target.origin;
    headers.Referer = target.origin + "/";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const upstream = await fetch(target, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 206) {
      const errText = await upstream.text().catch(() => "");
      const isGeoblocked = [401, 403, 418, 429, 451, 502, 503].includes(upstream.status);
      
      res.set({
        "X-Stream-Proxy-Status": String(upstream.status),
        "X-Stream-Proxy-Error": isGeoblocked
          ? `Anti-Bot / Origin Restricted (HTTP ${upstream.status})`
          : `Upstream HTTP ${upstream.status}`,
      });

      res.status(upstream.status).type("text/plain").send(
        errText || `Upstream HTTP ${upstream.status}: ${isGeoblocked ? "Origin Anti-Bot / Access Restricted on Cloud Proxy" : "Stream fetch failed"}`
      );
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const isHls = isHlsUrl(target.toString(), contentType);
    const isDash = isDashUrl(target.toString(), contentType);

    // Rewrite HLS Manifests
    if (isHls) {
      const manifest = await upstream.text();
      res.status(200).set({
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Type": contentType || "application/vnd.apple.mpegurl",
      }).send(rewriteHlsManifest(manifest, upstream.url || target.toString(), req, userAgent, referrer));
      return;
    }

    // Rewrite DASH Manifests
    if (isDash) {
      const manifest = await upstream.text();
      res.status(200).set({
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Type": contentType || "application/dash+xml",
      }).send(rewriteDashManifest(manifest, upstream.url || target.toString(), req, userAgent, referrer));
      return;
    }

    // Pass video chunks / TS segments / direct video streams
    res.status(upstream.status);
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": contentType || "application/octet-stream",
    });

    if (upstream.headers.get("content-length")) {
      res.set("Content-Length", upstream.headers.get("content-length")!);
    }
    if (upstream.headers.get("accept-ranges")) {
      res.set("Accept-Ranges", upstream.headers.get("accept-ranges")!);
    }
    if (upstream.headers.get("content-range")) {
      res.set("Content-Range", upstream.headers.get("content-range")!);
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    // Stream directly to client
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
  } catch (error) {
    clearTimeout(timeout);
    if (!res.headersSent) {
      const message = error instanceof Error && error.name === "AbortError" 
        ? "Stream connection timed out" 
        : "Failed to establish stream relay";
      res.status(504).json({ error: message, details: (error as Error).message });
    }
  }
}
