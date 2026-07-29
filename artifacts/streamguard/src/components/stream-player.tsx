/**
 * StreamPlayer — plays live IPTV/streaming URLs directly in the browser.
 *
 * Format support matrix:
 *   HLS  (.m3u8 / application/x-mpegurl)   → hls.js (all browsers)
 *   HLS  (Safari)                           → native <video>
 *   MP4 / WebM / OGG                        → native <video>
 *   MPEG-TS (.ts) / FLV / RTSP / RTMP      → VLC deep-link (browser can't decode raw transport streams)
 *   Unknown http(s) with no extension       → optimistic HLS attempt, fallback to VLC link
 */

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { cn } from "@/lib/utils";
import {
  Loader2, AlertTriangle, Play, Volume2, VolumeX, ExternalLink, Tv2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Format detection ─────────────────────────────────────────────────────────

type StreamFormat = "hls" | "native" | "vlc-only" | "unknown-http";

interface FormatInfo {
  type: StreamFormat;
  label: string;
  reason: string;
}

function detectFormat(url: string, mimeType?: string | null): FormatInfo {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  const mime  = (mimeType ?? "").toLowerCase();

  // Protocols that browsers cannot handle at all
  if (/^(rtsp|rtsps|rtmp|rtmps|mms|mmsh|udp|rtp):\/\//i.test(url))
    return { type: "vlc-only", label: url.split("://")[0]!.toUpperCase(), reason: "protocol" };

  // Raw transport streams / FLV — need a native player
  if (lower.endsWith(".ts") || lower.endsWith(".flv") || mime.includes("mp2t") || mime.includes("x-flv"))
    return { type: "vlc-only", label: lower.endsWith(".flv") ? "FLV" : "MPEG-TS", reason: "format" };

  // HLS — MIME or extension
  if (mime.includes("mpegurl") || mime.includes("x-mpegurl") || lower.endsWith(".m3u8"))
    return { type: "hls", label: "HLS", reason: "" };

  // Native HTML5
  if (mime.includes("mp4") || mime.includes("webm") || mime.includes("ogg") ||
      lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".ogv"))
    return { type: "native", label: "MP4/WebM", reason: "" };

  // Unknown http(s) — try HLS first (most IPTV servers serve m3u8 without extension)
  if (/^https?:\/\//i.test(url))
    return { type: "unknown-http", label: "HLS*", reason: "" };

  return { type: "vlc-only", label: "Unknown", reason: "format" };
}

// ── VLC suggestion panel ──────────────────────────────────────────────────────

function VLCSuggestion({ url, label, reason }: { url: string; label: string; reason: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const msg =
    reason === "protocol"
      ? `${label} streams cannot play in a browser`
      : `${label} streams require a native media player`;

  return (
    <div className="rounded-lg border border-dashed border-yellow-500/40 bg-yellow-500/5 p-5 flex flex-col items-center gap-3 text-center">
      <Tv2 className="w-9 h-9 text-yellow-500/70" />
      <div>
        <p className="font-semibold text-sm">{msg}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Open in VLC, IPTV Smarters, or any player that supports this format
        </p>
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" asChild>
          <a href={`vlc://${url}`} rel="noreferrer">
            <Play className="w-3 h-3" /> Open in VLC
          </a>
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5 text-xs h-8" onClick={copy}>
          {copied ? "Copied!" : "Copy URL"}
        </Button>
      </div>
      <Badge variant="outline" className="font-mono text-[10px] text-yellow-600 border-yellow-500/30">
        {label}
      </Badge>
    </div>
  );
}

// ── Main player ───────────────────────────────────────────────────────────────

export interface StreamPlayerProps {
  url: string;
  mimeType?: string | null;
  title?: string;
  className?: string;
}

export function StreamPlayer({ url, mimeType, title, className }: StreamPlayerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const hlsRef     = useRef<Hls | null>(null);

  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [muted,     setMuted]     = useState(true);
  const [playing,   setPlaying]   = useState(false);
  // If the optimistic HLS attempt fails for unknown-http, show VLC panel
  const [hlsFailed, setHlsFailed] = useState(false);

  const fmt = detectFormat(url, mimeType);

  const destroy = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const v = videoRef.current;
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
  }, []);

  const setupHls = useCallback((videoEl: HTMLVideoElement, streamUrl: string, isOptimistic = false) => {
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 1,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        setError(null);
        videoEl.play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
          setLoading(false);
          if (isOptimistic) {
            setHlsFailed(true);   // fall back to VLC suggestion
          } else {
            setError(`Playback error: ${data.details ?? "stream unavailable"}`);
          }
        }
      });
    } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      videoEl.src = streamUrl;
      videoEl.load();
      videoEl.onloadedmetadata = () => {
        setLoading(false);
        videoEl.play().then(() => setPlaying(true)).catch(() => {});
      };
      videoEl.onerror = () => {
        setLoading(false);
        if (isOptimistic) setHlsFailed(true);
        else setError("Stream unavailable or unsupported format");
      };
    } else {
      setLoading(false);
      setError("HLS not supported in this browser. Try Chrome or Firefox.");
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(null);
    setPlaying(false);
    setHlsFailed(false);
    destroy();

    if (fmt.type === "vlc-only") { setLoading(false); return; }

    if (fmt.type === "hls" || fmt.type === "unknown-http") {
      setupHls(video, url, fmt.type === "unknown-http");
      return;
    }

    if (fmt.type === "native") {
      video.src = url;
      video.load();
      video.oncanplay = () => {
        setLoading(false);
        video.play().then(() => setPlaying(true)).catch(() => {});
      };
      video.onerror = () => {
        setLoading(false);
        setError("Failed to load — check CORS headers or stream availability");
      };
    }

    return destroy;
  }, [url, fmt.type, destroy, setupHls]);

  // ── VLC-only or optimistic HLS that failed ─────────────────────────────────
  if (fmt.type === "vlc-only" || hlsFailed) {
    return (
      <VLCSuggestion
        url={url}
        label={hlsFailed ? "Stream" : fmt.label}
        reason={hlsFailed ? "format" : fmt.reason}
      />
    );
  }

  return (
    <div className={cn("rounded-lg overflow-hidden border bg-black relative group", className)}>
      {/* Format badge */}
      <div className="absolute top-2 left-2 z-10 pointer-events-none">
        <Badge variant="secondary" className="text-[10px] font-mono opacity-60 group-hover:opacity-100 transition-opacity bg-black/50 text-white border-white/10">
          {fmt.label}
        </Badge>
      </div>

      {/* Loading overlay */}
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black">
          <Loader2 className="w-8 h-8 animate-spin text-white/40 mb-2" />
          <span className="text-xs text-white/40">Connecting…</span>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/90 text-white p-4">
          <AlertTriangle className="w-8 h-8 text-yellow-400 mb-2" />
          <p className="text-xs text-center text-white/70 max-w-[240px] leading-relaxed mb-3">{error}</p>
          <div className="flex gap-2 flex-wrap justify-center">
            <Button size="sm" variant="secondary" className="text-xs h-7"
              onClick={() => { setError(null); setLoading(true); setupHls(videoRef.current!, url); }}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" className="text-xs h-7 gap-1" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3 h-3" /> Open URL
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* Video */}
      <video
        ref={videoRef}
        className="w-full aspect-video bg-black"
        muted={muted}
        playsInline
        controls={playing && !error}
        title={title}
      />

      {/* Big play button before playback */}
      {!playing && !loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center transition-colors"
            onClick={() => videoRef.current?.play().then(() => setPlaying(true))}
          >
            <Play className="w-6 h-6 text-white fill-white ml-1" />
          </button>
        </div>
      )}

      {/* Mute toggle (hover-reveal) */}
      {!loading && !error && (
        <button
          className="absolute bottom-10 right-2 z-20 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.muted = !muted;
              setMuted(v => !v);
            }
          }}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted
            ? <VolumeX className="w-3.5 h-3.5 text-white" />
            : <Volume2 className="w-3.5 h-3.5 text-white" />}
        </button>
      )}
    </div>
  );
}
