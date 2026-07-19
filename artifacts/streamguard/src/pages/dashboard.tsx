import { useState } from "react";
import { Activity } from "lucide-react";
import { useListJobs, useCreatePlaylist, useCreateJob } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { formatMs, formatTime } from "@/lib/utils";
import { Play, FileText, Link as LinkIcon, Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: jobs, isLoading: jobsLoading } = useListJobs();
  const createPlaylist = useCreatePlaylist();
  const createJob = useCreateJob();
  
  // Job settings state
  const [concurrency, setConcurrency] = useState([50]);
  const [timeoutMs, setTimeoutMs] = useState("10000");
  const [retryCount, setRetryCount] = useState("1");
  const [perHostConcurrency, setPerHostConcurrency] = useState("10");
  const [autoProbe, setAutoProbe] = useState(true);

  // Ingestion state
  const [activeTab, setActiveTab] = useState("text");
  const [m3uText, setM3uText] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [playlistName, setPlaylistName] = useState("");

  const handleRunCheck = async () => {
    if (!playlistName) {
      alert("Please enter a playlist name");
      return;
    }
    
    try {
      // 1. Create Playlist
      let inputData: any = { name: playlistName, sourceType: activeTab };
      if (activeTab === "text") {
        inputData.content = m3uText;
      } else if (activeTab === "url") {
        inputData.url = m3uUrl;
      } else {
        // file upload not implemented in this demo fully, fallback to text
        return;
      }

      const playlist = await createPlaylist.mutateAsync({ data: inputData });

      // 2. Create Job
      const job = await createJob.mutateAsync({
        data: {
          playlistId: playlist.id,
          settings: {
            concurrency: concurrency[0],
            timeoutMs: parseInt(timeoutMs),
            retryCount: parseInt(retryCount),
            autoProbe,
            perHostConcurrency: parseInt(perHostConcurrency)
          }
        }
      });

      // 3. Navigate to Job Monitor
      setLocation(`/jobs/${job.id}`);
    } catch (err) {
      console.error(err);
    }
  };

  const isSubmitting = createPlaylist.isPending || createJob.isPending;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-lg">StreamGuard Operations Center</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-primary/20 shadow-lg shadow-primary/5">
          <CardHeader className="border-b bg-card/50">
            <CardTitle className="text-xl">New Health Check</CardTitle>
            <CardDescription>Ingest M3U playlist and configure probe settings</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-3">
              <Label htmlFor="playlist-name">Playlist Name</Label>
              <Input 
                id="playlist-name" 
                value={playlistName} 
                onChange={(e) => setPlaylistName(e.target.value)} 
                placeholder="e.g., Global Sports 2024"
                className="max-w-md bg-background"
              />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3 max-w-md">
                <TabsTrigger value="text" className="gap-2"><FileText className="w-4 h-4" /> Text</TabsTrigger>
                <TabsTrigger value="url" className="gap-2"><LinkIcon className="w-4 h-4" /> URL</TabsTrigger>
                <TabsTrigger value="file" className="gap-2"><Upload className="w-4 h-4" /> File</TabsTrigger>
              </TabsList>
              <div className="mt-4 border rounded-md bg-background p-1">
                <TabsContent value="text" className="mt-0 outline-none">
                  <Textarea 
                    placeholder="#EXTM3U..." 
                    className="min-h-[200px] font-mono text-sm border-0 focus-visible:ring-0 resize-y"
                    value={m3uText}
                    onChange={(e) => setM3uText(e.target.value)}
                  />
                </TabsContent>
                <TabsContent value="url" className="mt-0 outline-none p-4">
                  <Input 
                    placeholder="https://example.com/playlist.m3u" 
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                  />
                </TabsContent>
                <TabsContent value="file" className="mt-0 outline-none p-8 flex flex-col items-center justify-center border-2 border-dashed border-muted m-2 rounded-lg text-muted-foreground bg-muted/20">
                  <Upload className="w-8 h-8 mb-4 opacity-50" />
                  <p>Drag and drop M3U file here, or click to select</p>
                </TabsContent>
              </div>
            </Tabs>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t">
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label>Global Concurrency</Label>
                    <span className="font-mono text-sm text-primary">{concurrency[0]}</span>
                  </div>
                  <Slider 
                    min={1} max={100} step={1} 
                    value={concurrency} 
                    onValueChange={setConcurrency} 
                  />
                  <p className="text-xs text-muted-foreground">Max simultaneous connections</p>
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Auto-Probe Media</Label>
                    <p className="text-xs text-muted-foreground">FFprobe live streams for codec data</p>
                  </div>
                  <Switch checked={autoProbe} onCheckedChange={setAutoProbe} />
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Timeout (ms)</Label>
                    <Input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Retries</Label>
                    <Input type="number" value={retryCount} onChange={(e) => setRetryCount(e.target.value)} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Per-Host Concurrency</Label>
                    <Input type="number" value={perHostConcurrency} onChange={(e) => setPerHostConcurrency(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <Button size="lg" className="w-full md:w-auto font-bold tracking-wide" onClick={handleRunCheck} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Play className="w-5 h-5 mr-2 fill-current" />}
                RUN CHECK
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Activity className="w-5 h-5" /> Recent Jobs
          </h2>
          {jobsLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-muted" /></div>
          ) : !jobs || jobs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground flex flex-col items-center">
                <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                <p>No jobs found</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {jobs.slice(0, 5).map(job => (
                <Link key={job.id} href={`/jobs/${job.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="truncate pr-4">
                          <p className="font-medium truncate group-hover:text-primary transition-colors">{job.playlistName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">Job #{job.id} • {new Date(job.createdAt).toLocaleDateString()}</p>
                        </div>
                        <Badge variant="outline" className={
                          job.status === 'running' ? 'bg-primary/10 text-primary border-primary/20' : 
                          job.status === 'completed' ? 'bg-[hsl(var(--live))]/10 text-[hsl(var(--live))] border-[hsl(var(--live))]/20' : ''
                        }>
                          {job.status.toUpperCase()}
                        </Badge>
                      </div>
                      
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-mono">
                          <span>{job.checked} / {job.total}</span>
                          {job.status === 'running' && job.etaSeconds != null && (
                            <span className="text-muted-foreground">ETA {formatTime(job.etaSeconds)}</span>
                          )}
                        </div>
                        <div className="h-2 w-full bg-muted overflow-hidden flex rounded-full">
                          <div className="h-full bg-[hsl(var(--live))]" style={{ width: `${(job.live / job.total) * 100}%` }} />
                          <div className="h-full bg-[hsl(var(--dead))]" style={{ width: `${(job.dead / job.total) * 100}%` }} />
                          <div className="h-full bg-[hsl(var(--geoblocked))]" style={{ width: `${(job.geoblocked / job.total) * 100}%` }} />
                          <div className="h-full bg-[hsl(var(--suspicious))]" style={{ width: `${(job.suspicious / job.total) * 100}%` }} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
