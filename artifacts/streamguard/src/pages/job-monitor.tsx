import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { io } from "socket.io-client";
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
  ChannelResult
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatMs, formatTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Play, Pause, XCircle, Download, Search, SearchCode, 
  ChevronRight, Activity, ArrowLeft, Loader2, Image as ImageIcon
} from "lucide-react";
import { 
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription 
} from "@/components/ui/drawer";

// Status color mapping for chips
const statusColors = {
  live: "bg-[hsl(var(--live))]/10 text-[hsl(var(--live))] border-[hsl(var(--live))]/20",
  dead: "bg-[hsl(var(--dead))]/10 text-[hsl(var(--dead))] border-[hsl(var(--dead))]/20",
  geoblocked: "bg-[hsl(var(--geoblocked))]/10 text-[hsl(var(--geoblocked))] border-[hsl(var(--geoblocked))]/20",
  suspicious: "bg-[hsl(var(--suspicious))]/10 text-[hsl(var(--suspicious))] border-[hsl(var(--suspicious))]/20",
  pending: "bg-muted text-muted-foreground border-muted-foreground/20",
};

export default function JobMonitor() {
  const [, params] = useRoute("/jobs/:id");
  const jobId = parseInt(params?.id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const pauseJob = usePauseJob();
  const resumeJob = useResumeJob();
  const cancelJob = useCancelJob();
  const probeChannels = useProbeChannels();

  const { data: job, isLoading: jobLoading } = useGetJob(jobId, { 
    query: { enabled: !!jobId, queryKey: getGetJobQueryKey(jobId) } 
  });

  const { data: initialCategories } = useGetJobCategories(jobId, {
    query: { enabled: !!jobId && (job?.status === "completed" || job?.status === "cancelled"), queryKey: getGetJobCategoriesQueryKey(jobId) }
  });

  // State for live updates via WebSocket
  const [liveStats, setLiveStats] = useState({
    checked: 0, live: 0, dead: 0, geoblocked: 0, suspicious: 0, pending: 0,
    etaSeconds: null as number | null, avgCheckMs: null as number | null
  });
  const [liveStatus, setLiveStatus] = useState<string>("queued");
  
  // Results and categories from socket
  const [socketResults, setSocketResults] = useState<ChannelResult[]>([]);
  const [socketCategories, setSocketCategories] = useState<Record<string, { total: number; live: number; dead: number; }>>({});
  
  // Filtering & Sorting
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("status");
  const [sortDir, setSortDir] = useState<string>("desc");
  
  // Drawer state
  const [selectedResult, setSelectedResult] = useState<ChannelResult | null>(null);

  // Load complete results if job is done
  const isFinished = liveStatus === "completed" || liveStatus === "cancelled" || liveStatus === "failed";
  const { data: apiResults, isLoading: resultsLoading } = useGetJobResults(
    jobId, 
    { page: 1, limit: 10000, search, category: categoryFilter !== "all" ? categoryFilter : undefined, status: statusFilter.join(","), sortBy, sortDir }, 
    { query: { enabled: !!jobId && isFinished } }
  );

  // Sync initial stats
  useEffect(() => {
    if (job) {
      setLiveStats({
        checked: job.checked, live: job.live, dead: job.dead, geoblocked: job.geoblocked, 
        suspicious: job.suspicious, pending: job.pending, etaSeconds: job.etaSeconds ?? null, avgCheckMs: job.avgCheckMs ?? null
      });
      setLiveStatus(job.status);
    }
  }, [job]);

  // Setup WebSocket
  useEffect(() => {
    if (!jobId) return;
    
    // Only connect socket if job is not finished initially
    if (job && (job.status === "completed" || job.status === "cancelled" || job.status === "failed")) {
      return;
    }

    const socket = io({ path: "/api/socket.io", transports: ["polling", "websocket"] });
    socket.emit("subscribe", { jobId });

    socket.on("job:progress", (data) => {
      setLiveStats(prev => ({ ...prev, ...data }));
    });

    socket.on("job:status", (data) => {
      setLiveStatus(data.status);
      queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
    });

    socket.on("job:result", (data: { jobId: number, result: ChannelResult }) => {
      setSocketResults(prev => [data.result, ...prev]);
      
      if (data.result.category) {
        const cat = data.result.category;
        setSocketCategories(prev => {
          const existing = prev[cat] || { total: 0, live: 0, dead: 0 };
          return {
            ...prev,
            [cat]: {
              total: existing.total + 1,
              live: existing.live + (data.result.status === "live" ? 1 : 0),
              dead: existing.dead + (data.result.status === "dead" ? 1 : 0)
            }
          };
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [jobId, job?.status, queryClient]);

  // Determine which results to show
  const displayResults = useMemo(() => {
    if (isFinished && apiResults?.results) {
      return apiResults.results;
    }
    
    // Client-side filtering for live socket results
    let filtered = socketResults;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter(r => 
        (r.tvgName || "").toLowerCase().includes(lowerSearch) || 
        r.url.toLowerCase().includes(lowerSearch)
      );
    }
    if (statusFilter.length > 0) {
      filtered = filtered.filter(r => statusFilter.includes(r.status));
    }
    if (categoryFilter !== "all") {
      filtered = filtered.filter(r => r.category === categoryFilter);
    }
    
    // Client-side sorting
    filtered = [...filtered].sort((a, b) => {
      let valA: any = a[sortBy as keyof ChannelResult];
      let valB: any = b[sortBy as keyof ChannelResult];
      
      if (valA == null) valA = "";
      if (valB == null) valB = "";
      
      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [isFinished, apiResults, socketResults, search, statusFilter, categoryFilter, sortBy, sortDir]);

  // Categories display logic
  const categoriesList = useMemo(() => {
    if (isFinished && initialCategories) {
      return initialCategories.map(c => ({
        name: c.category,
        total: c.total,
        live: c.live,
        dead: c.dead
      }));
    }
    return Object.entries(socketCategories).map(([name, stats]) => ({
      name,
      ...stats
    })).sort((a, b) => b.total - a.total);
  }, [isFinished, initialCategories, socketCategories]);

  // Virtualizer for table
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: displayResults.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const toggleStatusFilter = (status: string) => {
    setStatusFilter(prev => 
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const handleDeepProbe = () => {
    if (selectedResult) {
      probeChannels.mutate({ id: jobId, data: { resultIds: [selectedResult.id] } }, {
        onSuccess: () => {
          // If we had a way to refetch a single result, we would do it here
          // For now, we can invalidate API results if finished
          if (isFinished) {
             queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
          }
        }
      });
    }
  };

  if (!jobId || jobLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  const totalChannels = job?.total || 0;
  const progressPercent = totalChannels > 0 ? (liveStats.checked / totalChannels) * 100 : 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* HEADER BAND */}
      <div className="flex-shrink-0 border-b bg-card">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="mr-2">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight truncate max-w-[300px]" title={job?.playlistName}>{job?.playlistName}</h1>
                <Badge variant="outline" className={cn(
                  liveStatus === 'running' ? 'bg-primary/10 text-primary border-primary/20' : 
                  liveStatus === 'completed' ? 'bg-[hsl(var(--live))]/10 text-[hsl(var(--live))] border-[hsl(var(--live))]/20' : ''
                )}>
                  {liveStatus.toUpperCase()}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground font-mono mt-1">
                {liveStats.checked.toLocaleString()} / {totalChannels.toLocaleString()} checked 
                {liveStats.etaSeconds != null && liveStatus === "running" && ` • ETA ${formatTime(liveStats.etaSeconds)}`}
                {liveStats.avgCheckMs != null && ` • ${Math.round(liveStats.avgCheckMs)}ms avg`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex gap-4 font-mono text-sm border-r pr-6">
              <div className="flex flex-col items-end text-[hsl(var(--live))]">
                <span className="text-xs opacity-70 uppercase tracking-widest">Live</span>
                <span className="font-bold text-lg leading-none">{liveStats.live.toLocaleString()}</span>
              </div>
              <div className="flex flex-col items-end text-[hsl(var(--dead))]">
                <span className="text-xs opacity-70 uppercase tracking-widest">Dead</span>
                <span className="font-bold text-lg leading-none">{liveStats.dead.toLocaleString()}</span>
              </div>
              <div className="flex flex-col items-end text-[hsl(var(--geoblocked))]">
                <span className="text-xs opacity-70 uppercase tracking-widest">Geo</span>
                <span className="font-bold text-lg leading-none">{liveStats.geoblocked.toLocaleString()}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {liveStatus === "running" && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => pauseJob.mutate({ id: jobId })} disabled={pauseJob.isPending}>
                    <Pause className="w-4 h-4 mr-2" /> Pause
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => cancelJob.mutate({ id: jobId })} disabled={cancelJob.isPending}>
                    <XCircle className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                </>
              )}
              {liveStatus === "paused" && (
                <>
                  <Button variant="default" size="sm" onClick={() => resumeJob.mutate({ id: jobId })} disabled={resumeJob.isPending}>
                    <Play className="w-4 h-4 mr-2" /> Resume
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => cancelJob.mutate({ id: jobId })} disabled={cancelJob.isPending}>
                    <XCircle className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                </>
              )}
              {isFinished && (
                <>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/jobs/${jobId}/export?format=m3u&status=live`} download>
                      <Download className="w-4 h-4 mr-2" /> M3U (Live)
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/jobs/${jobId}/export?format=csv`} download>
                      <Download className="w-4 h-4 mr-2" /> CSV
                    </a>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="h-1 w-full bg-muted">
          <div 
            className="h-full bg-primary transition-all duration-500 ease-out" 
            style={{ width: `${progressPercent}%` }} 
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR - CATEGORIES */}
        <div className="w-64 border-r bg-sidebar/50 flex flex-col hidden lg:flex">
          <div className="p-4 border-b font-medium text-sm text-sidebar-foreground/70 uppercase tracking-wider">
            Categories
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              <button
                className={cn(
                  "w-full text-left px-3 py-2 rounded text-sm transition-colors flex justify-between items-center",
                  categoryFilter === "all" ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                )}
                onClick={() => setCategoryFilter("all")}
              >
                <span>All Channels</span>
                <span className="font-mono text-xs opacity-70">{totalChannels}</span>
              </button>
              
              {categoriesList.map(cat => (
                <button
                  key={cat.name}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded text-sm transition-colors group",
                    categoryFilter === cat.name ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                  )}
                  onClick={() => setCategoryFilter(cat.name)}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="truncate pr-2" title={cat.name}>{cat.name || "Uncategorized"}</span>
                    <span className="font-mono text-xs opacity-70">{cat.total}</span>
                  </div>
                  <div className="h-1 w-full bg-muted overflow-hidden flex rounded-full opacity-50 group-hover:opacity-100 transition-opacity">
                    <div className="h-full bg-[hsl(var(--live))]" style={{ width: `${(cat.live / cat.total) * 100}%` }} />
                    <div className="h-full bg-[hsl(var(--dead))]" style={{ width: `${(cat.dead / cat.total) * 100}%` }} />
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* MAIN RESULTS AREA */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {/* Filters Bar */}
          <div className="p-4 border-b flex flex-wrap items-center gap-4 bg-card/30">
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Search channel or URL..." 
                className="pl-9 bg-background font-mono text-sm h-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2">
              {Object.keys(statusColors).map(status => (
                <Badge
                  key={status}
                  variant="outline"
                  className={cn(
                    "cursor-pointer uppercase tracking-widest text-[10px] px-2 py-0.5 border-dashed transition-all",
                    statusFilter.includes(status) ? statusColors[status as keyof typeof statusColors] : "opacity-40 hover:opacity-80"
                  )}
                  onClick={() => toggleStatusFilter(status)}
                >
                  {status}
                </Badge>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-32 h-9 text-xs font-mono">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="tvgName">Name</SelectItem>
                  <SelectItem value="responseTimeMs">Latency</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-9 w-9"
                onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
              >
                {sortDir === "asc" ? "↑" : "↓"}
              </Button>
            </div>
          </div>

          {/* Virtualized Table */}
          <div ref={parentRef} className="flex-1 overflow-auto table-grid relative">
            {displayResults.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                {resultsLoading ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : (
                  <>
                    <SearchCode className="w-12 h-12 mb-4 opacity-20" />
                    <p>No results match filters</p>
                  </>
                )}
              </div>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const result = displayResults[virtualItem.index];
                  const colorClass = statusColors[result.status as keyof typeof statusColors];
                  
                  return (
                    <div
                      key={virtualItem.key}
                      className="absolute top-0 left-0 w-full flex items-center border-b px-4 hover:bg-muted/30 cursor-pointer transition-colors"
                      style={{
                        height: `${virtualItem.size}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      onClick={() => setSelectedResult(result)}
                    >
                      <div className="w-24 shrink-0">
                        <Badge variant="outline" className={cn("text-[10px] uppercase border-0 px-2", colorClass)}>
                          {result.status}
                        </Badge>
                      </div>
                      <div className="w-10 h-6 bg-card border rounded flex items-center justify-center overflow-hidden shrink-0 mr-3">
                        {result.tvgLogo ? (
                          <img src={result.tvgLogo} alt="" className="w-full h-full object-contain" loading="lazy" onError={(e) => e.currentTarget.style.display = 'none'} />
                        ) : (
                          <ImageIcon className="w-3 h-3 text-muted-foreground opacity-50" />
                        )}
                      </div>
                      <div className="w-1/4 shrink-0 truncate font-medium pr-4">
                        {result.tvgName || `Channel ${result.channelId}`}
                      </div>
                      <div className="flex-1 truncate font-mono text-xs text-muted-foreground opacity-70 pr-4">
                        {result.url}
                      </div>
                      <div className="w-20 shrink-0 font-mono text-xs text-right pr-4">
                        {formatMs(result.responseTimeMs)}
                      </div>
                      <div className="w-24 shrink-0 font-mono text-[10px] text-right text-muted-foreground">
                        {result.probeData?.width ? `${result.probeData.width}x${result.probeData.height}` : '-'}
                      </div>
                      <div className="w-8 shrink-0 flex justify-end">
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-50" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RESULT DETAILS DRAWER */}
      <Drawer open={!!selectedResult} onOpenChange={(open) => !open && setSelectedResult(null)} direction="right">
        <DrawerContent className="h-screen top-0 right-0 left-auto mt-0 w-full sm:w-[450px] rounded-none border-l bg-card flex flex-col">
          {selectedResult && (
            <>
              <DrawerHeader className="border-b px-6 py-4 flex-shrink-0 text-left">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="outline" className={cn("uppercase", statusColors[selectedResult.status as keyof typeof statusColors])}>
                    {selectedResult.status}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">ID: {selectedResult.id}</span>
                </div>
                <DrawerTitle className="text-xl break-words">
                  {selectedResult.tvgName || `Channel ${selectedResult.channelId}`}
                </DrawerTitle>
                <DrawerDescription className="font-mono text-xs break-all mt-2">
                  {selectedResult.url}
                </DrawerDescription>
              </DrawerHeader>
              <ScrollArea className="flex-1">
                <div className="p-6 space-y-6">
                  
                  {/* HTTP Check Data */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Activity className="w-4 h-4" /> HTTP Check
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm font-mono border rounded-md p-3 bg-muted/10">
                      <div className="text-muted-foreground">Status Code</div>
                      <div className={selectedResult.httpStatus && selectedResult.httpStatus >= 400 ? "text-[hsl(var(--dead))]" : ""}>{selectedResult.httpStatus || '-'}</div>
                      
                      <div className="text-muted-foreground">Response Time</div>
                      <div>{formatMs(selectedResult.responseTimeMs)}</div>
                      
                      <div className="text-muted-foreground">Redirects</div>
                      <div>{selectedResult.redirectCount ?? '-'}</div>
                      
                      <div className="text-muted-foreground">MIME Type</div>
                      <div className="truncate" title={selectedResult.mimeType || ""}>{selectedResult.mimeType || '-'}</div>
                      
                      <div className="text-muted-foreground">TLS Valid</div>
                      <div>{selectedResult.tlsValid === null ? '-' : selectedResult.tlsValid ? 'Yes' : 'No'}</div>
                    </div>
                  </div>

                  {/* Failure Reason */}
                  {selectedResult.failureReason && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-[hsl(var(--dead))]">
                        Failure Reason
                      </h3>
                      <div className="text-sm font-mono border border-[hsl(var(--dead))]/30 rounded-md p-3 bg-[hsl(var(--dead))]/5 text-[hsl(var(--dead))] break-words">
                        {selectedResult.failureReason}
                      </div>
                    </div>
                  )}

                  {/* Probe Data */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <SearchCode className="w-4 h-4" /> Deep Probe Data
                      </h3>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleDeepProbe} disabled={probeChannels.isPending}>
                        {probeChannels.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                        Probe Now
                      </Button>
                    </div>
                    
                    {selectedResult.probeData ? (
                      <div className="grid grid-cols-2 gap-2 text-sm font-mono border rounded-md p-3 bg-muted/10">
                        <div className="text-muted-foreground">Video Codec</div>
                        <div>{selectedResult.probeData.videoCodec || '-'}</div>
                        
                        <div className="text-muted-foreground">Audio Codec</div>
                        <div>{selectedResult.probeData.audioCodec || '-'}</div>
                        
                        <div className="text-muted-foreground">Resolution</div>
                        <div>{selectedResult.probeData.width ? `${selectedResult.probeData.width}x${selectedResult.probeData.height}` : '-'}</div>
                        
                        <div className="text-muted-foreground">Framerate</div>
                        <div>{selectedResult.probeData.framerate ? `${selectedResult.probeData.framerate}fps` : '-'}</div>
                        
                        <div className="text-muted-foreground">Bitrate</div>
                        <div>{selectedResult.probeData.bitrate ? `${(selectedResult.probeData.bitrate / 1000).toFixed(0)}kbps` : '-'}</div>
                        
                        <div className="text-muted-foreground">Container</div>
                        <div>{selectedResult.probeData.container || '-'}</div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground border border-dashed rounded-md p-4 text-center">
                        No FFprobe data available. Click "Probe Now" to analyze this stream.
                      </div>
                    )}
                  </div>

                </div>
              </ScrollArea>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
