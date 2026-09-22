import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { cn } from "@/lib/utils";
import {
  Loader2,
  AlertTriangle,
  Play,
  Volume2,
  VolumeX,
  ExternalLink,
  Tv2,
  ShieldCheck,
  Globe,
  Maximize,
  Copy,
  Check,
  Info,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface StreamPlayerProps {
  url: string;
  mimeType?: string | null;
  title?: string;
  poster?: string | null;
  className?: string;
  /** M3U http-user-agent value. Browsers cannot set this directly, so the relay is used. */
  userAgent?: string | null;
  /** M3U http-referrer value. Browsers cannot set this directly, so the relay is used. */
  referrer?: string | null;
  autoPlay?: boolean;
}

export function buildStreamProxyUrl(url: string, userAgent?: string | null, referrer?: string | null): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const proxyUrl = new URL("/api/stream-proxy", origin || "http://localhost:3000");
  proxyUrl.searchParams.set("url", url);
  if (userAgent?.trim()) proxyUrl.searchParams.set("userAgent", userAgent.trim());
  if (referrer?.trim()) proxyUrl.searchParams.set("referrer", referrer.trim());
  return proxyUrl.toString();
}

export function StreamPlayer({
  url,
  mimeType,
  title,
  poster,
  className,
  userAgent,
  referrer,
  autoPlay = true,
}: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const lastStatusCodeRef = useRef<number | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeoblocked, setIsGeoblocked] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<"relay" | "direct">(() => {
    try {
      const saved = localStorage.getItem("streamguard_player_mode");
      if (saved === "relay" || saved === "direct") return saved;
    } catch (_) {}
    return "direct"; // Default to Direct (Real Home IP) mode
  });
  const [attemptedModes, setAttemptedModes] = useState<Set<string>>(() => new Set([mode]));
  const attemptedModesRef = useRef<Set<string>>(new Set([mode]));
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<{ resolution?: string; latencyMs?: number; format?: string; statusCode?: number }>({});

  const isHls = /\.m3u8?(?:$|[?#])/i.test(url) || (mimeType ?? "").includes("mpegurl");
  const isDash = /\.mpd(?:$|[?#])/i.test(url) || (mimeType ?? "").includes("dash");

  const effectiveUrl = mode === "relay" ? buildStreamProxyUrl(url, userAgent, referrer) : url;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(label);
      setTimeout(() => setCopiedUrl(null), 2000);
    });
  };

  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const p = video.play();
      if (p !== undefined) {
        playPromiseRef.current = p;
        p.then(() => {
          playPromiseRef.current = null;
          setPlaying(true);
        }).catch((err) => {
          playPromiseRef.current = null;
          setPlaying(false);
          // Ignore non-fatal AbortError (interrupted by load/unload) and NotAllowedError (autoplay policy)
          if (err && err.name !== "AbortError" && err.name !== "NotAllowedError") {
            console.warn("[StreamPlayer] video.play() error:", err);
          }
        });
      }
    } catch (_) {
      setPlaying(false);
    }
  }, []);

  const destroy = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      const cleanupMedia = () => {
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch (_) {}
      };

      if (playPromiseRef.current) {
        playPromiseRef.current.then(cleanupMedia).catch(cleanupMedia);
      } else {
        cleanupMedia();
      }
    }
  }, []);

  const handleModeSwitch = (newMode: "relay" | "direct") => {
    try {
      localStorage.setItem("streamguard_player_mode", newMode);
    } catch (_) {}
    attemptedModesRef.current = new Set([newMode]);
    setAttemptedModes(new Set([newMode]));
    setMode(newMode);
    setError(null);
    setIsGeoblocked(false);
  };

  const loadStream = useCallback(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    destroy();
    setLoading(true);
    setError(null);
    setIsGeoblocked(false);
    setPlaying(false);

    const streamToPlay = mode === "relay" ? buildStreamProxyUrl(url, userAgent, referrer) : url;
    const startTime = Date.now();

    const handlePlaybackFailure = (reason: string, statusCode?: number) => {
      const code = statusCode || lastStatusCodeRef.current;
      const isBlockCode = code === 403 || code === 451 || code === 401 || code === 418 || code === 429;
      
      // Auto-fallback: If current mode failed, try the other mode if not yet attempted
      const otherMode = mode === "relay" ? "direct" : "relay";
      if (!attemptedModesRef.current.has(otherMode)) {
        console.log(`[StreamPlayer] ${mode} mode failed (${reason}), auto-trying ${otherMode} mode...`);
        attemptedModesRef.current.add(otherMode);
        setAttemptedModes(new Set(attemptedModesRef.current));
        setMode(otherMode);
        return;
      }

      setLoading(false);
      setIsGeoblocked(isBlockCode || reason.includes("Geoblocked") || reason.includes("403") || reason.includes("418"));
      setError(
        code === 418
          ? "Origin Anti-Bot Filter returned HTTP 418 (Teapot). Switch to Home IP (Direct) mode or open in VLC."
          : isBlockCode
          ? `Stream Origin Server restricted Cloud Proxy access (HTTP ${code || 403}). Try Direct Mode or open in VLC.`
          : reason
      );
    };

    // HLS stream using Hls.js
    if (Hls.isSupported() && (isHls || mode === "relay" || !url.endsWith(".mp4"))) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        manifestLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 2,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
          xhr.addEventListener("readystatechange", () => {
            if (xhr.readyState >= 2 && xhr.status > 0) {
              lastStatusCodeRef.current = xhr.status;
              setStats((prev) => ({ ...prev, statusCode: xhr.status }));
            }
          });
        },
      });

      hlsRef.current = hls;
      hls.loadSource(streamToPlay);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        setError(null);
        setIsGeoblocked(false);
        setStats((prev) => ({ ...prev, latencyMs: Date.now() - startTime, format: "HLS / Live" }));
        if (autoPlay) {
          safePlay();
        }
      });

      hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
        const level = hls.levels[hls.currentLevel];
        if (level) {
          setStats((prev) => ({
            ...prev,
            resolution: `${level.width}x${level.height} @ ${Math.round(level.bitrate / 1000)}k`,
          }));
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
          const code = (data.response && data.response.code) || lastStatusCodeRef.current;
          const reasonMsg =
            code === 418
              ? "Origin Anti-Bot Filter (HTTP 418)"
              : code === 403 || code === 451
              ? `Geoblocked by Origin (HTTP ${code})`
              : `Stream unreachable via ${mode} mode (Network error).`;
          handlePlaybackFailure(reasonMsg, code);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl") || isHls) {
      // Native Apple HLS
      video.crossOrigin = mode === "direct" ? "anonymous" : undefined;
      video.src = streamToPlay;
      video.load();
      video.onloadedmetadata = () => {
        setLoading(false);
        setError(null);
        setIsGeoblocked(false);
        setStats((prev) => ({
          ...prev,
          resolution: `${video.videoWidth}x${video.videoHeight}`,
          latencyMs: Date.now() - startTime,
          format: "Native HLS",
        }));
        if (autoPlay) {
          safePlay();
        }
      };
      video.onerror = () => {
        handlePlaybackFailure(`Native player playback failed in ${mode} mode.`);
      };
    } else {
      // HTML5 direct video (MP4/WebM/TS)
      video.crossOrigin = mode === "direct" ? "anonymous" : undefined;
      video.src = streamToPlay;
      video.load();
      video.oncanplay = () => {
        setLoading(false);
        setError(null);
        setIsGeoblocked(false);
        setStats((prev) => ({
          ...prev,
          resolution: `${video.videoWidth}x${video.videoHeight}`,
          latencyMs: Date.now() - startTime,
          format: isDash ? "DASH" : "HTML5 Video",
        }));
        if (autoPlay) {
          safePlay();
        }
      };
      video.onerror = () => {
        handlePlaybackFailure(`Direct video decoding failed in ${mode} mode.`);
      };
    }
  }, [url, mode, userAgent, referrer, isHls, isDash, autoPlay, destroy, safePlay]);

  useEffect(() => {
    loadStream();
    return destroy;
  }, [loadStream, destroy]);

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      video.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div className={cn("relative flex flex-col overflow-hidden rounded-xl border border-border bg-slate-950 text-slate-100 shadow-md group", className)}>
      {/* Top Header Controls */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-slate-900/90 px-3.5 py-2 text-xs backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/20 text-primary">
            <Tv2 className="h-3 w-3" />
          </div>
          <span className="font-semibold truncate max-w-[180px] sm:max-w-[320px]">{title || "Live Stream Player"}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mode Switcher */}
          <button
            onClick={() => handleModeSwitch(mode === "relay" ? "direct" : "relay")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors shadow-xs",
              mode === "direct"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30"
                : "bg-sky-500/20 text-sky-300 border border-sky-500/40 hover:bg-sky-500/30"
            )}
            title={mode === "direct" ? "Home IP Mode: Fetching directly from your browser using your real ISP home IP address" : "Server Proxy Mode: Routed via backend cloud server"}
          >
            {mode === "direct" ? <Globe className="h-3 w-3 text-emerald-400" /> : <ShieldCheck className="h-3 w-3 text-sky-300" />}
            <span>{mode === "direct" ? "Home IP (Direct)" : "Cloud Relay"}</span>
          </button>

          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className={cn("rounded p-1 text-white/60 hover:bg-white/10 hover:text-white transition-colors", showDiagnostics && "bg-white/20 text-white")}
            title="Toggle Stream Diagnostics"
            aria-label="Toggle diagnostics"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Video Viewport */}
      <div className="relative aspect-video w-full bg-black flex items-center justify-center">
        {/* Loading Overlay */}
        {loading && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-center">
            <Loader2 className="mb-2 h-9 w-9 animate-spin text-primary" />
            <span className="font-mono text-xs text-white/80">Connecting via {mode === "direct" ? "Home IP (Direct Browser)" : "Cloud Relay Proxy"}…</span>
          </div>
        )}

        {/* Error / Fallback State */}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/95 p-5 text-center overflow-y-auto">
            <AlertTriangle className={cn("h-9 w-9 mb-2", isGeoblocked ? "text-rose-400" : "text-amber-400")} />
            <h4 className="font-display font-bold text-sm text-white">
              {isGeoblocked ? "Geoblocked / Restricted Channel" : "Playback Error"}
            </h4>
            <p className="text-xs text-white/70 max-w-md mt-1 leading-relaxed">
              {isGeoblocked
                ? "This stream origin blocks Cloud Relay server IPs (HTTP 403 Forbidden). Switch to Home IP (Direct) mode or launch directly in VLC Player on your device."
                : error}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs bg-slate-900 border-slate-700 hover:bg-slate-800"
                onClick={() => handleModeSwitch(mode === "relay" ? "direct" : "relay")}
              >
                <RefreshCw className="h-3 w-3" /> Try {mode === "relay" ? "Home IP (Direct Mode)" : "Cloud Relay Mode"}
              </Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30" asChild>
                <a href={`vlc://${url}`} rel="noreferrer">
                  <Play className="h-3 w-3 fill-current" /> Launch in VLC (Home IP)
                </a>
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-slate-300 hover:text-white" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" /> Open Stream in New Tab
                </a>
              </Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-slate-300 hover:text-white" onClick={() => copyToClipboard(url, "url")}>
                {copiedUrl === "url" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiedUrl === "url" ? "Copied!" : "Copy URL"}</span>
              </Button>
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          poster={poster || undefined}
          muted={muted}
          playsInline
          controls={playing && !error}
        />

        {/* Play Overlay Button */}
        {!playing && !loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <button
              onClick={safePlay}
              className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/30 bg-primary/90 text-primary-foreground shadow-2xl transition-transform hover:scale-105 active:scale-95"
              aria-label="Play stream"
            >
              <Play className="ml-1 h-7 w-7 fill-current" />
            </button>
          </div>
        )}

        {/* Floating Quick Controls */}
        {!loading && !error && (
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !muted;
                  setMuted(!muted);
                }
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-white backdrop-blur hover:bg-black/90 transition-colors"
              title={muted ? "Unmute" : "Mute"}
              aria-label="Toggle mute"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>

            <button
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-white backdrop-blur hover:bg-black/90 transition-colors"
              title="Fullscreen"
              aria-label="Toggle fullscreen"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Diagnostics Drawer */}
      {showDiagnostics && (
        <div className="border-t border-white/10 bg-slate-900/95 p-4 text-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-300">Stream Relay Diagnostics</span>
            <div className="flex items-center gap-2">
              {stats.resolution && <Badge variant="outline" className="font-mono text-[10px]">{stats.resolution}</Badge>}
              {stats.format && <Badge variant="secondary" className="font-mono text-[10px]">{stats.format}</Badge>}
            </div>
          </div>

          <div className="grid gap-2 text-slate-400 font-mono text-[11px]">
            <div className="flex items-start justify-between gap-2 bg-slate-950 p-2 rounded">
              <span className="text-slate-500 shrink-0">Source URL:</span>
              <span className="break-all text-right text-slate-300">{url}</span>
            </div>
            {userAgent && (
              <div className="flex items-start justify-between gap-2 bg-slate-950 p-2 rounded">
                <span className="text-slate-500 shrink-0">User-Agent:</span>
                <span className="break-all text-right text-emerald-400">{userAgent}</span>
              </div>
            )}
            {referrer && (
              <div className="flex items-start justify-between gap-2 bg-slate-950 p-2 rounded">
                <span className="text-slate-500 shrink-0">Referrer:</span>
                <span className="break-all text-right text-sky-400">{referrer}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => copyToClipboard(url, "raw")}>
              {copiedUrl === "raw" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>Copy Raw Link</span>
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => copyToClipboard(effectiveUrl, "proxy")}>
              {copiedUrl === "proxy" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>Copy Proxy Stream Link</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 ml-auto" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3 w-3" /> Open in New Tab
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
