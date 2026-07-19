import { setTimeout as delay } from "timers/promises";

export interface CheckOptions {
  timeoutMs: number;
  retryCount: number;
  userAgent: string;
}

export interface CheckResult {
  status: "live" | "dead" | "geoblocked" | "suspicious";
  httpStatus?: number;
  responseTimeMs: number;
  redirectCount?: number;
  tlsValid?: boolean;
  mimeType?: string;
  manifestValid?: boolean;
  failureReason?: string;
}

// Comprehensive UA pool — rotated per attempt so each retry looks like a different client
export const USER_AGENTS = [
  "VLC/3.0.20 LibVLC/3.0.20",
  "Lavf/58.76.100",
  "AppleCoreMedia/1.0.0.20G1020 (Apple TV; U; CPU OS 16_0 like Mac OS X; en_us)",
  "Kodi/19.4 (Windows NT 10.0; WOW64) App_Bitness/32 Version/19.4-Git:20210928-0919e28b2a",
  "ExoPlayerLib/2.19.1 (Linux; Android 13; Pixel 7)",
  "okhttp/4.11.0",
  "stagefright/1.2 (Linux;Android 13)",
  "Mozilla/5.0 (SmartTV; Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
  "TiVo/1.0 YahooTV/1.0",
  "Dalvik/2.1.0 (Linux; U; Android 12; SM-G990B Build/SP1A.210812.016)",
];

export function pickUserAgent(index: number): string {
  return USER_AGENTS[index % USER_AGENTS.length];
}

// TS packet sync byte — if first byte is 0x47, it's a valid MPEG-TS stream
const TS_SYNC = 0x47;

// MIME types that confirm a live stream
const STREAM_MIME_RE =
  /mpegurl|mp2t|mpegvideo|mpeg|video|audio|octet-stream|x-flv|x-matroska|webm|ogg/i;

// MIME types that indicate an error page in disguise
const ERROR_MIME_RE = /text\/html|application\/xhtml|text\/xml/i;

export async function checkStream(
  originalUrl: string,
  opts: CheckOptions
): Promise<CheckResult> {
  const start = Date.now();
  let lastError = "";
  let url = originalUrl;

  for (let attempt = 0; attempt <= Math.max(opts.retryCount, 2); attempt++) {
    if (attempt > 0) {
      await delay(Math.min(600 * attempt, 3000));
    }

    // Rotate UA on each attempt
    const ua = USER_AGENTS[(USER_AGENTS.indexOf(opts.userAgent) + attempt) % USER_AGENTS.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const isHttps = url.startsWith("https://");
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": ua,
          Accept: "*/*",
          Connection: "keep-alive",
          "Icy-MetaData": "1", // Shoutcast/Icecast
          "Accept-Encoding": "identity", // avoid compressed body surprises
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      const elapsed = Date.now() - start;
      const ct = (response.headers.get("content-type") || "").toLowerCase();
      const urlPath = url.toLowerCase().split("?")[0];
      const isHls =
        ct.includes("mpegurl") ||
        urlPath.endsWith(".m3u8") ||
        urlPath.endsWith(".m3u");

      // ── Status classification ─────────────────────────────────────────────

      // Hard dead: definitively missing
      if (
        response.status === 404 ||
        response.status === 410 ||
        response.status === 400
      ) {
        void drainBody(response);
        return {
          status: "dead",
          httpStatus: response.status,
          responseTimeMs: elapsed,
          failureReason: `HTTP ${response.status}`,
        };
      }

      // Auth-gated — could be live but locked, not dead
      if (response.status === 401) {
        void drainBody(response);
        return {
          status: "suspicious",
          httpStatus: 401,
          responseTimeMs: elapsed,
          failureReason: "Authentication required (401)",
        };
      }

      // Geoblock indicators
      if (response.status === 403 || response.status === 451) {
        void drainBody(response);
        return {
          status: "geoblocked",
          httpStatus: response.status,
          responseTimeMs: elapsed,
          redirectCount: response.redirected ? 1 : 0,
        };
      }

      // Transient server errors — retry aggressively, don't mark dead
      if (
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504
      ) {
        void drainBody(response);
        lastError = `HTTP ${response.status} (transient, retrying)`;
        continue;
      }

      // Other 4xx — retry once, then suspicious (not dead — could be token-protected)
      if (response.status >= 400) {
        void drainBody(response);
        if (attempt < opts.retryCount) {
          lastError = `HTTP ${response.status}`;
          continue;
        }
        return {
          status: "suspicious",
          httpStatus: response.status,
          responseTimeMs: elapsed,
          failureReason: `HTTP ${response.status}`,
        };
      }

      // ── 2xx / 206 — response arrived, now validate content ────────────────

      if (isHls) {
        return await checkHlsManifest(response, url, elapsed, ct, isHttps);
      }

      // For direct streams: detect HTML error pages masquerading as streams
      if (ERROR_MIME_RE.test(ct)) {
        // Server returned HTML — almost certainly an error page
        const snippet = await readFirstBytes(response, 256);
        const text = snippet.toLowerCase();
        if (
          text.includes("<html") ||
          text.includes("<!doctype") ||
          text.includes("error") ||
          text.includes("not found") ||
          text.includes("access denied")
        ) {
          return {
            status: "dead",
            httpStatus: response.status,
            responseTimeMs: elapsed,
            mimeType: ct.split(";")[0].trim(),
            failureReason: "Server returned HTML error page",
          };
        }
        // Might still be a text-based stream
        void drainBody(response);
        return {
          status: "suspicious",
          httpStatus: response.status,
          responseTimeMs: elapsed,
          mimeType: ct.split(";")[0].trim(),
          failureReason: "Unexpected HTML content type",
        };
      }

      // For MPEG-TS: validate sync byte in first packet
      if (
        urlPath.endsWith(".ts") ||
        urlPath.endsWith(".mpg") ||
        urlPath.endsWith(".mpeg") ||
        ct.includes("mp2t") ||
        ct.includes("mpeg")
      ) {
        const firstByte = await readFirstByte(response);
        if (firstByte !== null && firstByte !== TS_SYNC) {
          return {
            status: "suspicious",
            httpStatus: response.status,
            responseTimeMs: elapsed,
            mimeType: ct.split(";")[0].trim(),
            manifestValid: false,
            failureReason: `Invalid TS sync byte (0x${firstByte.toString(16).padStart(2, "0")}, expected 0x47)`,
          };
        }
        void drainBody(response);
        return {
          status: "live",
          httpStatus: response.status,
          responseTimeMs: elapsed,
          redirectCount: response.redirected ? 1 : 0,
          tlsValid: isHttps,
          mimeType: ct.split(";")[0].trim() || "video/mp2t",
          manifestValid: true,
        };
      }

      // All other content types — trust the status code
      void drainBody(response);
      return {
        status: "live",
        httpStatus: response.status,
        responseTimeMs: elapsed,
        redirectCount: response.redirected ? 1 : 0,
        tlsValid: isHttps,
        mimeType: ct.split(";")[0].trim() || undefined,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("abort") || msg.includes("TimeoutError") || msg.toLowerCase().includes("timeout")) {
        lastError = `Connection timed out after ${opts.timeoutMs}ms`;
        // Timeout may mean slow-starting CDN — keep retrying with longer windows
      } else if (msg.includes("ECONNREFUSED")) {
        lastError = "Connection refused";
        // Definitive — server is not listening
        break;
      } else if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
        lastError = "DNS resolution failed";
        break;
      } else if (
        msg.includes("ECONNRESET") ||
        msg.includes("EPIPE") ||
        msg.includes("socket hang up")
      ) {
        lastError = "Connection reset by server";
        // May be rate-limiting — retry
      } else if (
        msg.includes("certificate") ||
        msg.includes("self-signed") ||
        msg.includes("CERT_") ||
        msg.includes("SSL") ||
        (msg.includes("TLS") && !msg.includes("ETIMEDOUT"))
      ) {
        // TLS error: fall back to plain HTTP and retry immediately
        if (url.startsWith("https://")) {
          url = url.replace("https://", "http://");
          lastError = `TLS error — retrying over HTTP`;
          // Don't count this as a real attempt
          attempt--;
          continue;
        }
        lastError = `TLS error: ${msg.substring(0, 80)}`;
        break;
      } else {
        lastError = msg.substring(0, 120);
      }
    }
  }

  return {
    status: "dead",
    responseTimeMs: Date.now() - start,
    failureReason: lastError || "All attempts failed",
  };
}

// ── HLS manifest checker ──────────────────────────────────────────────────────
// Reads the manifest from the FIRST response body (no second request)
async function checkHlsManifest(
  response: Response,
  url: string,
  elapsed: number,
  ct: string,
  isHttps: boolean
): Promise<CheckResult> {
  const mime = ct.split(";")[0].trim() || "application/vnd.apple.mpegurl";

  try {
    // Read body with a hard cap — manifests are small
    const text = await Promise.race([
      response.text(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("manifest body timeout")), 4000)
      ),
    ]);

    // HTML error page check
    if (text.includes("<html") || text.includes("<!DOCTYPE") || text.includes("<!doctype")) {
      return {
        status: "dead",
        httpStatus: response.status,
        responseTimeMs: elapsed,
        mimeType: mime,
        manifestValid: false,
        failureReason: "Server returned HTML error page",
      };
    }

    // Must contain HLS tags
    if (!text.includes("#EXT") || text.length < 25) {
      return {
        status: "suspicious",
        httpStatus: response.status,
        responseTimeMs: elapsed,
        mimeType: mime,
        manifestValid: false,
        failureReason: "Empty or malformed HLS manifest",
      };
    }

    // Check if it's a master playlist or a media playlist
    const isMaster = text.includes("#EXT-X-STREAM-INF");
    const isMedia = text.includes("#EXTINF") || text.includes("#EXT-X-TARGETDURATION");
    const hasEndList = text.includes("#EXT-X-ENDLIST");

    // A live stream media playlist should NOT have #EXT-X-ENDLIST
    // A master playlist is always valid
    if (!isMaster && !isMedia) {
      return {
        status: "suspicious",
        httpStatus: response.status,
        responseTimeMs: elapsed,
        mimeType: mime,
        manifestValid: false,
        failureReason: "Manifest has no stream info tags",
      };
    }

    // Count segments — fewer than 1 is suspicious for live
    const segmentCount = (text.match(/#EXTINF/g) || []).length;
    if (isMedia && !isMaster && segmentCount === 0 && !hasEndList) {
      return {
        status: "suspicious",
        httpStatus: response.status,
        responseTimeMs: elapsed,
        mimeType: mime,
        manifestValid: false,
        failureReason: "HLS media playlist has no segments",
      };
    }

    return {
      status: "live",
      httpStatus: response.status,
      responseTimeMs: elapsed,
      redirectCount: response.redirected ? 1 : 0,
      tlsValid: isHttps,
      mimeType: mime,
      manifestValid: true,
    };
  } catch {
    // If body read times out, we still got headers — optimistically mark live
    // (live streams deliver headers instantly; body never ends for continuous feeds)
    void drainBody(response);
    return {
      status: "live",
      httpStatus: response.status,
      responseTimeMs: elapsed,
      redirectCount: response.redirected ? 1 : 0,
      tlsValid: isHttps,
      mimeType: mime,
      manifestValid: undefined,
    };
  }
}

// Read first N bytes without consuming the full body
async function readFirstBytes(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  try {
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    if (!value) return "";
    return new TextDecoder().decode(value.slice(0, maxBytes));
  } catch {
    reader.cancel().catch(() => {});
    return "";
  }
}

async function readFirstByte(response: Response): Promise<number | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  try {
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    return value?.[0] ?? null;
  } catch {
    reader.cancel().catch(() => {});
    return null;
  }
}

// Drain body to release the socket (fire-and-forget)
function drainBody(response: Response): Promise<void> {
  return response.body?.cancel().catch(() => {}) ?? Promise.resolve();
}
