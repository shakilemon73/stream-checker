import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { io } from "socket.io-client";
import { z } from "zod";
import {
  useGetJob,
  useGetJobResults,
  useGetJobCategories,
  usePauseJob,
  useResumeJob,
  useCancelJob,
  useProbeChannels,
  getGetJobQueryKey,
  getGetJobCategoriesQueryKey,
  getGetJobResultsQueryKey,
  ChannelResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatMs, formatTime, cn, triggerApiDownload } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Pause,
  XCircle,
  Download,
  Search,
  SearchCode,
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  Activity,
  ArrowLeft,
  Loader2,
  Image as ImageIcon,
  Copy,
  Check,
  ClipboardList,
  X as XIcon,
  Radio,
  Sparkles,
  Zap,
  Globe,
  HardDrive,
  ShieldCheck,
  ShieldAlert,
  Tv2,
  Gauge,
  Terminal,
  ExternalLink,
  Clock,
  CheckCircle2,
  RotateCcw,
  Filter,
  FileText,
  Layers,
  Edit2,
  Save,
  AlertCircle,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { StreamPlayer } from "@/components/stream-player";

const USER_AGENT_PRESETS = [
  { label: "Default Browser (StreamGuard Relay)", value: "" },
  { label: "VLC Media Player", value: "VLC/3.0.18 LibVLC/3.0.18" },
  { label: "TiviMate IPTV Player", value: "TiviMate/4.7.0 (Android TV)" },
  { label: "OTT Navigator", value: "OTT Navigator/1.6.8.5" },
  { label: "Apple TV / QuickTime", value: "AppleCoreMedia/1.0.0.20K67 (Apple TV; U; CPU OS 16_5 like Mac OS X)" },
  { label: "Smart IPTV (SIPTV)", value: "Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/538.1+ SmartIPTV" },
  { label: "Kodi Media Center", value: "Kodi/20.1 (Windows NT 10.0; Win64; x64) App_Bitness/64 Version/20.1-Git:20230312-32626e5" },
  { label: "Chrome Desktop", value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
];

// Status color mapping for chips
const statusColors = {
  live: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  dead: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  geoblocked: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  suspicious: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  pending: "bg-muted text-muted-foreground border-muted-foreground/20",
};

export default function JobMonitor() {
  const [, params] = useRoute("/jobs/:id");
  const jobId = parseInt(params?.id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pauseJob = usePauseJob();
  const resumeJob = useResumeJob();
  const cancelJob = useCancelJob();
  const probeChannels = useProbeChannels();

  const {
    data: job,
    isLoading: jobLoading,
    isError: jobError,
  } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobQueryKey(jobId) },
  });

  const { data: initialCategories } = useGetJobCategories(jobId, {
    query: {
      enabled:
        !!jobId && (job?.status === "completed" || job?.status === "cancelled"),
      queryKey: getGetJobCategoriesQueryKey(jobId),
    },
  });

  // State for live updates via WebSocket
  const [liveStats, setLiveStats] = useState({
    checked: 0,
    live: 0,
    dead: 0,
    geoblocked: 0,
    suspicious: 0,
    pending: 0,
    etaSeconds: null as number | null,
    avgCheckMs: null as number | null,
  });
  const [liveStatus, setLiveStatus] = useState<string>("queued");

  // Results and categories from socket
  const [socketResults, setSocketResults] = useState<ChannelResult[]>([]);
  const [socketCategories, setSocketCategories] = useState<
    Record<string, { total: number; live: number; dead: number }>
  >({});

  // Filtering & Sorting
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("status");
  const [sortDir, setSortDir] = useState<string>("desc");

  // Drawer state & channel edit modal form
  const [selectedResult, setSelectedResult] = useState<ChannelResult | null>(
    null
  );
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingResult, setEditingResult] = useState<ChannelResult | null>(null);
  const [activeDrawerTab, setActiveDrawerTab] = useState<string>("telemetry");
  const [editForm, setEditForm] = useState({
    tvgName: "",
    category: "",
    tvgLogo: "",
    url: "",
    status: "live",
    userAgent: "",
    referrer: "",
  });
  const [channelTouched, setChannelTouched] = useState<Record<string, boolean>>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Real-time Zod validation schema matching playlist-detail.tsx
  const channelValidation = useMemo(() => {
    const channelSchema = z.object({
      tvgName: z
        .string()
        .trim()
        .min(1, "Channel name is required")
        .max(120, "Channel name must be 120 characters or less"),
      url: z
        .string()
        .trim()
        .min(1, "Streaming link / URL is required")
        .refine(
          (val) => /^https?:\/\/.+/i.test(val),
          "Streaming URL must start with http:// or https://"
        ),
      tvgLogo: z
        .string()
        .trim()
        .refine(
          (val) => !val || /^https?:\/\/.+/i.test(val) || /^data:image\//i.test(val),
          "Logo must be a valid http:// or https:// URL"
        ),
      referrer: z
        .string()
        .trim()
        .refine(
          (val) => !val || /^https?:\/\/.+/i.test(val),
          "Referrer must start with http:// or https://"
        ),
      category: z.string().trim(),
      status: z.string().trim(),
    });

    const res = channelSchema.safeParse(editForm);
    const errors: Record<string, string> = {};
    if (!res.success) {
      for (const issue of res.error.issues) {
        const field = String(issue.path[0] || "tvgName");
        if (!errors[field]) {
          errors[field] = issue.message;
        }
      }
    }
    return {
      isValid: res.success,
      errors,
    };
  }, [editForm]);

  // Open edit modal for any result
  const openEditModal = (result: ChannelResult) => {
    setEditingResult(result);
    setEditForm({
      tvgName: result.tvgName || "",
      category: result.category || "",
      tvgLogo: result.tvgLogo || "",
      url: result.url || "",
      status: result.status || "live",
      userAgent: "",
      referrer: "",
    });
    setChannelTouched({});
    setEditModalOpen(true);
  };

  // Sync edit form whenever selectedResult changes in drawer
  useEffect(() => {
    if (selectedResult) {
      setEditForm({
        tvgName: selectedResult.tvgName || "",
        category: selectedResult.category || "",
        tvgLogo: selectedResult.tvgLogo || "",
        url: selectedResult.url || "",
        status: selectedResult.status || "live",
        userAgent: "",
        referrer: "",
      });
      setChannelTouched({});
      setActiveDrawerTab("telemetry");
    }
  }, [selectedResult]);

  // Copy / batch-select state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<
    number | "batch-url" | "batch-m3u" | null
  >(null);

  const copyText = useCallback(
    (text: string, id: number | "batch-url" | "batch-m3u") => {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
      });
    },
    []
  );

  const toggleSelect = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Load complete results if job is done
  const isFinished =
    liveStatus === "completed" ||
    liveStatus === "cancelled" ||
    liveStatus === "failed";
  const resultsParams = {
    page: 1,
    limit: 10000,
    search,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    status: statusFilter.join(","),
    sortBy,
    sortDir,
  };
  const { data: apiResults, isLoading: resultsLoading } = useGetJobResults(
    jobId,
    resultsParams,
    {
      query: {
        enabled: !!jobId && isFinished,
        queryKey: getGetJobResultsQueryKey(jobId, resultsParams),
      },
    }
  );

  // Sync initial stats once
  const initialSyncedRef = useRef(false);
  useEffect(() => {
    if (job && !initialSyncedRef.current) {
      initialSyncedRef.current = true;
      setLiveStats({
        checked: job.checked,
        live: job.live,
        dead: job.dead,
        geoblocked: job.geoblocked,
        suspicious: job.suspicious,
        pending: job.pending,
        etaSeconds: job.etaSeconds ?? null,
        avgCheckMs: job.avgCheckMs ?? null,
      });
      setLiveStatus(job.status);
    }
  }, [job]);

  // Setup WebSocket
  useEffect(() => {
    if (!jobId) return;

    const socket = io({
      path: "/api/socket.io",
      transports: ["polling", "websocket"],
    });
    socket.emit("subscribe", { jobId });

    socket.on("job:progress", (data) => {
      setLiveStats((prev) => ({ ...prev, ...data }));
    });

    socket.on("job:status", (data) => {
      setLiveStatus(data.status);
      queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/results`] });
    });

    socket.on(
      "job:result",
      (data: { jobId: number; result: ChannelResult }) => {
        setSocketResults((prev) => [data.result, ...prev].slice(0, 10000));

        const cat = data.result.category || "Uncategorized";
        setSocketCategories((prev) => {
          const existing = prev[cat] || { total: 0, live: 0, dead: 0 };
          return {
            ...prev,
            [cat]: {
              total: existing.total + 1,
              live: existing.live + (data.result.status === "live" ? 1 : 0),
              dead: existing.dead + (data.result.status === "dead" ? 1 : 0),
            },
          };
        });
      }
    );

    return () => {
      socket.disconnect();
    };
  }, [jobId, queryClient]);

  // Determine which results to show
  const displayResults = useMemo(() => {
    if (isFinished && apiResults?.results) {
      return apiResults.results;
    }

    // Client-side filtering for live socket results
    let filtered = socketResults;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          (r.tvgName || "").toLowerCase().includes(lowerSearch) ||
          r.url.toLowerCase().includes(lowerSearch)
      );
    }
    if (statusFilter.length > 0) {
      filtered = filtered.filter((r) => statusFilter.includes(r.status));
    }
    if (categoryFilter !== "all") {
      filtered = filtered.filter((r) => r.category === categoryFilter);
    }

    const STATUS_ORDER: Record<string, number> = {
      live: 0,
      suspicious: 1,
      geoblocked: 2,
      dead: 3,
      pending: 4,
    };
    filtered = [...filtered].sort((a, b) => {
      let valA: any = a[sortBy as keyof ChannelResult];
      let valB: any = b[sortBy as keyof ChannelResult];

      if (sortBy === "status") {
        const pa = STATUS_ORDER[valA as string] ?? 5;
        const pb = STATUS_ORDER[valB as string] ?? 5;
        return sortDir === "asc" ? pa - pb : pb - pa;
      }

      if (valA == null) valA = "";
      if (valB == null) valB = "";

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [
    isFinished,
    apiResults,
    socketResults,
    search,
    statusFilter,
    categoryFilter,
    sortBy,
    sortDir,
  ]);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === displayResults.length
        ? new Set()
        : new Set(displayResults.map((r) => r.id))
    );
  }, [displayResults]);

  const copyBatchUrls = useCallback(() => {
    const urls = displayResults
      .filter((r) => selectedIds.has(r.id))
      .map((r) => r.url)
      .join("\n");
    copyText(urls, "batch-url");
  }, [displayResults, selectedIds, copyText]);

  const copyBatchM3U = useCallback(() => {
    const lines = ["#EXTM3U"];
    displayResults
      .filter((r) => selectedIds.has(r.id))
      .forEach((r) => {
        const attrs = [
          r.tvgName ? `tvg-name="${r.tvgName}"` : "",
          r.tvgLogo ? `tvg-logo="${r.tvgLogo}"` : "",
          r.category ? `group-title="${r.category}"` : "",
        ]
          .filter(Boolean)
          .join(" ");
        lines.push(`#EXTINF:-1 ${attrs},${r.tvgName || r.url}`);
        lines.push(r.url);
      });
    copyText(lines.join("\n"), "batch-m3u");
  }, [displayResults, selectedIds, copyText]);

  const categoriesList = useMemo(() => {
    if (isFinished && initialCategories) {
      return initialCategories.map((c) => ({
        name: c.category,
        total: c.total,
        live: c.live,
        dead: c.dead,
      }));
    }
    return Object.entries(socketCategories)
      .map(([name, stats]) => ({
        name,
        ...stats,
      }))
      .sort((a, b) => b.total - a.total);
  }, [isFinished, initialCategories, socketCategories]);

  // Virtualizer for table
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: displayResults.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 12,
  });

  const toggleStatusFilter = (status: string) => {
    if (status === "all") {
      setStatusFilter([]);
      return;
    }
    setStatusFilter((prev) =>
      prev.length === 1 && prev[0] === status ? [] : [status]
    );
  };

  const handleDeepProbe = () => {
    if (selectedResult) {
      probeChannels.mutate(
        { id: jobId, data: { resultIds: [selectedResult.id] } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getGetJobQueryKey(jobId),
            });
            queryClient.invalidateQueries({
              queryKey: getGetJobResultsQueryKey(jobId, resultsParams),
            });
            queryClient.invalidateQueries({
              queryKey: ["/jobs", jobId, "results"],
            });
            toast({
              title: "FFprobe Inspection Complete",
              description: "Codec and stream parameters updated.",
            });
          },
        }
      );
    }
  };

  const handleSaveChannelDetails = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const target = editingResult || selectedResult;
    if (!target) return;

    setChannelTouched({
      tvgName: true,
      url: true,
      tvgLogo: true,
      referrer: true,
    });

    if (!channelValidation.isValid) {
      const firstErr =
        Object.values(channelValidation.errors)[0] || "Please resolve validation errors";
      toast({
        title: "Validation Error",
        description: firstErr,
        variant: "destructive",
      });
      return;
    }

    setIsSavingEdit(true);

    try {
      const res = await fetch(`/api/results/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tvgName: editForm.tvgName,
          category: editForm.category,
          tvgLogo: editForm.tvgLogo,
          url: editForm.url,
          status: editForm.status,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to save channel details");
      }

      const updated = await res.json();
      if (selectedResult && selectedResult.id === updated.id) {
        setSelectedResult(updated);
      }
      queryClient.invalidateQueries({
        queryKey: getGetJobResultsQueryKey(jobId, resultsParams),
      });
      queryClient.invalidateQueries({
        queryKey: ["/jobs", jobId, "results"],
      });

      toast({
        title: "Channel Details Saved",
        description: `Successfully updated ${updated.tvgName || "channel"}.`,
      });

      setEditModalOpen(false);
      setEditingResult(null);
      setActiveDrawerTab("telemetry");
    } catch (err: any) {
      toast({
        title: "Update Failed",
        description: err.message || "Could not save channel changes.",
        variant: "destructive",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (!jobId || jobLoading) {
    return (
      <div className="mx-auto w-full max-w-[1580px] space-y-6 p-6">
        <div className="h-16 w-80 animate-pulse rounded-xl bg-muted/60" />
        <div className="h-28 animate-pulse rounded-xl bg-muted/60" />
        <div className="h-[65vh] animate-pulse rounded-xl bg-muted/60" />
      </div>
    );
  }
  if (jobError || !job) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <XCircle className="mx-auto mb-4 h-12 w-12 text-rose-500" />
        <h1 className="font-display text-2xl font-bold">
          Validation Pass Offline
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This validation job may have been purged or the signal stream has timed
          out.
        </p>
        <Button
          variant="outline"
          className="mt-6 gap-2"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="h-4 w-4" /> Return to Ingest Deck
        </Button>
      </div>
    );
  }

  const totalChannels = job?.total || 0;
  const progressPercent =
    totalChannels > 0 ? (liveStats.checked / totalChannels) * 100 : 0;
  const livePercent =
    liveStats.checked > 0 ? (liveStats.live / liveStats.checked) * 100 : 0;

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col overflow-hidden bg-background lg:min-h-[100dvh]">
      {/* ── BROADCAST OPERATIONS COMMAND HEADER ────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-border/80 bg-gradient-to-b from-card via-card/95 to-card/90 backdrop-blur shadow-sm relative overflow-hidden">
        {/* Subtle decorative background glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.05),transparent_60%)]" />

        <div className="flex flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 relative">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Title & Status Badge */}
            <div className="flex items-center gap-3.5 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/")}
                className="h-10 w-10 shrink-0 rounded-xl border border-border/80 bg-background/80 hover:bg-muted shadow-xs transition-colors"
                title="Back to Control Room"
              >
                <ArrowLeft className="h-5 w-5 text-foreground" />
              </Button>

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">
                    PASS #{String(jobId).padStart(4, "0")}
                  </span>
                  <span className="text-muted-foreground/60">/</span>
                  <span className="text-muted-foreground truncate font-medium">{job?.playlistName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <h1 className="truncate font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                    {job?.playlistName || "Live Stream Audit"}
                  </h1>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-xs uppercase px-3 py-1 font-bold tracking-wider shrink-0 shadow-xs",
                      liveStatus === "running"
                        ? "bg-primary/10 text-primary border-primary/30 animate-pulse"
                        : liveStatus === "completed"
                        ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                        : liveStatus === "paused"
                        ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                        : "bg-rose-500/15 text-rose-500 border-rose-500/30"
                    )}
                  >
                    {liveStatus === "running" && (
                      <span className="relative flex h-2 w-2 mr-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                    {liveStatus === "running" ? "SCANNING ACTIVE" : liveStatus}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Tactical Live Counters & Action Triggers */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 lg:ml-auto">
              {/* Telemetry Micro-Pills */}
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2 rounded-xl border border-border/80 bg-background/80 p-1.5 sm:p-2 font-mono text-xs shadow-xs">
                <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="text-[9px] uppercase font-bold tracking-widest opacity-80">Verified</span>
                  <span className="font-bold text-sm sm:text-base leading-none mt-0.5">{liveStats.live.toLocaleString()}</span>
                </div>
                <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  <span className="text-[9px] uppercase font-bold tracking-widest opacity-80">Warn</span>
                  <span className="font-bold text-sm sm:text-base leading-none mt-0.5">{liveStats.suspicious.toLocaleString()}</span>
                </div>
                <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <span className="text-[9px] uppercase font-bold tracking-widest opacity-80">Geoblock</span>
                  <span className="font-bold text-sm sm:text-base leading-none mt-0.5">{liveStats.geoblocked.toLocaleString()}</span>
                </div>
                <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                  <span className="text-[9px] uppercase font-bold tracking-widest opacity-80">Dead</span>
                  <span className="font-bold text-sm sm:text-base leading-none mt-0.5">{liveStats.dead.toLocaleString()}</span>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="flex items-center gap-2">
                {liveStatus === "running" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => pauseJob.mutate({ id: jobId })}
                      disabled={pauseJob.isPending}
                      className="h-9 gap-1.5 font-semibold text-xs border-border/80 bg-background hover:bg-muted shadow-xs"
                    >
                      <Pause className="h-3.5 w-3.5 text-amber-500" /> Pause
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => cancelJob.mutate({ id: jobId })}
                      disabled={cancelJob.isPending}
                      className="h-9 gap-1.5 font-semibold text-xs shadow-xs"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Abort
                    </Button>
                  </>
                )}
                {liveStatus === "paused" && (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => resumeJob.mutate({ id: jobId })}
                      disabled={resumeJob.isPending}
                      className="h-9 gap-1.5 font-semibold text-xs bg-primary text-primary-foreground shadow-xs"
                    >
                      <Play className="h-3.5 w-3.5" /> Resume
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => cancelJob.mutate({ id: jobId })}
                      disabled={cancelJob.isPending}
                      className="h-9 gap-1.5 font-semibold text-xs shadow-xs"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Abort
                    </Button>
                  </>
                )}
                {isFinished && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          toast({ title: "Preparing Clean M3U export..." });
                          await triggerApiDownload(
                            `/api/jobs/${jobId}/export?format=m3u&status=live`,
                            `job_${jobId}_clean.m3u8`
                          );
                          toast({ title: "Clean M3U downloaded!" });
                        } catch (err) {
                          toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" });
                        }
                      }}
                      className="h-9 gap-1.5 font-semibold text-xs border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 transition-all shadow-xs"
                    >
                      <Download className="h-3.5 w-3.5" /> Export Clean M3U
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          toast({ title: "Preparing CSV report..." });
                          await triggerApiDownload(
                            `/api/jobs/${jobId}/export?format=csv`,
                            `job_${jobId}_report.csv`
                          );
                          toast({ title: "CSV Report downloaded!" });
                        } catch (err) {
                          toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" });
                        }
                      }}
                      className="h-9 gap-1.5 font-semibold text-xs border-border/80 bg-background hover:bg-muted shadow-xs"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" /> CSV Report
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Operational Multi-Segmented Progress Bar & Realtime Metrics */}
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center justify-between text-xs font-mono text-muted-foreground gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">
                  {liveStats.checked.toLocaleString()} / {totalChannels.toLocaleString()} Inspected
                </span>
                <span className="text-muted-foreground/60">•</span>
                <span className="font-semibold text-primary">
                  {progressPercent.toFixed(1)}% Completed
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                {liveStats.etaSeconds != null && liveStatus === "running" && (
                  <span className="flex items-center gap-1.5 text-primary font-semibold bg-primary/10 px-2.5 py-0.5 rounded-full border border-primary/20">
                    <Zap className="h-3 w-3 animate-pulse text-amber-500" /> ETA: {formatTime(liveStats.etaSeconds)}
                  </span>
                )}
                {liveStats.avgCheckMs != null && (
                  <span className="hidden sm:flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" /> Latency: <strong className="text-foreground">{Math.round(liveStats.avgCheckMs)}ms</strong>
                  </span>
                )}
                <span className="font-bold text-emerald-500 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {livePercent.toFixed(1)}% Signal Quality
                </span>
              </div>
            </div>

            {/* Multi-Segment Ribbon Progress Bar */}
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/60 flex relative shadow-inner">
              {totalChannels > 0 && (
                <>
                  {/* Verified Live Segment */}
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${(liveStats.live / totalChannels) * 100}%` }}
                    title={`Verified Live: ${liveStats.live}`}
                  />
                  {/* Warn / Suspicious Segment */}
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${(liveStats.suspicious / totalChannels) * 100}%` }}
                    title={`Warnings: ${liveStats.suspicious}`}
                  />
                  {/* Geoblocked Segment */}
                  <div
                    className="h-full bg-amber-500 transition-all duration-300"
                    style={{ width: `${(liveStats.geoblocked / totalChannels) * 100}%` }}
                    title={`Geoblocked: ${liveStats.geoblocked}`}
                  />
                  {/* Dead Segment */}
                  <div
                    className="h-full bg-rose-500 transition-all duration-300"
                    style={{ width: `${(liveStats.dead / totalChannels) * 100}%` }}
                    title={`Dead Stream: ${liveStats.dead}`}
                  />
                  {/* Pending Segment */}
                  {liveStatus === "running" && (
                    <div
                      className="h-full bg-primary/30 transition-all duration-300 animate-pulse"
                      style={{
                        width: `${Math.max(
                          0,
                          100 -
                            ((liveStats.live + liveStats.suspicious + liveStats.geoblocked + liveStats.dead) /
                              totalChannels) *
                              100
                        )}%`,
                      }}
                      title="Pending Inspection"
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── WORKSPACE BODY WITH SIDEBAR & TABLE ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT SIDEBAR: CATEGORY SPECTRUM MONITOR */}
        <div className="hidden w-72 flex-col border-r border-border/80 bg-muted/20 lg:flex">
          <div className="flex items-center justify-between border-b border-border/80 bg-muted/40 p-4">
            <span className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-primary" /> Group Telemetry
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {categoriesList.length} groups
            </span>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1.5">
              <button
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all flex justify-between items-center",
                  categoryFilter === "all"
                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                    : "text-foreground hover:bg-muted/70"
                )}
                onClick={() => setCategoryFilter("all")}
              >
                <span>All Categories</span>
                <span className="font-mono text-xs opacity-80">{totalChannels}</span>
              </button>

              {categoriesList.map((cat) => (
                <button
                  key={cat.name}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all group",
                    categoryFilter === cat.name
                      ? "bg-card border border-primary/40 shadow-sm text-foreground font-semibold"
                      : "text-foreground hover:bg-muted/60"
                  )}
                  onClick={() => setCategoryFilter(cat.name)}
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="truncate pr-2 font-medium" title={cat.name}>
                      {cat.name || "Uncategorized"}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {cat.total}
                    </span>
                  </div>
                  {cat.total > 0 && (
                    <div className="h-1.5 w-full bg-muted/80 overflow-hidden flex rounded-full">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${(cat.live / cat.total) * 100}%` }}
                      />
                      <div
                        className="h-full bg-rose-500"
                        style={{ width: `${(cat.dead / cat.total) * 100}%` }}
                      />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* MAIN AUDIT STREAM RESULTS TABLE */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {/* Batch action banner (when channels selected) */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/30 text-xs font-mono">
              <span className="font-bold text-primary">
                {selectedIds.size} stream{selectedIds.size > 1 ? "s" : ""} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 font-semibold bg-background"
                onClick={copyBatchUrls}
              >
                {copiedId === "batch-url" ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" /> Copied URLs!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy URLs
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 font-semibold bg-background"
                onClick={copyBatchM3U}
              >
                {copiedId === "batch-m3u" ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" /> Copied M3U!
                  </>
                ) : (
                  <>
                    <ClipboardList className="h-3 w-3" /> Copy as M3U
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                <XIcon className="h-3 w-3" /> Clear
              </Button>
            </div>
          )}

          {/* Table Filters & Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-card/60 p-3.5 sm:px-6 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
              {/* Select All master toggle */}
              <button
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-input bg-background transition-colors hover:border-primary shadow-xs"
                onClick={toggleSelectAll}
                title={
                  selectedIds.size === displayResults.length &&
                  displayResults.length > 0
                    ? "Deselect all"
                    : "Select all"
                }
              >
                {selectedIds.size > 0 &&
                  selectedIds.size === displayResults.length && (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                {selectedIds.size > 0 &&
                  selectedIds.size < displayResults.length && (
                    <div className="h-2 w-2 rounded-sm bg-primary" />
                  )}
              </button>

              {/* Search input with shortcut badge */}
              <div className="relative w-full sm:w-80">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search stream name, URL, or channel ID..."
                  className="h-9 bg-background pl-9 pr-8 font-mono text-xs rounded-lg border-border/80 shadow-xs focus-visible:ring-primary/40"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search ? (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
                    /
                  </kbd>
                )}
              </div>

              {/* Interactive Status Filter Pills with Counts */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => toggleStatusFilter("all")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono font-semibold transition-all select-none shadow-xs shrink-0",
                    statusFilter.length === 0
                      ? "bg-primary text-primary-foreground border-primary font-bold"
                      : "border-border/80 bg-background/80 text-muted-foreground hover:text-foreground"
                  )}
                >
                  ALL ({totalChannels.toLocaleString()})
                </button>

                {[
                  { id: "live", label: "LIVE", count: liveStats.live, color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" },
                  { id: "suspicious", label: "WARN", count: liveStats.suspicious, color: "text-indigo-500 border-indigo-500/30 bg-indigo-500/10" },
                  { id: "geoblocked", label: "GEOBLOCK", count: liveStats.geoblocked, color: "text-amber-500 border-amber-500/30 bg-amber-500/10" },
                  { id: "dead", label: "DEAD", count: liveStats.dead, color: "text-rose-500 border-rose-500/30 bg-rose-500/10" },
                  { id: "pending", label: "PENDING", count: Math.max(0, totalChannels - liveStats.checked), color: "text-slate-500 border-slate-500/30 bg-slate-500/10" },
                ].map((item) => {
                  const isActive = statusFilter.length === 1 && statusFilter[0] === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggleStatusFilter(item.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono font-semibold transition-all select-none shadow-xs shrink-0",
                        isActive
                          ? item.color + " font-bold ring-2 ring-primary/30"
                          : "border-border/80 bg-background/80 text-muted-foreground hover:border-primary/40 hover:text-foreground opacity-70 hover:opacity-100"
                      )}
                    >
                      <span>{item.label}</span>
                      <span className="rounded bg-muted/80 px-1 py-0.2 text-[10px] font-mono">
                        {item.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sorting controls */}
            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-36 h-9 text-xs font-mono rounded-lg border-border/80 bg-background shadow-xs">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">Status Priority</SelectItem>
                  <SelectItem value="tvgName">Channel Name</SelectItem>
                  <SelectItem value="responseTimeMs">Latency (ms)</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg border-border/80 bg-background shadow-xs"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                aria-label="Toggle sort direction"
                title={sortDir === "asc" ? "Ascending order" : "Descending order"}
              >
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>

          {/* Virtualized Stream Results Grid */}
          <div ref={parentRef} className="relative flex-1 overflow-auto bg-background/50">
            {displayResults.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-6">
                {resultsLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : (
                  <>
                    <SearchCode className="h-12 w-12 mb-3 opacity-25" />
                    <p className="text-sm font-medium">No stream channels matched current filters</p>
                    <p className="text-xs text-muted-foreground mt-1">Try clearing status or search filters</p>
                  </>
                )}
              </div>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const result = displayResults[virtualItem.index];
                  const colorClass =
                    statusColors[result.status as keyof typeof statusColors];
                  const isChecked = selectedIds.has(result.id);
                  const isCopied = copiedId === result.id;

                  return (
                    <div
                      key={virtualItem.key}
                      className={cn(
                        "absolute left-0 top-0 flex w-full items-center border-b border-border/70 px-3 sm:px-6 transition-colors group cursor-pointer",
                        isChecked ? "bg-primary/5" : "hover:bg-muted/40"
                      )}
                      style={{
                        height: `${virtualItem.size}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      onClick={() => setSelectedResult(result)}
                    >
                      {/* Checkbox */}
                      <div
                        className="w-6 shrink-0 flex items-center mr-2.5"
                        onClick={(e) => toggleSelect(result.id, e)}
                      >
                        <div
                          className={cn(
                            "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                            isChecked
                              ? "bg-primary border-primary"
                              : "border-input bg-background opacity-0 group-hover:opacity-100"
                          )}
                        >
                          {isChecked && (
                            <Check className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                      </div>

                      {/* Status Tag */}
                      <div className="w-20 shrink-0 sm:w-24">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] uppercase font-mono px-2 py-0.5",
                            colorClass
                          )}
                        >
                          {result.status}
                        </Badge>
                      </div>

                      {/* Channel Logo */}
                      <div className="mr-3 flex h-7 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/80 bg-card">
                        {result.tvgLogo ? (
                          <img
                            src={result.tvgLogo}
                            alt=""
                            className="h-full w-full object-contain"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground opacity-40" />
                        )}
                      </div>

                      {/* Channel Name */}
                      <div className="min-w-0 flex-1 truncate pr-2 font-medium text-xs sm:text-sm sm:w-1/4 sm:flex-none sm:pr-4 text-foreground">
                        {result.tvgName || `Channel ${result.channelId}`}
                      </div>

                      {/* Stream URL */}
                      <div className="hidden flex-1 truncate pr-4 font-mono text-xs text-muted-foreground opacity-70 md:block">
                        {result.url}
                      </div>

                      {/* Latency badge */}
                      <div className="w-16 shrink-0 pr-2 text-right font-mono text-xs sm:w-20 sm:pr-4 text-muted-foreground">
                        {formatMs(result.responseTimeMs)}
                      </div>

                      {/* Codec / Resolution indicator */}
                      <div className="hidden w-24 shrink-0 text-right font-mono text-[10px] text-muted-foreground lg:block">
                        {result.probeData?.width
                          ? `${result.probeData.width}x${result.probeData.height}`
                          : "-"}
                      </div>

                      {/* Per-row quick actions */}
                      <div className="flex items-center justify-end gap-1 shrink-0 w-12">
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Edit channel details"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(result);
                          }}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                          title="Copy stream URL"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyText(result.url, result.id);
                          }}
                        >
                          {isCopied ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-80 hover:!opacity-100 transition-opacity" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── STREAM INSPECTION & DIAGNOSTICS DRAWER ────────────────────────────────── */}
      <Drawer
        open={!!selectedResult}
        onOpenChange={(open) => !open && setSelectedResult(null)}
        direction="right"
      >
        <DrawerContent className="h-screen top-0 right-0 left-auto mt-0 w-full sm:w-[500px] md:w-[540px] rounded-none border-l border-border bg-card flex flex-col shadow-2xl overflow-hidden">
          {selectedResult && (
            <>
              <DrawerHeader className="border-b border-border/80 px-6 py-4 flex-shrink-0 text-left bg-muted/20 min-w-0">
                <div className="flex justify-between items-center gap-2 mb-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "uppercase font-mono text-xs px-2.5 py-0.5 font-bold",
                      statusColors[
                        selectedResult.status as keyof typeof statusColors
                      ]
                    )}
                  >
                    {selectedResult.status}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    ID: #{selectedResult.id}
                  </span>
                </div>
                <DrawerTitle className="font-display text-xl font-bold truncate min-w-0">
                  {selectedResult.tvgName || `Channel ${selectedResult.channelId}`}
                </DrawerTitle>
                <div className="mt-1 font-mono text-xs text-muted-foreground break-all bg-background/80 p-2 rounded-md border border-border/60 max-h-16 overflow-y-auto">
                  {selectedResult.url}
                </div>
              </DrawerHeader>

              {/* Drawer Tabs: Telemetry vs Edit */}
              <Tabs value={activeDrawerTab} onValueChange={setActiveDrawerTab} className="flex-1 flex flex-col min-h-0">
                <div className="border-b border-border/80 px-6 pt-3 bg-card shrink-0">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="telemetry" className="text-xs font-medium gap-1.5">
                      <Activity className="h-3.5 w-3.5" /> Stream Telemetry
                    </TabsTrigger>
                    <TabsTrigger value="edit" className="text-xs font-medium gap-1.5">
                      <Edit2 className="h-3.5 w-3.5" /> Edit Channel Details
                    </TabsTrigger>
                  </TabsList>
                </div>

                <ScrollArea className="flex-1 min-h-0">
                  <TabsContent value="telemetry" className="p-6 space-y-6 mt-0">
                    {/* LIVE STREAM PLAYER */}
                    <div className="space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Play className="h-3.5 w-3.5 text-primary" /> Live Stream Carrier Preview
                      </h3>
                      <StreamPlayer
                        url={selectedResult.url}
                        mimeType={selectedResult.mimeType}
                        title={selectedResult.tvgName ?? undefined}
                        poster={selectedResult.tvgLogo}
                      />
                    </div>

                    {/* HTTP NETWORK DIAGNOSTICS */}
                    <div className="space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Activity className="h-3.5 w-3.5 text-indigo-500" /> HTTP Telemetry
                      </h3>
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono border border-border/80 rounded-xl p-3.5 bg-muted/20">
                        <div className="text-muted-foreground">HTTP Status</div>
                        <div
                          className={cn(
                            "font-bold",
                            selectedResult.httpStatus &&
                              selectedResult.httpStatus >= 400
                              ? "text-rose-500"
                              : "text-foreground"
                          )}
                        >
                          {selectedResult.httpStatus || "-"}
                        </div>

                        <div className="text-muted-foreground">Response Latency</div>
                        <div className="text-foreground">
                          {formatMs(selectedResult.responseTimeMs)}
                        </div>

                        <div className="text-muted-foreground">Redirect Chain</div>
                        <div className="text-foreground">
                          {selectedResult.redirectCount ?? "0"}
                        </div>

                        <div className="text-muted-foreground">Content Type</div>
                        <div
                          className="truncate text-foreground"
                          title={selectedResult.mimeType || ""}
                        >
                          {selectedResult.mimeType || "-"}
                        </div>

                        <div className="text-muted-foreground">TLS Handshake</div>
                        <div className="text-foreground">
                          {selectedResult.tlsValid === null
                            ? "-"
                            : selectedResult.tlsValid
                            ? "Valid"
                            : "Invalid / Self-Signed"}
                        </div>
                      </div>
                    </div>

                    {/* FAILURE REASON */}
                    {selectedResult.failureReason && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-rose-500 flex items-center gap-2">
                          <ShieldAlert className="h-3.5 w-3.5" /> Failure Diagnostic Note
                        </h3>
                        <div className="text-xs font-mono border border-rose-500/30 rounded-xl p-3 bg-rose-500/5 text-rose-500 break-words">
                          {selectedResult.failureReason}
                        </div>
                      </div>
                    )}

                    {/* DEEP MEDIA PROBE */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <SearchCode className="h-3.5 w-3.5 text-emerald-500" /> FFprobe Codec Telemetry
                        </h3>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs font-semibold gap-1.5"
                          onClick={handleDeepProbe}
                          disabled={probeChannels.isPending}
                        >
                          {probeChannels.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          Inspect Stream
                        </Button>
                      </div>

                      {selectedResult.probeData ? (
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono border border-border/80 rounded-xl p-3.5 bg-muted/20">
                          <div className="text-muted-foreground">Video Codec</div>
                          <div className="text-foreground font-semibold">
                            {selectedResult.probeData.videoCodec || "-"}
                          </div>

                          <div className="text-muted-foreground">Audio Codec</div>
                          <div className="text-foreground font-semibold">
                            {selectedResult.probeData.audioCodec || "-"}
                          </div>

                          <div className="text-muted-foreground">Resolution</div>
                          <div className="text-foreground font-semibold">
                            {selectedResult.probeData.width
                              ? `${selectedResult.probeData.width}x${selectedResult.probeData.height}`
                              : "-"}
                          </div>

                          <div className="text-muted-foreground">Framerate</div>
                          <div className="text-foreground font-semibold">
                            {selectedResult.probeData.framerate
                              ? `${selectedResult.probeData.framerate} fps`
                              : "-"}
                          </div>

                          <div className="text-muted-foreground">Bitrate</div>
                          <div className="text-foreground font-semibold">
                            {selectedResult.probeData.bitrate
                              ? `${(
                                  selectedResult.probeData.bitrate / 1000
                                ).toFixed(0)} kbps`
                              : "-"}
                          </div>

                          <div className="text-muted-foreground">Container</div>
                          <div className="text-foreground font-semibold">
                            {selectedResult.probeData.container || "-"}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground border border-dashed rounded-xl p-4 text-center bg-muted/10">
                          No FFprobe container data yet. Click &quot;Inspect Stream&quot; to extract codecs and bitrates.
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* EDIT FORM TAB */}
                  <TabsContent value="edit" className="p-6 mt-0">
                    <form onSubmit={handleSaveChannelDetails} className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="tvgName" className="text-xs font-semibold">
                            Channel Name *
                          </Label>
                          <Input
                            id="tvgName"
                            value={editForm.tvgName}
                            disabled={isSavingEdit}
                            onChange={(e) => {
                              setEditForm((f) => ({ ...f, tvgName: e.target.value }));
                              setChannelTouched((prev) => ({ ...prev, tvgName: true }));
                            }}
                            onBlur={() => setChannelTouched((prev) => ({ ...prev, tvgName: true }))}
                            placeholder="e.g. ESPN HD"
                            className={cn(
                              "h-9 text-xs",
                              channelTouched.tvgName &&
                                channelValidation.errors.tvgName &&
                                "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                            )}
                          />
                          {channelTouched.tvgName && channelValidation.errors.tvgName && (
                            <p className="flex items-center gap-1 text-[11px] text-destructive font-medium">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              {channelValidation.errors.tvgName}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="category" className="text-xs font-semibold">
                            Group / Category
                          </Label>
                          <Input
                            id="category"
                            value={editForm.category}
                            onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                            placeholder="e.g. SPORTS"
                            className="h-9 text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="url" className="text-xs font-semibold">
                          Streaming Link / URL *
                        </Label>
                        <Input
                          id="url"
                          value={editForm.url}
                          disabled={isSavingEdit}
                          onChange={(e) => {
                            setEditForm((f) => ({ ...f, url: e.target.value }));
                            setChannelTouched((prev) => ({ ...prev, url: true }));
                          }}
                          onBlur={() => setChannelTouched((prev) => ({ ...prev, url: true }))}
                          placeholder="https://domain.com/live/stream.m3u8"
                          className={cn(
                            "h-9 text-xs font-mono",
                            channelTouched.url &&
                              channelValidation.errors.url &&
                              "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                          )}
                        />
                        {channelTouched.url && channelValidation.errors.url && (
                          <p className="flex items-center gap-1 text-[11px] text-destructive font-medium">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            {channelValidation.errors.url}
                          </p>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="tvgLogo" className="text-xs font-semibold">
                            Logo Image URL
                          </Label>
                          <Input
                            id="tvgLogo"
                            value={editForm.tvgLogo}
                            disabled={isSavingEdit}
                            onChange={(e) => {
                              setEditForm((f) => ({ ...f, tvgLogo: e.target.value }));
                              setChannelTouched((prev) => ({ ...prev, tvgLogo: true }));
                            }}
                            onBlur={() => setChannelTouched((prev) => ({ ...prev, tvgLogo: true }))}
                            placeholder="https://domain.com/logo.png"
                            className={cn(
                              "h-9 text-xs font-mono",
                              channelTouched.tvgLogo &&
                                channelValidation.errors.tvgLogo &&
                                "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                            )}
                          />
                          {channelTouched.tvgLogo && channelValidation.errors.tvgLogo && (
                            <p className="flex items-center gap-1 text-[11px] text-destructive font-medium">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              {channelValidation.errors.tvgLogo}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="status" className="text-xs font-semibold">
                            Signal Status Override
                          </Label>
                          <Select
                            value={editForm.status}
                            onValueChange={(val) => setEditForm((f) => ({ ...f, status: val }))}
                          >
                            <SelectTrigger className="h-9 text-xs font-mono">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="live">Live (Active)</SelectItem>
                              <SelectItem value="suspicious">Warn / Suspicious</SelectItem>
                              <SelectItem value="geoblocked">Geoblocked</SelectItem>
                              <SelectItem value="dead">Dead / Offline</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* User-Agent with Presets */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="chUa" className="text-xs font-semibold">Custom User-Agent</Label>
                          <Input
                            id="chUa"
                            placeholder="e.g. VLC/3.0.18"
                            value={editForm.userAgent}
                            onChange={(e) => setEditForm((f) => ({ ...f, userAgent: e.target.value }))}
                            className="h-9 font-mono text-xs"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold">User-Agent Presets</Label>
                          <Select
                            onValueChange={(val) => setEditForm((f) => ({ ...f, userAgent: val }))}
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue placeholder="Select preset..." />
                            </SelectTrigger>
                            <SelectContent>
                              {USER_AGENT_PRESETS.map((p) => (
                                <SelectItem key={p.label} value={p.value}>{p.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Instant Stream Preview inside Form */}
                      {editForm.url.trim() && (
                        <div className="rounded-lg border border-border bg-slate-950/60 p-3 space-y-2 mt-2">
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                            <span className="flex items-center gap-1.5">
                              <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" /> Live Stream Preview Test
                            </span>
                          </div>
                          <StreamPlayer
                            url={editForm.url}
                            userAgent={editForm.userAgent}
                            referrer={editForm.referrer}
                            title={editForm.tvgName || "Test Preview"}
                            poster={editForm.tvgLogo}
                            autoPlay={false}
                          />
                        </div>
                      )}

                      <div className="pt-4 flex items-center justify-end gap-2 border-t border-border/80">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveDrawerTab("telemetry")}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isSavingEdit || !channelValidation.isValid}
                          className="gap-1.5 font-semibold min-w-[140px]"
                        >
                          {isSavingEdit ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save Channel Changes
                        </Button>
                      </div>
                    </form>
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* ── DIALOG: Edit Channel Details Modal ────────────────────────────── */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-primary" /> Edit Channel Details
            </DialogTitle>
            <DialogDescription>
              Update stream link, metadata, headers, and status overrides for this channel.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveChannelDetails} className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="modalTvgName">Channel Name *</Label>
                <Input
                  id="modalTvgName"
                  placeholder="e.g. ESPN HD"
                  value={editForm.tvgName}
                  disabled={isSavingEdit}
                  onChange={(e) => {
                    setEditForm((f) => ({ ...f, tvgName: e.target.value }));
                    setChannelTouched((prev) => ({ ...prev, tvgName: true }));
                  }}
                  onBlur={() => setChannelTouched((prev) => ({ ...prev, tvgName: true }))}
                  className={cn(
                    "text-xs",
                    channelTouched.tvgName &&
                      channelValidation.errors.tvgName &&
                      "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                  )}
                />
                {channelTouched.tvgName && channelValidation.errors.tvgName && (
                  <p className="flex items-center gap-1 text-xs text-destructive font-medium">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {channelValidation.errors.tvgName}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="modalCategory">Group / Category</Label>
                <Input
                  id="modalCategory"
                  placeholder="e.g. SPORTS"
                  value={editForm.category}
                  disabled={isSavingEdit}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="modalUrl">Streaming Link / URL *</Label>
              <Input
                id="modalUrl"
                placeholder="https://domain.com/live/stream.m3u8"
                value={editForm.url}
                disabled={isSavingEdit}
                onChange={(e) => {
                  setEditForm((f) => ({ ...f, url: e.target.value }));
                  setChannelTouched((prev) => ({ ...prev, url: true }));
                }}
                onBlur={() => setChannelTouched((prev) => ({ ...prev, url: true }))}
                className={cn(
                  "font-mono text-xs",
                  channelTouched.url &&
                    channelValidation.errors.url &&
                    "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                )}
              />
              {channelTouched.url && channelValidation.errors.url && (
                <p className="flex items-center gap-1 text-xs text-destructive font-medium mt-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {channelValidation.errors.url}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="modalTvgLogo">Logo Image URL</Label>
                <Input
                  id="modalTvgLogo"
                  placeholder="https://domain.com/logo.png"
                  value={editForm.tvgLogo}
                  disabled={isSavingEdit}
                  onChange={(e) => {
                    setEditForm((f) => ({ ...f, tvgLogo: e.target.value }));
                    setChannelTouched((prev) => ({ ...prev, tvgLogo: true }));
                  }}
                  onBlur={() => setChannelTouched((prev) => ({ ...prev, tvgLogo: true }))}
                  className={cn(
                    "font-mono text-xs",
                    channelTouched.tvgLogo &&
                      channelValidation.errors.tvgLogo &&
                      "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                  )}
                />
                {channelTouched.tvgLogo && channelValidation.errors.tvgLogo && (
                  <p className="flex items-center gap-1 text-xs text-destructive font-medium mt-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {channelValidation.errors.tvgLogo}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="modalStatus">Signal Status Override</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(val) => setEditForm((f) => ({ ...f, status: val }))}
                >
                  <SelectTrigger className="text-xs font-mono">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">Live (Active)</SelectItem>
                    <SelectItem value="suspicious">Warn / Suspicious</SelectItem>
                    <SelectItem value="geoblocked">Geoblocked</SelectItem>
                    <SelectItem value="dead">Dead / Offline</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* User-Agent with Presets */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="modalChUa" className="text-xs font-semibold">Custom User-Agent</Label>
                <Input
                  id="modalChUa"
                  placeholder="e.g. VLC/3.0.18"
                  value={editForm.userAgent}
                  onChange={(e) => setEditForm((f) => ({ ...f, userAgent: e.target.value }))}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">User-Agent Presets</Label>
                <Select
                  onValueChange={(val) => setEditForm((f) => ({ ...f, userAgent: val }))}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_AGENT_PRESETS.map((p) => (
                      <SelectItem key={p.label} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Instant Stream Preview inside Modal */}
            {editForm.url.trim() && (
              <div className="rounded-lg border border-border bg-slate-950/60 p-3 space-y-2 mt-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" /> Live Stream Preview Test
                  </span>
                </div>
                <StreamPlayer
                  url={editForm.url}
                  userAgent={editForm.userAgent}
                  referrer={editForm.referrer}
                  title={editForm.tvgName || "Test Preview"}
                  poster={editForm.tvgLogo}
                  autoPlay={false}
                />
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-border/80">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditModalOpen(false)}
                disabled={isSavingEdit}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSavingEdit || !channelValidation.isValid}
                className={cn(
                  "gap-2 font-bold min-w-[140px] shadow-sm transition-all duration-150",
                  isSavingEdit && "cursor-not-allowed opacity-90",
                  !channelValidation.isValid && "cursor-not-allowed opacity-60"
                )}
              >
                {isSavingEdit ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 shrink-0" />
                    <span>Save Channel</span>
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
