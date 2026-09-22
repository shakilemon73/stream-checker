import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey, useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Flame,
  FolderGit2,
  Gauge,
  GitBranch,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  Radio,
  Save,
  SearchCode,
  Server,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isError } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });
  const updateSettings = useUpdateSettings();

  const [formData, setFormData] = useState({
    defaultConcurrency: "50",
    defaultTimeoutMs: "10000",
    defaultRetryCount: "1",
    perHostConcurrency: "10",
    maxConcurrency: "1000",
    autoProbeDefault: true,
    ffprobePath: "ffprobe",
    githubToken: "",
    githubOwner: "",
    githubRepo: "",
    githubBranch: "main",
    githubPath: "playlists/live.m3u8",
    githubAutoPush: false,
  });

  const [showToken, setShowToken] = useState(false);
  const [testingGitHub, setTestingGitHub] = useState(false);
  const [gitHubTestResult, setGitHubTestResult] = useState<{
    valid?: boolean;
    username?: string;
    scopes?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (settings) {
      const s = settings as typeof settings & {
        githubToken?: string;
        githubOwner?: string;
        githubRepo?: string;
        githubBranch?: string;
        githubPath?: string;
        githubAutoPush?: boolean;
      };
      setFormData({
        defaultConcurrency: String(settings.defaultConcurrency),
        defaultTimeoutMs: String(settings.defaultTimeoutMs),
        defaultRetryCount: String(settings.defaultRetryCount),
        perHostConcurrency: String(settings.perHostConcurrency),
        maxConcurrency: String(settings.maxConcurrency),
        autoProbeDefault: settings.autoProbeDefault,
        ffprobePath: settings.ffprobePath ?? "ffprobe",
        githubToken: s.githubToken ?? "",
        githubOwner: s.githubOwner ?? "",
        githubRepo: s.githubRepo ?? "",
        githubBranch: s.githubBranch ?? "main",
        githubPath: s.githubPath ?? "playlists/live.m3u8",
        githubAutoPush: !!s.githubAutoPush,
      });
    }
  }, [settings]);

  const change = (name: string, value: string | boolean) =>
    setFormData((current) => ({ ...current, [name]: value }));

  const concurrencyMismatch =
    Number(formData.defaultConcurrency) > Number(formData.maxConcurrency);

  const testGitHub = async () => {
    if (!formData.githubToken.trim()) {
      toast.error("Please enter a GitHub personal access token.");
      return;
    }
    setTestingGitHub(true);
    setGitHubTestResult(null);
    try {
      const res = await fetch("/api/settings/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: formData.githubToken }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setGitHubTestResult(data);
        toast.success(`Connected to GitHub as @${data.username}`);
      } else {
        setGitHubTestResult({
          valid: false,
          error: data.error || "Failed to authenticate with GitHub",
        });
        toast.error(data.error || "GitHub authentication failed");
      }
    } catch (err) {
      setGitHubTestResult({ valid: false, error: (err as Error).message });
      toast.error("Network error testing GitHub connection");
    } finally {
      setTestingGitHub(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      defaultConcurrency: Number(formData.defaultConcurrency) || 50,
      defaultTimeoutMs: Number(formData.defaultTimeoutMs) || 10000,
      defaultRetryCount: Number(formData.defaultRetryCount) || 1,
      perHostConcurrency: Number(formData.perHostConcurrency) || 10,
      maxConcurrency: Number(formData.maxConcurrency) || 1000,
      autoProbeDefault: formData.autoProbeDefault,
      ffprobePath: formData.ffprobePath || "ffprobe",
      githubToken: formData.githubToken,
      githubOwner: formData.githubOwner,
      githubRepo: formData.githubRepo,
      githubBranch: formData.githubBranch,
      githubPath: formData.githubPath,
      githubAutoPush: formData.githubAutoPush,
    };

    // 1. Optimistically update local query cache
    queryClient.setQueryData(getGetSettingsQueryKey(), (old: any) => ({
      ...old,
      ...payload,
    }));

    updateSettings.mutate(
      {
        data: payload as any,
      },
      {
        onSuccess: (updated) => {
          toast.success("Engine settings saved and synchronized immediately.");
          queryClient.setQueryData(getGetSettingsQueryKey(), updated);
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (err: any) => {
          toast.error(err?.message || "Could not save settings.");
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1580px] space-y-6 px-4 py-8 sm:px-7 lg:px-10">
        <div className="h-20 w-80 animate-pulse rounded-xl bg-muted/60" />
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <Activity className="mx-auto mb-4 h-10 w-10 text-rose-500" />
        <h1 className="font-display text-2xl font-bold">Control Plane Offline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The settings daemon did not return system configuration. Check container logs.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-8 px-4 py-6 sm:px-7 lg:px-10 lg:py-8">
      {/* Header Command Bar */}
      <header className="flex flex-col justify-between gap-6 border-b border-border/80 pb-7 lg:flex-row lg:items-end">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-bold text-primary">
              <SlidersHorizontal className="h-3 w-3" />
              SYSTEM DAEMON CONFIG
            </span>
            <span className="text-muted-foreground hidden sm:inline">·</span>
            <span className="text-muted-foreground hidden sm:inline">Worker Pool & Git Synchronization</span>
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-foreground">
            System & Engine Settings
          </h1>
          <p className="max-w-2xl text-sm sm:text-[15px] leading-relaxed text-muted-foreground">
            Fine-tune high-throughput network concurrency limits, FFprobe media inspect thresholds, and GitHub continuous deployment rules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-sm font-mono text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-foreground">Daemon Active</span>
          </div>
        </div>
      </header>

      {/* Main Settings Form Grid */}
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* SECTION 1: GITHUB INTEGRATION */}
          <Card className="border-border/80 bg-card/90 shadow-md flex flex-col justify-between overflow-hidden">
            <div>
              <CardHeader className="border-b border-border/70 bg-muted/30 p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FolderGit2 className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="font-display text-xl font-bold">
                        GitHub Auto-Sync Engine
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm mt-0.5">
                        Commit clean & verified M3U lineups to remote Git repositories automatically.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs gap-1 border-primary/30 text-primary">
                    <GitBranch className="h-3 w-3" /> v2 Sync
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 sm:p-6 space-y-5">
                {/* PAT Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="githubToken" className="text-xs font-semibold">
                      GitHub Personal Access Token (Classic / Fine-Grained)
                    </Label>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      Scopes: <code className="text-primary font-bold">repo</code>
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      id="githubToken"
                      type={showToken ? "text" : "password"}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={formData.githubToken}
                      onChange={(e) => change("githubToken", e.target.value)}
                      className="font-mono text-xs pr-10 h-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Target Repo Metadata Grid */}
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="githubOwner" className="text-xs font-semibold">
                      Repository Owner / Org
                    </Label>
                    <Input
                      id="githubOwner"
                      placeholder="e.g. iptv-org or your-username"
                      value={formData.githubOwner}
                      onChange={(e) => change("githubOwner", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="githubRepo" className="text-xs font-semibold">
                      Repository Name
                    </Label>
                    <Input
                      id="githubRepo"
                      placeholder="e.g. live-verified-streams"
                      value={formData.githubRepo}
                      onChange={(e) => change("githubRepo", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="githubBranch" className="text-xs font-semibold">
                      Target Branch
                    </Label>
                    <Input
                      id="githubBranch"
                      placeholder="main"
                      value={formData.githubBranch}
                      onChange={(e) => change("githubBranch", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="githubPath" className="text-xs font-semibold">
                      File Path in Repository
                    </Label>
                    <Input
                      id="githubPath"
                      placeholder="playlists/live.m3u8"
                      value={formData.githubPath}
                      onChange={(e) => change("githubPath", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                  </div>
                </div>

                {/* Auto Push Switch */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-muted/20 p-4">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-bold text-foreground">
                      Continuous Auto-Push on Pass Completion
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Directly commit and publish sanitized playlists right after health check finishes.
                    </p>
                  </div>
                  <Switch
                    checked={formData.githubAutoPush}
                    onCheckedChange={(checked) => change("githubAutoPush", checked)}
                  />
                </div>
              </CardContent>
            </div>

            {/* Test Connection Action Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/20 p-4 px-5 sm:px-6">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={testGitHub}
                disabled={testingGitHub || !formData.githubToken}
                className="h-9 gap-2 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/5"
              >
                {testingGitHub ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Verify GitHub Credentials
              </Button>

              {gitHubTestResult && (
                <div className="flex items-center gap-2 text-xs">
                  {gitHubTestResult.valid ? (
                    <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                      <CheckCircle2 className="h-4 w-4" /> Authenticated as @{gitHubTestResult.username}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-rose-500 font-semibold">
                      <AlertTriangle className="h-4 w-4" /> {gitHubTestResult.error}
                    </span>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* SECTION 2: NETWORK & CONCURRENCY POLICIES */}
          <div className="space-y-6">
            <Card className="border-border/80 bg-card/90 shadow-md">
              <CardHeader className="border-b border-border/70 bg-muted/30 p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                      <Zap className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="font-display text-xl font-bold">
                        Network Throughput & Lanes
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm mt-0.5">
                        Configure connection timeouts, backoff attempts, and simultaneous inspect lanes.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">
                    Parallel Engine
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 sm:p-6 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="defaultConcurrency" className="text-xs font-semibold">
                      Default Global Concurrency
                    </Label>
                    <Input
                      id="defaultConcurrency"
                      type="number"
                      value={formData.defaultConcurrency}
                      onChange={(e) => change("defaultConcurrency", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                    <p className="text-[11px] text-muted-foreground">Workers for new validation passes</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="perHostConcurrency" className="text-xs font-semibold">
                      Per-Host Rate Limit
                    </Label>
                    <Input
                      id="perHostConcurrency"
                      type="number"
                      value={formData.perHostConcurrency}
                      onChange={(e) => change("perHostConcurrency", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                    <p className="text-[11px] text-muted-foreground">Max connections to a single CDN domain</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="defaultTimeoutMs" className="text-xs font-semibold">
                      Connection Timeout (ms)
                    </Label>
                    <Input
                      id="defaultTimeoutMs"
                      type="number"
                      value={formData.defaultTimeoutMs}
                      onChange={(e) => change("defaultTimeoutMs", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                    <p className="text-[11px] text-muted-foreground">Response window before marked dead</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="defaultRetryCount" className="text-xs font-semibold">
                      Retry Attempts
                    </Label>
                    <Input
                      id="defaultRetryCount"
                      type="number"
                      value={formData.defaultRetryCount}
                      onChange={(e) => change("defaultRetryCount", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                    <p className="text-[11px] text-muted-foreground">Transient failover recovery tries</p>
                  </div>
                </div>

                {concurrencyMismatch && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      Global concurrency ({formData.defaultConcurrency}) exceeds hard ceiling (
                      {formData.maxConcurrency}) and will be clamped at runtime.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SECTION 3: DEEP MEDIA PROBE & GUARDRAILS */}
            <Card className="border-border/80 bg-card/90 shadow-md">
              <CardHeader className="border-b border-border/70 bg-muted/30 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                    <SearchCode className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="font-display text-lg font-bold">
                      FFprobe Codec Inspection & Limits
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Media container extraction and system concurrency guardrails.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-muted/20 p-3.5">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-bold text-foreground">
                      Automatic FFprobe Deep Stream Inspection
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Inspect video/audio stream codecs, resolution, bitrates, and FPS for live channels.
                    </p>
                  </div>
                  <Switch
                    checked={formData.autoProbeDefault}
                    onCheckedChange={(checked) => change("autoProbeDefault", checked)}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="ffprobePath" className="text-xs font-semibold">
                      FFprobe Executable Path
                    </Label>
                    <Input
                      id="ffprobePath"
                      value={formData.ffprobePath}
                      onChange={(e) => change("ffprobePath", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="maxConcurrency" className="text-xs font-semibold">
                      Maximum Permitted Concurrency Ceiling
                    </Label>
                    <Input
                      id="maxConcurrency"
                      type="number"
                      value={formData.maxConcurrency}
                      onChange={(e) => change("maxConcurrency", e.target.value)}
                      className="font-mono text-xs h-9"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Floating / Sticky Save Command Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">
                Settings persist immediately across the daemon cluster
              </p>
              <p className="text-xs text-muted-foreground">
                All subsequent validation passes will adopt these network parameters.
              </p>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={updateSettings.isPending}
            className="w-full sm:w-auto font-bold gap-2 text-sm shadow-md bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6"
          >
            {updateSettings.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {updateSettings.isPending ? "Saving..." : "Save Configuration"}
          </Button>
        </div>
      </form>
    </div>
  );
}
