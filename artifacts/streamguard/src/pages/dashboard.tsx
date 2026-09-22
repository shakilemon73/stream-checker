import { useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Database,
  FastForward,
  FileText,
  Flame,
  FolderGit2,
  Gauge,
  Globe,
  Layers,
  Link2,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  Tv2,
  Upload,
  Video,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import {
  useCreateJob,
  useCreatePlaylist,
  useHealthCheck,
  useListJobs,
  useListPlaylists,
} from "@workspace/api-client-react";
import { formatTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StreamPlayer } from "@/components/stream-player";

// Curated public M3U presets for 1-click test ingests
const CURATED_PRESETS = [
  {
    id: "news-fta",
    title: "Global 24/7 News (FTA)",
    description: "Official live broadcasts from DW, France 24, Euronews & Al Jazeera",
    channelCount: 4,
    tags: ["News", "Official HLS", "HD"],
    content: `#EXTM3U
#EXTINF:-1 tvg-id="DW.En" tvg-name="Deutsche Welle English" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_logo.svg/320px-Deutsche_Welle_logo.svg.png" group-title="News",DW English 24/7
https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8
#EXTINF:-1 tvg-id="France24.En" tvg-name="France 24 English" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/France_24_logo.svg/320px-France_24_logo.svg.png" group-title="News",France 24 International
https://static.france24.com/live/F24_EN_LO_HLS/live_tv.m3u8
#EXTINF:-1 tvg-id="AlJazeera.En" tvg-name="Al Jazeera English HD" tvg-logo="https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Al_Jazeera_English_logo.svg/320px-Al_Jazeera_English_logo.svg.png" group-title="News",Al Jazeera English HD
https://live-hls-web-aje.getaj.net/AJE/01.m3u8
#EXTINF:-1 tvg-id="Euronews.En" tvg-name="Euronews Live" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Euronews_2016_logo.svg/320px-Euronews_2016_logo.svg.png" group-title="News",Euronews English
https://euronews-euronews-world-1-en.samsung.wurl.tv/playlist.m3u8`,
  },
  {
    id: "nasa-space",
    title: "NASA Space & Science HD",
    description: "NASA TV Public, Media Channels & High-Def ISS Live Earth views",
    channelCount: 3,
    tags: ["Science", "Space", "NASA 1080p"],
    content: `#EXTM3U
#EXTINF:-1 tvg-id="NASA.Public" tvg-name="NASA TV Public HD" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/e/e5/NASA_logo.svg" group-title="Science",NASA TV Public HD
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 tvg-id="NASA.Media" tvg-name="NASA Media Channel" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/e/e5/NASA_logo.svg" group-title="Science",NASA Media Channel HD
https://ntv2.akamaized.net/hls/live/2014076/NASA-NTV2-HLS/master.m3u8
#EXTINF:-1 tvg-id="ISS.Live" tvg-name="ISS Live High-Def Stream" tvg-logo="https://images.nasa.gov/images/nasa_logo-sm.png" group-title="Science",ISS HD Earth Views
https://live.issstream.com/live/iss_hd.m3u8`,
  },
  {
    id: "sports-fta",
    title: "Sports & Live Action",
    description: "Red Bull TV Live HD and World Poker Tour 24/7 channels",
    channelCount: 2,
    tags: ["Sports", "Action", "Free-to-Air"],
    content: `#EXTM3U
#EXTINF:-1 tvg-id="RedBullTV.Global" tvg-name="Red Bull TV Live" tvg-logo="https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Red_Bull_TV_logo.svg/320px-Red_Bull_TV_logo.svg.png" group-title="Sports",Red Bull TV HD
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8
#EXTINF:-1 tvg-id="WorldPokerTour" tvg-name="World Poker Tour" tvg-logo="https://upload.wikimedia.org/wikipedia/en/thumb/0/07/World_Poker_Tour_logo.svg/320px-World_Poker_Tour_logo.svg.png" group-title="Sports",World Poker Tour 24/7
https://wpt-samsung-us.samsung.wurl.tv/playlist.m3u8`,
  },
];

const SPEED_PRESETS = [
  {
    id: "turbo",
    name: "Turbo Validation",
    icon: Zap,
    desc: "100 Lanes · 5s Timeout",
    concurrency: 100,
    timeoutMs: "5000",
    retryCount: "1",
    perHost: "20",
    badge: "Fastest",
  },
  {
    id: "balanced",
    name: "Balanced Standard",
    icon: Gauge,
    desc: "50 Lanes · 10s Timeout",
    concurrency: 50,
    timeoutMs: "10000",
    retryCount: "1",
    perHost: "10",
    badge: "Recommended",
  },
  {
    id: "stealth",
    name: "Polite & Safe",
    icon: ShieldCheck,
    desc: "15 Lanes · 15s Timeout",
    concurrency: 15,
    timeoutMs: "15000",
    retryCount: "2",
    perHost: "4",
    badge: "Low Load",
  },
  {
    id: "custom",
    name: "Custom Tuning",
    icon: Sliders,
    desc: "Manual parameters",
    concurrency: 50,
    timeoutMs: "10000",
    retryCount: "1",
    perHost: "10",
    badge: "Advanced",
  },
];

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: jobs, isLoading: jobsLoading, isError: jobsError } = useListJobs();
  const { data: playlists, isLoading: playlistsLoading } = useListPlaylists();
  const { data: health, isError: healthError } = useHealthCheck();
  const createPlaylist = useCreatePlaylist();
  const createJob = useCreateJob();

  // Ingest Form States
  const [activeTab, setActiveTab] = useState<"text" | "url" | "file" | "presets">("text");
  const [playlistName, setPlaylistName] = useState("");
  const [m3uText, setM3uText] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [m3uFile, setM3uFile] = useState<File | null>(null);
  const [fileDragging, setFileDragging] = useState(false);

  // Speed Profile & Concurrency Tuning
  const [selectedSpeedPreset, setSelectedSpeedPreset] = useState("balanced");
  const [concurrency, setConcurrency] = useState([50]);
  const [timeoutMs, setTimeoutMs] = useState("10000");
  const [retryCount, setRetryCount] = useState("1");
  const [perHostConcurrency, setPerHostConcurrency] = useState("10");
  const [autoProbe, setAutoProbe] = useState(true);
  const [showAdvancedTuning, setShowAdvancedTuning] = useState(false);

  // Instant Single-Stream Scratchpad Modal
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [scratchpadUrl, setScratchpadUrl] = useState("");
  const [scratchpadUa, setScratchpadUa] = useState("");
  const [scratchpadActiveUrl, setScratchpadActiveUrl] = useState("");

  // Live UTC Operations Clock
  const [liveUtcClock, setLiveUtcClock] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(11, 19) + " UTC";
  });
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setLiveUtcClock(d.toISOString().slice(11, 19) + " UTC");
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Aggregate Metrics
  const summary = useMemo(() => {
    const list = jobs ?? [];
    return list.reduce(
      (acc, job) => ({
        channels: acc.channels + job.total,
        live: acc.live + job.live,
        dead: acc.dead + job.dead,
        running: acc.running + (job.status === "running" || job.status === "paused" ? 1 : 0),
        completed: acc.completed + (job.status === "completed" ? 1 : 0),
      }),
      { channels: 0, live: 0, dead: 0, running: 0, completed: 0 }
    );
  }, [jobs]);

  const liveRate = summary.channels > 0 ? Math.round((summary.live / summary.channels) * 100) : 0;
  const deadRate = summary.channels > 0 ? Math.round((summary.dead / summary.channels) * 100) : 0;
  const recentJobs = jobs?.slice(0, 5) ?? [];
  const topPlaylists = playlists?.slice(0, 4) ?? [];

  // Count channels in pasted text
  const detectedChannelCount = useMemo(() => {
    if (!m3uText.trim()) return 0;
    const matches = m3uText.match(/#EXTINF:/gi);
    return matches ? matches.length : 0;
  }, [m3uText]);

  // Handle Preset Speed Selection
  const handleSelectSpeedPreset = (presetId: string) => {
    setSelectedSpeedPreset(presetId);
    const p = SPEED_PRESETS.find((x) => x.id === presetId);
    if (p && presetId !== "custom") {
      setConcurrency([p.concurrency]);
      setTimeoutMs(p.timeoutMs);
      setRetryCount(p.retryCount);
      setPerHostConcurrency(p.perHost);
    }
  };

  // Load Curated Preset
  const handleLoadCuratedPreset = (preset: (typeof CURATED_PRESETS)[0]) => {
    setPlaylistName(preset.title);
    setM3uText(preset.content);
    setActiveTab("text");
    toast.success(`Loaded preset: "${preset.title}"`);
  };

  // Auto-name suggestions from URL or file
  const handleUrlChange = (val: string) => {
    setM3uUrl(val);
    if (!playlistName && val.trim()) {
      try {
        const urlObj = new URL(val);
        const pathPart = urlObj.pathname.split("/").filter(Boolean).pop() || urlObj.hostname;
        const cleanName = pathPart.replace(/\.(m3u8?|txt)$/i, "").replace(/[-_]/g, " ");
        setPlaylistName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1) + " Lineup");
      } catch {
        // invalid URL typing in progress
      }
    }
  };

  const handleFileChange = (file: File | null) => {
    setM3uFile(file);
    if (file && !playlistName) {
      const clean = file.name.replace(/\.(m3u8?|txt)$/i, "").replace(/[-_]/g, " ");
      setPlaylistName(clean.charAt(0).toUpperCase() + clean.slice(1));
    }
  };

  // Keyboard shortcut (⌘+Enter / Ctrl+Enter) to launch pass
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleRunCheck();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playlistName, activeTab, m3uText, m3uUrl, m3uFile, concurrency, timeoutMs, retryCount, perHostConcurrency, autoProbe]);

  // Launch Health Check
  const handleRunCheck = async () => {
    if (!playlistName.trim()) {
      toast.error("Please enter a name for this playlist.");
      return;
    }

    try {
      let inputData: { name: string; sourceType: "text" | "url" | "file"; content?: string; url?: string } = {
        name: playlistName.trim(),
        sourceType: activeTab === "presets" ? "text" : (activeTab as "text" | "url" | "file"),
      };

      if (activeTab === "text" || activeTab === "presets") {
        if (!m3uText.trim()) {
          toast.error("Please paste M3U playlist text or choose a preset.");
          return;
        }
        inputData.content = m3uText;
      } else if (activeTab === "url") {
        if (!m3uUrl.trim()) {
          toast.error("Please provide a valid remote M3U URL.");
          return;
        }
        inputData.url = m3uUrl.trim();
      } else {
        if (!m3uFile) {
          toast.error("Please drop or select an M3U file.");
          return;
        }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1] ?? (reader.result as string));
          reader.onerror = reject;
          reader.readAsDataURL(m3uFile);
        });
        inputData.content = base64;
      }

      const playlist = await createPlaylist.mutateAsync({ data: inputData });
      const job = await createJob.mutateAsync({
        data: {
          playlistId: playlist.id,
          settings: {
            concurrency: concurrency[0],
            timeoutMs: Number(timeoutMs) || 10000,
            retryCount: Number(retryCount) || 1,
            perHostConcurrency: Number(perHostConcurrency) || 10,
            autoProbe,
          },
        },
      });

      toast.success("Validation pass started!");
      setLocation(`/jobs/${job.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start validation pass.");
    }
  };

  const isSubmitting = createPlaylist.isPending || createJob.isPending;

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-8 px-4 py-6 sm:px-7 lg:px-10 lg:py-8">
      {/* ── TOP OPERATIONAL COMMAND BAR ────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card/95 to-card/70 p-6 sm:p-8 shadow-sm backdrop-blur">
        {/* Decorative background grid subtle accent */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.06),transparent_50%)]" />

        <div className="relative space-y-6">
          {/* Real-time System Status Ribbon */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4 text-xs font-mono">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-bold text-primary shadow-xs">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                STREAMGUARD OPS // ENGINE v2.4
              </span>
              <span className="hidden sm:inline text-muted-foreground/60">/</span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Zap className="h-3 w-3 text-amber-500" />
                <span>100-Lane Concurrency Ready</span>
              </span>
              <span className="hidden md:inline text-muted-foreground/60">/</span>
              <span className="hidden md:inline-flex items-center gap-1.5 text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>FFprobe Codec Inspection Active</span>
              </span>
            </div>

            <div className="flex items-center gap-3 text-muted-foreground">
              <span className="flex items-center gap-1.5 font-mono text-[11px]">
                <Clock className="h-3 w-3 text-primary" />
                <span className="font-semibold text-foreground">{liveUtcClock}</span>
              </span>
            </div>
          </div>

          {/* Main Title & Operational Actions */}
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="space-y-2 max-w-3xl">
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-[40px] leading-none">
                Signal Operations & Ingest Deck
              </h1>
              <p className="text-sm sm:text-base leading-relaxed text-muted-foreground">
                Enterprise IPTV signal diagnostics. Audit multi-lane carrier health, extract HLS video/audio codecs, detect geo-restrictions, and sync directly with Git repositories.
              </p>
            </div>

            {/* Quick Actions & System Heartbeat */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">
              {/* Quick Stream Tester */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setScratchpadOpen(true)}
                className="h-10 gap-2 border-border/80 bg-background/80 px-4 text-xs font-semibold shadow-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all"
              >
                <Tv2 className="h-4 w-4 text-primary" />
                <span>Quick Stream Tester</span>
              </Button>

              {/* Browse Library */}
              <Button
                variant="outline"
                size="sm"
                asChild
                className="h-10 gap-2 border-border/80 bg-background/80 px-4 text-xs font-semibold shadow-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all"
              >
                <Link href="/playlists">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span>Library</span>
                  <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px] font-bold">
                    {playlists?.length ?? 0}
                  </Badge>
                </Link>
              </Button>

              {/* Operational Heartbeat Pill */}
              <div className="flex h-10 items-center gap-2.5 rounded-lg border border-border/80 bg-background/80 px-3.5 shadow-xs font-mono text-xs">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    healthError
                      ? "bg-rose-500"
                      : health?.status === "ok"
                      ? "bg-emerald-500 animate-pulse"
                      : "bg-amber-500"
                  )}
                />
                <span className="font-semibold text-foreground">
                  {healthError ? "Offline" : health?.status === "ok" ? "Control Plane Online" : "Connecting..."}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── KPI TELEMETRY GRID ────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Total Channels Inspected */}
        <Card className="border-border/80 bg-card/80 shadow-xs hover:border-primary/30 transition-all relative overflow-hidden group">
          <CardContent className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                Streams Inspected
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:scale-105 transition-transform">
                <Radio className="h-4 w-4" />
              </div>
            </div>
            <div>
              <div className="font-display text-3xl font-bold tracking-tight text-foreground">
                {summary.channels.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Across {jobs?.length ?? 0} historical passes</p>
            </div>
            {/* Visual distribution bar */}
            <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden flex">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${liveRate}%` }} />
              <div className="h-full bg-rose-500 transition-all" style={{ width: `${deadRate}%` }} />
            </div>
          </CardContent>
        </Card>

        {/* Metric 2: Live Health Quality */}
        <Card className="border-border/80 bg-card/80 shadow-xs hover:border-emerald-500/30 transition-all relative overflow-hidden group">
          <CardContent className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                Signal Live Rate
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 group-hover:scale-105 transition-transform">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <div>
              <div className="font-display text-3xl font-bold tracking-tight text-emerald-600 flex items-baseline gap-2">
                {summary.channels > 0 ? `${liveRate}%` : "—"}
                <span className="text-xs font-mono font-normal text-muted-foreground">
                  ({summary.live.toLocaleString()} Live)
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.dead > 0 ? `${summary.dead.toLocaleString()} offline streams filtered` : "Pristine carrier reliability"}
              </p>
            </div>
            <div className="h-1.5 w-full rounded-full bg-emerald-500/20 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${liveRate}%` }} />
            </div>
          </CardContent>
        </Card>

        {/* Metric 3: Active Validation Queue */}
        <Card className="border-border/80 bg-card/80 shadow-xs hover:border-indigo-500/30 transition-all relative overflow-hidden group">
          <CardContent className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                Active Passes
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 group-hover:scale-105 transition-transform">
                <Activity className={cn("h-4 w-4", summary.running > 0 && "animate-pulse")} />
              </div>
            </div>
            <div>
              <div className="font-display text-3xl font-bold tracking-tight text-foreground flex items-baseline gap-2">
                {String(summary.running).padStart(2, "0")}
                <span className="text-xs font-mono font-normal text-muted-foreground">
                  / {summary.completed} completed
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.running > 0 ? "Multi-lane inspection in progress" : "Inspection engine idle & ready"}
              </p>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: summary.running > 0 ? "100%" : "0%" }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Metric 4: Library Lineups */}
        <Card className="border-border/80 bg-card/80 shadow-xs hover:border-amber-500/30 transition-all relative overflow-hidden group">
          <CardContent className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                Catalog Lineups
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 group-hover:scale-105 transition-transform">
                <Database className="h-4 w-4" />
              </div>
            </div>
            <div>
              <div className="font-display text-3xl font-bold tracking-tight text-foreground">
                {playlists?.length ?? 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Available for audit & GitHub export</p>
            </div>
            <div className="h-1.5 w-full rounded-full bg-amber-500/20 overflow-hidden">
              <div
                className="h-full bg-amber-500"
                style={{ width: `${Math.min(100, (playlists?.length || 0) * 20)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── MAIN COCKPIT: INGEST STATION & FLIGHT RECORDER ──────────────────── */}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* ── LEFT: INGEST & HEALTH CHECK CONTROL DESK ──────────────────────── */}
        <div className="space-y-6">
          <Card className="border-border/80 bg-card/90 shadow-md overflow-hidden">
            <CardHeader className="border-b border-border/70 bg-muted/30 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-primary font-bold uppercase tracking-wider">
                    <Sparkles className="h-3.5 w-3.5" /> INGEST STATION // NEW CHECK
                  </div>
                  <CardTitle className="font-display text-2xl font-bold mt-1">
                    Load Playlist Source
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm mt-0.5">
                    Paste raw M3U, provide a remote endpoint URL, upload a file, or test curated presets.
                  </CardDescription>
                </div>

                <Badge variant="outline" className="font-mono text-xs gap-1.5 border-primary/30 bg-primary/5 text-primary">
                  <Cpu className="h-3 w-3" /> Auto-Probe Enabled
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-5 sm:p-6 space-y-6">
              {/* Playlist Name Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="playlist-name" className="text-xs font-semibold text-foreground">
                    Playlist Title / Identification *
                  </Label>
                  {playlistName && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {playlistName.length} chars
                    </span>
                  )}
                </div>
                <Input
                  id="playlist-name"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  placeholder="e.g. US Sports HD, Global News Lineup, Northern Cable Relay"
                  className="h-10 text-sm font-medium"
                />
              </div>

              {/* Ingest Source Tabs */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold text-foreground">Ingest Method</Label>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                  <TabsList className="grid grid-cols-4 h-11 p-1 bg-muted/60 border border-border/80 rounded-lg">
                    <TabsTrigger value="text" className="gap-1.5 text-xs font-semibold data-[state=active]:shadow-sm">
                      <FileText className="h-3.5 w-3.5" /> Paste Text
                    </TabsTrigger>
                    <TabsTrigger value="url" className="gap-1.5 text-xs font-semibold data-[state=active]:shadow-sm">
                      <Link2 className="h-3.5 w-3.5" /> Remote URL
                    </TabsTrigger>
                    <TabsTrigger value="file" className="gap-1.5 text-xs font-semibold data-[state=active]:shadow-sm">
                      <Upload className="h-3.5 w-3.5" /> Upload File
                    </TabsTrigger>
                    <TabsTrigger value="presets" className="gap-1.5 text-xs font-semibold data-[state=active]:shadow-sm text-primary">
                      <Zap className="h-3.5 w-3.5" /> Presets
                    </TabsTrigger>
                  </TabsList>

                  {/* TAB 1: PASTE TEXT */}
                  <TabsContent value="text" className="mt-3 space-y-2">
                    <div className="relative rounded-lg border border-border bg-slate-950/40 p-1">
                      <Textarea
                        value={m3uText}
                        onChange={(e) => setM3uText(e.target.value)}
                        placeholder={`#EXTM3U\n#EXTINF:-1 tvg-id="CNN.us" tvg-name="CNN HD" tvg-logo="https://..." group-title="News",CNN HD\nhttps://live.example.com/cnn/index.m3u8\n#EXTINF:-1 tvg-id="HBO.us" tvg-name="HBO Max" group-title="Movies",HBO Max HD\nhttps://live.example.com/hbo/index.m3u8`}
                        className="min-h-[220px] resize-y border-0 bg-transparent font-mono text-xs leading-6 text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
                      />
                      <div className="flex items-center justify-between border-t border-border/60 bg-muted/40 px-3 py-2 text-[11px] font-mono text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{detectedChannelCount}</span> channels detected
                          {m3uText.includes("#EXTM3U") && (
                            <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20 py-0">
                              #EXTM3U Header OK
                            </Badge>
                          )}
                        </div>
                        {m3uText && (
                          <button
                            type="button"
                            onClick={() => setM3uText("")}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  {/* TAB 2: REMOTE URL */}
                  <TabsContent value="url" className="mt-3 space-y-3">
                    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="remote-url" className="text-xs font-medium text-muted-foreground">
                          M3U / M3U8 Public Stream Lineup Endpoint
                        </Label>
                        <div className="relative">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="remote-url"
                            value={m3uUrl}
                            onChange={(e) => handleUrlChange(e.target.value)}
                            placeholder="https://iptv-org.github.io/iptv/countries/us.m3u"
                            className="pl-9 font-mono text-xs h-10"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" /> StreamGuard will securely fetch and parse remote manifests server-side.
                      </p>
                    </div>
                  </TabsContent>

                  {/* TAB 3: FILE DROPZONE */}
                  <TabsContent value="file" className="mt-3">
                    <label
                      className={cn(
                        "flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-all",
                        fileDragging
                          ? "border-primary bg-primary/10"
                          : m3uFile
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/80 bg-muted/20 hover:border-primary/50 hover:bg-muted/30"
                      )}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setFileDragging(true);
                      }}
                      onDragLeave={() => setFileDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setFileDragging(false);
                        const f = e.dataTransfer.files[0];
                        if (f) handleFileChange(f);
                      }}
                    >
                      <input
                        type="file"
                        accept=".m3u,.m3u8,.txt"
                        className="sr-only"
                        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                      />
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-3">
                        <Upload className="h-6 w-6" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        {m3uFile ? m3uFile.name : "Drop your M3U / M3U8 file here"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {m3uFile
                          ? `${(m3uFile.size / 1024).toFixed(1)} KB · Click to choose different file`
                          : "Supports .m3u, .m3u8, or plain text channel rosters"}
                      </p>
                    </label>
                  </TabsContent>

                  {/* TAB 4: CURATED PRESETS */}
                  <TabsContent value="presets" className="mt-3 space-y-3">
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      {CURATED_PRESETS.map((preset) => (
                        <div
                          key={preset.id}
                          onClick={() => handleLoadCuratedPreset(preset)}
                          className="group cursor-pointer rounded-lg border border-border/80 bg-card p-3.5 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-sm"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-foreground group-hover:text-primary">
                              {preset.title}
                            </span>
                            <Badge variant="secondary" className="text-[10px] font-mono">
                              {preset.channelCount} ch
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1.5">
                            {preset.description}
                          </p>
                          <div className="mt-2.5 flex items-center text-[11px] font-medium text-primary">
                            <span>Load into editor</span>
                            <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              {/* ── TUNING & CONCURRENCY DECK ───────────────────────────────── */}
              <div className="space-y-3 border-t border-border/80 pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-primary" />
                    <Label className="text-xs font-semibold text-foreground">
                      Validation Speed & Concurrency Profile
                    </Label>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAdvancedTuning((prev) => !prev)}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showAdvancedTuning ? "Hide Fine-Tuning" : "Custom Tuning"}
                  </Button>
                </div>

                {/* Speed Preset Selector Chips */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SPEED_PRESETS.map((preset) => {
                    const isSelected = selectedSpeedPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectSpeedPreset(preset.id)}
                        className={cn(
                          "flex flex-col items-start rounded-lg border p-2.5 text-left transition-all",
                          isSelected
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border bg-muted/20 hover:border-border/90 hover:bg-muted/30"
                        )}
                      >
                        <div className="flex w-full items-center justify-between">
                          <preset.icon
                            className={cn("h-4 w-4", isSelected ? "text-primary" : "text-muted-foreground")}
                          />
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] px-1 py-0 font-mono",
                              isSelected ? "border-primary/40 text-primary" : "text-muted-foreground"
                            )}
                          >
                            {preset.badge}
                          </Badge>
                        </div>
                        <span className="font-semibold text-xs text-foreground mt-1.5">{preset.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono mt-0.5">{preset.desc}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Fine-Grained Advanced Parameters */}
                {(showAdvancedTuning || selectedSpeedPreset === "custom") && (
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4 animate-rise">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-2">
                        <Label htmlFor="concurrency-slider" className="font-semibold">
                          Parallel Worker Lanes:
                        </Label>
                        <span className="font-mono font-bold text-primary text-sm">
                          {concurrency[0]} simultaneous workers
                        </span>
                      </div>
                      <Slider
                        id="concurrency-slider"
                        min={1}
                        max={100}
                        step={1}
                        value={concurrency}
                        onValueChange={(val) => {
                          setConcurrency(val);
                          setSelectedSpeedPreset("custom");
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        High concurrency accelerates passes through extensive M3U lists.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="to-input" className="text-[11px] text-muted-foreground">
                          Timeout (ms)
                        </Label>
                        <Input
                          id="to-input"
                          type="number"
                          value={timeoutMs}
                          onChange={(e) => {
                            setTimeoutMs(e.target.value);
                            setSelectedSpeedPreset("custom");
                          }}
                          className="font-mono text-xs h-8"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="ret-input" className="text-[11px] text-muted-foreground">
                          Retry Attempts
                        </Label>
                        <Input
                          id="ret-input"
                          type="number"
                          value={retryCount}
                          onChange={(e) => {
                            setRetryCount(e.target.value);
                            setSelectedSpeedPreset("custom");
                          }}
                          className="font-mono text-xs h-8"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="ph-input" className="text-[11px] text-muted-foreground">
                          Per-Host Limit
                        </Label>
                        <Input
                          id="ph-input"
                          type="number"
                          value={perHostConcurrency}
                          onChange={(e) => {
                            setPerHostConcurrency(e.target.value);
                            setSelectedSpeedPreset("custom");
                          }}
                          className="font-mono text-xs h-8"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                      <div>
                        <Label className="text-xs font-semibold">Deep FFprobe Stream Inspection</Label>
                        <p className="text-[11px] text-muted-foreground">
                          Extract resolution, video bitrate, audio codecs, and framerate.
                        </p>
                      </div>
                      <Switch checked={autoProbe} onCheckedChange={setAutoProbe} />
                    </div>
                  </div>
                )}
              </div>

              {/* Launch Validation Action Button */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/80 pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Flame className="h-4 w-4 text-amber-500" />
                  <span>
                    Ready to check at <strong className="text-foreground font-mono">{concurrency[0]} lanes</strong>
                  </span>
                </div>

                <Button
                  size="lg"
                  onClick={handleRunCheck}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto font-bold gap-2 text-sm shadow-md bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  {isSubmitting ? "Initiating Pass..." : "Launch Validation Pass"}
                  <span className="hidden sm:inline text-[10px] font-mono opacity-70 ml-1">⌘+Enter</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Playlist Shelf */}
          {topPlaylists.length > 0 && (
            <Card className="border-border/80 bg-card/80 shadow-sm">
              <CardHeader className="p-4 sm:p-5 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    <CardTitle className="font-display text-base font-bold">
                      Saved Playlist Library
                    </CardTitle>
                  </div>
                  <Link href="/playlists" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                    View All ({playlists?.length}) <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="p-4 sm:p-5 pt-0">
                <div className="grid gap-2 sm:grid-cols-2">
                  {topPlaylists.map((pl) => (
                    <Link
                      key={pl.id}
                      href={`/playlists/${pl.id}`}
                      className="group flex items-center justify-between rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/50 hover:bg-muted/20"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-xs text-foreground group-hover:text-primary truncate">
                          {pl.name}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                          {pl.entryCount.toLocaleString()} channels · {pl.groups.length} groups
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase font-mono shrink-0 ml-2">
                        {pl.sourceType}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── RIGHT: FLIGHT RECORDER & LIVE TELEMETRY ───────────────────────── */}
        <div className="space-y-6">
          {/* Flight Recorder (Recent Passes) */}
          <Card className="border-border/80 bg-card/90 shadow-md">
            <CardHeader className="border-b border-border/70 bg-muted/30 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground font-semibold uppercase">
                    <Terminal className="h-3.5 w-3.5 text-primary" /> FLIGHT RECORDER // RECENT PASSES
                  </div>
                  <CardTitle className="font-display text-xl font-bold mt-1">
                    Validation Activity
                  </CardTitle>
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  {jobs?.length ?? 0} runs logged
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-5 space-y-3">
              {jobsLoading ? (
                <div className="space-y-3 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/60" />
                  ))}
                </div>
              ) : jobsError ? (
                <div className="p-8 text-center text-xs text-destructive">
                  <XCircle className="h-6 w-6 mx-auto mb-2" />
                  Failed to load flight recorder logs.
                </div>
              ) : recentJobs.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground mx-auto">
                    <Activity className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-sm text-foreground">No validation jobs yet</h3>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    Load a playlist using the ingest station on the left to start your first real-time health check pass.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentJobs.map((job) => {
                    const isRunning = job.status === "running" || job.status === "paused";
                    const isCompleted = job.status === "completed";
                    const percent = job.total > 0 ? Math.round((job.checked / job.total) * 100) : 0;

                    return (
                      <Link
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        className="group block rounded-xl border border-border/80 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-primary">
                                #{String(job.id).padStart(4, "0")}
                              </span>
                              <p className="font-semibold text-sm text-foreground group-hover:text-primary truncate">
                                {job.playlistName}
                              </p>
                            </div>
                            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                              {new Date(job.createdAt).toLocaleDateString()} at{" "}
                              {new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>

                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-mono capitalize",
                              isRunning && "border-indigo-500/40 bg-indigo-500/10 text-indigo-500 animate-pulse",
                              isCompleted && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
                              job.status === "failed" && "border-rose-500/40 bg-rose-500/10 text-rose-500"
                            )}
                          >
                            {job.status}
                          </Badge>
                        </div>

                        {/* Progress Bar */}
                        <div className="mt-3 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                            <span>
                              {job.checked}/{job.total} streams ({percent}%)
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-500 font-semibold">{job.live} Live</span>
                              {job.dead > 0 && <span className="text-rose-500 font-semibold">{job.dead} Dead</span>}
                            </div>
                          </div>

                          <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-300",
                                isRunning ? "bg-indigo-500" : "bg-primary"
                              )}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>

                        {isRunning && (
                          <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                            <span className="flex items-center gap-1 text-indigo-500">
                              <Activity className="h-3 w-3 animate-spin" /> Live Scanning...
                            </span>
                            <span>ETA: {job.etaSeconds != null ? formatTime(job.etaSeconds) : "Calculating..."}</span>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stream Scratchpad Mini Bench */}
          <Card className="border-border/80 bg-card/90 shadow-md">
            <CardHeader className="p-4 sm:p-5 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-primary" />
                  <CardTitle className="font-display text-base font-bold">
                    Instant Stream Scratchpad
                  </CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">
                  CORS Bypass Active
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Test any single HLS (.m3u8), DASH, or MP4 link directly in your browser.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 pt-0 space-y-3">
              <div className="space-y-2">
                <Input
                  value={scratchpadUrl}
                  onChange={(e) => setScratchpadUrl(e.target.value)}
                  placeholder="https://server.com/live/stream.m3u8"
                  className="font-mono text-xs h-9"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (!scratchpadUrl.trim()) {
                      toast.error("Enter a stream URL to play");
                      return;
                    }
                    setScratchpadActiveUrl(scratchpadUrl.trim());
                  }}
                  className="w-full h-8 text-xs font-semibold gap-1.5"
                >
                  <Play className="h-3.5 w-3.5 fill-current" /> Test Stream Playback
                </Button>
              </div>

              {scratchpadActiveUrl && (
                <div className="rounded-lg border border-border bg-slate-950/80 p-2 space-y-2 animate-rise">
                  <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground px-1">
                    <span className="truncate max-w-[220px]">{scratchpadActiveUrl}</span>
                    <button
                      onClick={() => setScratchpadActiveUrl("")}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Close
                    </button>
                  </div>
                  <StreamPlayer
                    key={scratchpadActiveUrl}
                    url={scratchpadActiveUrl}
                    userAgent={scratchpadUa}
                    title="Scratchpad Stream"
                    autoPlay={true}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── MODAL: FULL QUICK STREAM TESTER ───────────────────────────────── */}
      <Dialog open={scratchpadOpen} onOpenChange={setScratchpadOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Tv2 className="h-5 w-5 text-primary" /> Single Stream Diagnostic Bench
            </DialogTitle>
            <DialogDescription>
              Test playback, simulate custom User-Agent headers, and verify CORS relay functionality.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="sp-url" className="text-xs">Stream URL (HLS / MP4 / DASH)</Label>
              <Input
                id="sp-url"
                value={scratchpadUrl}
                onChange={(e) => setScratchpadUrl(e.target.value)}
                placeholder="https://server.com/live/master.m3u8"
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-ua" className="text-xs">Simulated User-Agent (Optional)</Label>
              <Input
                id="sp-ua"
                value={scratchpadUa}
                onChange={(e) => setScratchpadUa(e.target.value)}
                placeholder="e.g. VLC/3.0.18 or TiviMate/4.7.0"
                className="font-mono text-xs"
              />
            </div>

            {scratchpadUrl.trim() && (
              <div className="rounded-lg border border-border bg-slate-950/80 p-3 space-y-2">
                <StreamPlayer
                  url={scratchpadUrl.trim()}
                  userAgent={scratchpadUa}
                  title="Stream Diagnostics"
                  autoPlay={false}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
