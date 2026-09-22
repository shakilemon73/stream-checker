import { Hono } from "hono";
import type { Env } from "../types.js";

const MAX_HEADER_LENGTH = 512;
const streamProxy = new Hono<{ Bindings: Env }>();

function cleanHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[\r\n\0]/g, "").trim();
  return cleaned ? cleaned.slice(0, MAX_HEADER_LENGTH) : undefined;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a = 0, b = 0] = octets;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function getTargetUrl(raw: string | undefined): URL | null {
  if (!raw || raw.length > 8192) return null;
  try {
    const target = new URL(raw);
    if (!["http:", "https:"].includes(target.protocol) || isBlockedHost(target.hostname)) return null;
    return target;
  } catch {
    return null;
  }
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8?(?:$|[?#])/i.test(url);
}

function toProxyUrl(requestUrl: string, target: string, userAgent?: string, referrer?: string): string {
  const endpoint = new URL("/stream-proxy", requestUrl);
  endpoint.search = "";
  endpoint.searchParams.set("url", target);
  if (userAgent) endpoint.searchParams.set("userAgent", userAgent);
  if (referrer) endpoint.searchParams.set("referrer", referrer);
  return `${endpoint.pathname}${endpoint.search}`;
}

function rewriteManifest(manifest: string, baseUrl: string, requestUrl: string, userAgent?: string, referrer?: string): string {
  const proxy = (raw: string) => {
    if (!raw || raw.startsWith("#") || raw.startsWith("data:")) return raw;
    try {
      return toProxyUrl(requestUrl, new URL(raw, baseUrl).toString(), userAgent, referrer);
    } catch {
      return raw;
    }
  };
  return manifest.split(/\r?\n/).map((line) => {
    if (line.includes('URI="')) return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${proxy(uri)}"`);
    return line.trim() && !line.trimStart().startsWith("#") ? proxy(line.trim()) : line;
  }).join("\n");
}

streamProxy.get("/", async (c) => {
  const target = getTargetUrl(c.req.query("url"));
  if (!target) return c.json({ error: "A valid public http(s) stream URL is required" }, 400);

  const userAgent = cleanHeader(c.req.query("userAgent"));
  const referrer = cleanHeader(c.req.query("referrer"));
  const headers = new Headers({
    Accept: "*/*",
    "Accept-Encoding": "identity",
    "User-Agent": userAgent ?? "StreamGuardPlayer/1.0",
  });
  const range = c.req.header("Range");
  if (range) headers.set("Range", range);
  if (referrer?.startsWith("http://") || referrer?.startsWith("https://")) headers.set("Referer", referrer);

  const upstream = await fetch(target.toString(), { headers, redirect: "follow" });
  const contentType = upstream.headers.get("content-type") ?? "";
  if (isHlsUrl(target.toString()) || /mpegurl|x-mpegurl/i.test(contentType)) {
    const manifest = await upstream.text();
    if (!upstream.ok) return new Response(manifest, { status: upstream.status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    return new Response(rewriteManifest(manifest, upstream.url || target.toString(), c.req.url, userAgent, referrer), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": contentType || "application/vnd.apple.mpegurl",
      },
    });
  }

  const responseHeaders = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": contentType || "application/octet-stream",
  });
  for (const name of ["content-length", "accept-ranges", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
});

export default streamProxy;