import { useEffect, useRef, useState, useCallback } from "react";
import Hls, { Level, AudioTrack } from "hls.js";
import { cn } from "@/lib/utils";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RefreshCw,
  Info,
  ShieldCheck,
  Globe,
  Check,
  Copy,
  ExternalLink,
  Tv2,
  AlertTriangle,
  Loader2,
  Layers,
  Activity,
  Terminal,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface MediaStreamPlayerProps {
  url: string;
  title?: string;
  poster?: string | null;
  className?: string;
  userAgent?: string | null;
  referrer?: string | null;
  autoPlay?: boolean;
  onProbeData?: (probeInfo: StreamInspectionData) => void;
}

export interface StreamInspectionData {
  resolution?: string;
  bitrateKbps?: number;
  videoCodec?: string;
  audioCodec?: string;
  bufferLengthSec?: number;
  droppedFrames?: number;
  totalFrames?: number;
  latencyMs?: number;
  levelsCount?: number;
  currentLevel?: number;
  format?: string;
  statusCode?: number;
}

export interface StreamLogEntry {
  id: string;
  timestamp: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
}

export function buildProxyStreamUrl(rawUrl: string, userAgent?: string | null, referrer?: string | null): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const proxyUrl = new URL("/api/stream-proxy", origin || "http://localhost:3000");
  proxyUrl.searchParams.set("url", rawUrl);
  if (userAgent?.trim()) proxyUrl.searchParams.set("userAgent", userAgent.trim());
  if (referrer?.trim()) proxyUrl.searchParams.set("referrer", referrer.trim());
  return proxyUrl.toString();
}

export function MediaStreamPlayer({
  url,
  title,
  poster,
  className,
  userAgent,
  referrer,
  autoPlay = true,
  onProbeData,
}: MediaStreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  // States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"stats" | "levels" | "logs">("stats");
  const [copiedType, setCopiedType] = useState<string | null>(null);

  // Mode: "direct" (Home IP) vs "relay" (Cloud proxy)
  const [mode, setMode] = useState<"direct" | "relay">(() => {
    try {
      return (localStorage.getItem("streamguard_player_mode") as "direct" | "relay") || "direct";
    } catch (_) {
      return "direct";
    }
  });

  // HLS Manifest Inspection Data
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevelIndex, setCurrentLevelIndex] = useState<number>(-1); // -1 = Auto
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);
  const [stats, setStats] = useState<StreamInspectionData>({});
  const [logs, setLogs] = useState<StreamLogEntry[]>([]);

  const addLog = useCallback((message: string, type: StreamLogEntry["type"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: time,
        type,
        message,
      },
      ...prev.slice(0, 49),
    ]);
  }, []);

  const copyToClipboard = (text: string, typeKey: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedType(typeKey);
      setTimeout(() => setCopiedType(null), 2000);
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
          if (err && err.name !== "AbortError" && err.name !== "NotAllowedError") {
            console.warn("[MediaStreamPlayer] play error:", err);
          }
        });
      }
    } catch (_) {
      setPlaying(false);
    }
  }, []);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      const cleanup = () => {
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch (_) {}
      };
      if (playPromiseRef.current) {
        playPromiseRef.current.then(cleanup).catch(cleanup);
      } else {
        cleanup();
      }
    }
  }, []);

  const toggleMode = (newMode: "direct" | "relay") => {
    try {
      localStorage.setItem("streamguard_player_mode", newMode);
    } catch (_) {}
    setMode(newMode);
    setError(null);
    setLoading(true);
    addLog(`Switched playback mode to ${newMode.toUpperCase()}`, "info");
  };

  const selectQualityLevel = (levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setCurrentLevelIndex(levelIndex);
      const levelName = levelIndex === -1 ? "Auto" : `${levels[levelIndex]?.height || "Unknown"}p`;
      addLog(`Quality level set to ${levelName}`, "info");
    }
  };

  const selectAudioTrack = (trackIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackIndex;
      setCurrentAudioTrack(trackIndex);
      addLog(`Audio track switched to #${trackIndex}`, "info");
    }
  };

  // Main Stream Loader
  const loadStream = useCallback(() => {
    destroyHls();
    const video = videoRef.current;
    if (!video) return;

    setLoading(true);
    setError(null);

    const activeUrl = mode === "relay" ? buildProxyStreamUrl(url, userAgent, referrer) : url;
    const startTime = Date.now();
    addLog(`Initializing stream: ${url} (${mode.toUpperCase()} mode)`, "info");

    const isHls = url.includes(".m3u8") || url.includes("m3u8") || mode === "relay";

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });

      hlsRef.current = hls;
      hls.loadSource(activeUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setLoading(false);
        setError(null);
        setLevels(data.levels);
        setCurrentLevelIndex(hls.currentLevel);

        const latency = Date.now() - startTime;
        addLog(`HLS Manifest parsed with ${data.levels.length} quality level(s) (${latency}ms)`, "success");

        const updatedStats: StreamInspectionData = {
          levelsCount: data.levels.length,
          latencyMs: latency,
          format: "HLS.js / HTML5",
        };

        if (data.levels.length > 0) {
          const topLevel = data.levels[data.levels.length - 1];
          if (topLevel.width && topLevel.height) {
            updatedStats.resolution = `${topLevel.width}x${topLevel.height}`;
          }
          if (topLevel.bitrate) {
            updatedStats.bitrateKbps = Math.round(topLevel.bitrate / 1000);
          }
          if (topLevel.videoCodec) {
            updatedStats.videoCodec = topLevel.videoCodec;
          }
          if (topLevel.audioCodec) {
            updatedStats.audioCodec = topLevel.audioCodec;
          }
        }

        setStats((prev) => {
          const merged = { ...prev, ...updatedStats };
          onProbeData?.(merged);
          return merged;
        });

        if (autoPlay) {
          safePlay();
        }
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        setAudioTracks(data.audioTracks);
        setCurrentAudioTrack(hls.audioTrack);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevelIndex(data.level);
        const lvl = hls.levels[data.level];
        if (lvl) {
          addLog(`Switched to active level ${lvl.height}p (${Math.round(lvl.bitrate / 1000)} Kbps)`, "info");
          setStats((prev) => ({
            ...prev,
            resolution: lvl.width && lvl.height ? `${lvl.width}x${lvl.height}` : prev.resolution,
            bitrateKbps: lvl.bitrate ? Math.round(lvl.bitrate / 1000) : prev.bitrateKbps,
          }));
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          const msg = `Fatal HLS Error: ${data.type} - ${data.details}`;
          addLog(msg, "error");
          setError(msg);
          setLoading(false);
          hls.destroy();
          hlsRef.current = null;
        } else {
          addLog(`Non-fatal HLS event: ${data.details}`, "warn");
        }
      });
    } else {
      // Native HTML5 Video Fallback (e.g. Safari or direct mp4/hls)
      video.src = activeUrl;
      video.load();

      video.oncanplay = () => {
        setLoading(false);
        setError(null);
        const latency = Date.now() - startTime;
        addLog(`Stream ready for HTML5 native playback (${latency}ms)`, "success");

        const updatedStats: StreamInspectionData = {
          resolution: video.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : undefined,
          latencyMs: latency,
          format: "Native HTML5",
        };

        setStats((prev) => {
          const merged = { ...prev, ...updatedStats };
          onProbeData?.(merged);
          return merged;
        });

        if (autoPlay) {
          safePlay();
        }
      };

      video.onerror = () => {
        const msg = "HTML5 native video failed to load or play media format.";
        addLog(msg, "error");
        setError(msg);
        setLoading(false);
      };
    }
  }, [url, mode, userAgent, referrer, autoPlay, destroyHls, safePlay, addLog, onProbeData]);

  useEffect(() => {
    loadStream();
    return () => {
      destroyHls();
    };
  }, [loadStream, destroyHls]);

  // Periodic inspector statistics polling
  useEffect(() => {
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;

      let bufferLen = 0;
      if (v.buffered && v.buffered.length > 0) {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
            bufferLen = Math.round((v.buffered.end(i) - v.currentTime) * 10) / 10;
            break;
          }
        }
      }

      let dropped: number | undefined;
      let total: number | undefined;
      if ("getVideoPlaybackQuality" in v) {
        const q = (v as any).getVideoPlaybackQuality();
        dropped = q.droppedVideoFrames;
        total = q.totalVideoFrames;
      }

      setStats((prev) => ({
        ...prev,
        resolution: v.videoWidth && v.videoHeight ? `${v.videoWidth}x${v.videoHeight}` : prev.resolution,
        bufferLengthSec: bufferLen,
        droppedFrames: dropped,
        totalFrames: total,
      }));
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  const toggleFullscreen = () => {
    const v = videoRef.current;
    if (v) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        v.requestFullscreen().catch(() => {});
      }
    }
  };

  const proxyUrl = buildProxyStreamUrl(url, userAgent, referrer);

  return (
    <div className={cn("relative flex flex-col overflow-hidden rounded-xl border border-border bg-slate-950 text-slate-100 shadow-xl", className)}>
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-slate-900/90 px-3.5 py-2 text-xs backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/20 text-primary">
            <Tv2 className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold truncate max-w-[200px] sm:max-w-[340px]">
            {title || "Media Stream Inspection Player"}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mode Switcher */}
          <button
            onClick={() => toggleMode(mode === "relay" ? "direct" : "relay")}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] font-semibold transition-colors shadow-xs border",
              mode === "direct"
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30"
                : "bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30"
            )}
            title={mode === "direct" ? "Direct Home IP mode" : "Cloud Relay Proxy mode"}
          >
            {mode === "direct" ? <ShieldCheck className="h-3 w-3 text-emerald-400" /> : <Globe className="h-3 w-3 text-sky-300" />}
            <span>{mode === "direct" ? "Home IP (Direct)" : "Cloud Relay"}</span>
          </button>

          {/* Inspector Drawer Toggle */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowInspector(!showInspector)}
            className={cn("h-7 px-2 text-[11px] gap-1 text-slate-300 hover:text-white", showInspector && "bg-white/15 text-white")}
          >
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">Inspector</span>
          </Button>
        </div>
      </div>

      {/* Main Video Stage */}
      <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 backdrop-blur-xs p-4 text-center">
            <Loader2 className="mb-2 h-9 w-9 animate-spin text-primary" />
            <span className="font-mono text-xs text-white/80">
              Connecting stream via {mode === "direct" ? "Home IP (Direct)" : "Cloud Relay Proxy"}…
            </span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/95 p-5 text-center overflow-y-auto">
            <AlertTriangle className="h-10 w-10 text-amber-400 mb-2" />
            <h4 className="font-display font-bold text-sm text-white">Stream Playback Failed</h4>
            <p className="text-xs text-white/70 max-w-md mt-1 leading-relaxed">{error}</p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs bg-slate-900 border-slate-700" onClick={() => toggleMode(mode === "relay" ? "direct" : "relay")}>
                <RefreshCw className="h-3 w-3" /> Try {mode === "relay" ? "Home IP (Direct)" : "Cloud Relay"}
              </Button>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30" asChild>
                <a href={`vlc://${url}`} rel="noreferrer">
                  <Play className="h-3 w-3 fill-current" /> Open in VLC Player
                </a>
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
          controls
        />

        {/* Floating Manual Play Overlay */}
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

        {/* Quick Floating Controls */}
        {!loading && !error && (
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !muted;
                  setMuted(!muted);
                }
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-white backdrop-blur-xs hover:bg-black/90 transition-colors"
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-white backdrop-blur-xs hover:bg-black/90 transition-colors"
              title="Fullscreen"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Expandable Stream Inspector Panel */}
      {showInspector && (
        <div className="border-t border-white/10 bg-slate-900/95 p-4 text-xs space-y-3 backdrop-blur-md">
          <Tabs value={inspectorTab} onValueChange={(val) => setInspectorTab(val as any)} className="w-full">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <TabsList className="bg-slate-950 h-8">
                <TabsTrigger value="stats" className="text-xs h-7 gap-1 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                  <Activity className="h-3 w-3" /> Live Metrics
                </TabsTrigger>
                <TabsTrigger value="levels" className="text-xs h-7 gap-1 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                  <Layers className="h-3 w-3" /> HLS Levels ({levels.length})
                </TabsTrigger>
                <TabsTrigger value="logs" className="text-xs h-7 gap-1 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                  <Terminal className="h-3 w-3" /> Event Logs ({logs.length})
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                {stats.resolution && <Badge variant="outline" className="font-mono text-[10px]">{stats.resolution}</Badge>}
                {stats.format && <Badge variant="secondary" className="font-mono text-[10px]">{stats.format}</Badge>}
              </div>
            </div>

            {/* TAB 1: Live Metrics */}
            <TabsContent value="stats" className="space-y-3 pt-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                <div className="bg-slate-950 p-2.5 rounded border border-white/5 space-y-0.5">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider block">Resolution</span>
                  <span className="text-slate-200 font-semibold">{stats.resolution || "Detecting..."}</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded border border-white/5 space-y-0.5">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider block">Bitrate</span>
                  <span className="text-emerald-400 font-semibold">{stats.bitrateKbps ? `${stats.bitrateKbps} Kbps` : "N/A"}</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded border border-white/5 space-y-0.5">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider block">Buffer Health</span>
                  <span className="text-sky-300 font-semibold">{stats.bufferLengthSec !== undefined ? `${stats.bufferLengthSec}s` : "0s"}</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded border border-white/5 space-y-0.5">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider block">Dropped Frames</span>
                  <span className="text-amber-400 font-semibold">{stats.droppedFrames !== undefined ? `${stats.droppedFrames}` : "0"}</span>
                </div>
              </div>

              <div className="grid gap-1.5 text-slate-300 font-mono text-[11px] bg-slate-950 p-3 rounded border border-white/5">
                <div className="flex justify-between items-center text-slate-400">
                  <span>Stream URL:</span>
                  <span className="text-slate-200 truncate max-w-[280px] sm:max-w-[450px]">{url}</span>
                </div>
                {stats.videoCodec && (
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Video Codec:</span>
                    <span className="text-emerald-400">{stats.videoCodec}</span>
                  </div>
                )}
                {stats.audioCodec && (
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Audio Codec:</span>
                    <span className="text-sky-400">{stats.audioCodec}</span>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* TAB 2: HLS Levels & Quality Selector */}
            <TabsContent value="levels" className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Select Adaptive Bitrate Representation:</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => selectQualityLevel(-1)}>
                  Auto Selection
                </Button>
              </div>

              {levels.length === 0 ? (
                <div className="text-slate-500 text-center py-4 font-mono text-[11px]">No HLS quality representations found in manifest.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                  {levels.map((lvl, idx) => {
                    const isActive = currentLevelIndex === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => selectQualityLevel(idx)}
                        className={cn(
                          "flex items-center justify-between p-2 rounded border text-left transition-colors",
                          isActive
                            ? "bg-primary/20 border-primary text-primary"
                            : "bg-slate-950 border-white/5 text-slate-300 hover:bg-slate-800"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Settings2 className="h-3.5 w-3.5" />
                          <span>Level {idx + 1}: {lvl.height ? `${lvl.height}p` : "Unknown"}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">{Math.round(lvl.bitrate / 1000)} Kbps</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* TAB 3: Diagnostic Logs */}
            <TabsContent value="logs" className="space-y-2 pt-2">
              <div className="h-36 overflow-y-auto font-mono text-[11px] bg-slate-950 p-2.5 rounded border border-white/5 space-y-1">
                {logs.length === 0 ? (
                  <div className="text-slate-500">No events logged yet.</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2">
                      <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                      <span
                        className={cn(
                          log.type === "error"
                            ? "text-rose-400"
                            : log.type === "warn"
                            ? "text-amber-400"
                            : log.type === "success"
                            ? "text-emerald-400"
                            : "text-slate-300"
                        )}
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => copyToClipboard(url, "raw")}>
                {copiedType === "raw" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiedType === "raw" ? "Copied!" : "Copy Stream Link"}</span>
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => copyToClipboard(proxyUrl, "proxy")}>
                {copiedType === "proxy" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiedType === "proxy" ? "Copied!" : "Copy Proxy Link"}</span>
              </Button>
            </div>

            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-slate-300 hover:text-white" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3 w-3" /> Open Link
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
