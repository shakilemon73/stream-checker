import { useMemo, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListPlaylistsQueryKey,
  useDeletePlaylist,
  useListPlaylists,
  type Playlist,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Database,
  Download,
  FileText,
  FileWarning,
  Filter,
  FolderGit2,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  Loader2,
  Play,
  Plus,
  Radio,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Tv2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { triggerApiDownload } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export default function PlaylistLibrary() {
  const { data: playlists, isLoading, isError, error, refetch } = useListPlaylists();
  const deletePlaylist = useDeletePlaylist();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "channels" | "name">("recent");
  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(null);

  // Aggregate Metrics
  const totalChannels = playlists?.reduce((sum, p) => sum + p.entryCount, 0) ?? 0;
  const totalGroups = playlists?.reduce((sum, p) => sum + p.groups.length, 0) ?? 0;
  const githubSyncedCount =
    playlists?.filter((p) => (p as any).githubRepo || (p as any).autoPushGithub).length ?? 0;

  // Filtering & Sorting
  const filteredPlaylists = useMemo(() => {
    let list = (playlists ?? []).filter((playlist) => {
      const matchesSearch =
        `${playlist.name} ${playlist.sourceUrl ?? ""}`.toLowerCase().includes(search.toLowerCase());
      const matchesSource =
        sourceFilter === "all" || playlist.sourceType === sourceFilter;
      return matchesSearch && matchesSource;
    });

    return list.sort((a, b) => {
      if (sortBy === "channels") return b.entryCount - a.entryCount;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [playlists, search, sourceFilter, sortBy]);

  const handleDelete = () => {
    if (!playlistToDelete) return;
    deletePlaylist.mutate(
      { id: playlistToDelete.id },
      {
        onSuccess: () => {
          queryClient.setQueryData(getListPlaylistsQueryKey(), (current: typeof playlists) =>
            current?.filter((p) => p.id !== playlistToDelete.id)
          );
          setPlaylistToDelete(null);
          toast.success(`Playlist "${playlistToDelete.name}" removed from library.`);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not delete playlist."),
      }
    );
  };

  const handleExportM3U = async (e: React.MouseEvent, pl: Playlist) => {
    e.stopPropagation();
    try {
      toast.info(`Preparing M3U download for "${pl.name}"...`);
      await triggerApiDownload(
        `/api/playlists/${pl.id}/export`,
        `${pl.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.m3u8`
      );
      toast.success(`Exported "${pl.name}" as .m3u8`);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-8 px-4 py-6 sm:px-7 lg:px-10 lg:py-8">
      {/* Top Header Command Bar */}
      <header className="flex flex-col justify-between gap-6 border-b border-border/80 pb-7 lg:flex-row lg:items-end">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-bold text-primary">
              <Database className="h-3 w-3" />
              INVENTORY ARCHIVE
            </span>
            <span className="text-muted-foreground hidden sm:inline">·</span>
            <span className="text-muted-foreground hidden sm:inline">Lineup Management & Repository Sync</span>
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-foreground">
            Playlist Library
          </h1>
          <p className="max-w-2xl text-sm sm:text-[15px] leading-relaxed text-muted-foreground">
            Browse ingested M3U rosters, manage channel metadata, export standalone playlists, or launch instant validation checks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg" className="gap-2 font-bold shadow-md bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-5">
            <Link href="/">
              <Plus className="h-4 w-4" /> Ingest New Playlist
            </Link>
          </Button>
        </div>
      </header>

      {/* KPI Summary Telemetry */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/80 bg-card/80 shadow-sm">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                Total Playlists
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Database className="h-4 w-4" />
              </div>
            </div>
            <div className="font-display text-3xl font-bold text-foreground">
              {playlists?.length ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Active lineups cataloged</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/80 shadow-sm">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                Indexed Channels
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <Tv2 className="h-4 w-4" />
              </div>
            </div>
            <div className="font-display text-3xl font-bold text-foreground">
              {totalChannels.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Across all cataloged lineups</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/80 shadow-sm">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                Categories
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                <Layers className="h-4 w-4" />
              </div>
            </div>
            <div className="font-display text-3xl font-bold text-foreground">
              {totalGroups.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Organized content groups</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/80 shadow-sm">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">
                GitHub Connected
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                <FolderGit2 className="h-4 w-4" />
              </div>
            </div>
            <div className="font-display text-3xl font-bold text-foreground">
              {githubSyncedCount}
            </div>
            <p className="text-xs text-muted-foreground">Auto-pushing repositories</p>
          </CardContent>
        </Card>
      </section>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/60 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter playlists by name or source URL…"
            className="pl-10 h-10 bg-background text-sm font-medium"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Source Type Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Source:</span>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-10 w-32 text-xs bg-background">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="url">Remote URL</SelectItem>
                <SelectItem value="text">Direct Text</SelectItem>
                <SelectItem value="file">File Upload</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort By Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Sort:</span>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="h-10 w-36 text-xs bg-background">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most Recent</SelectItem>
                <SelectItem value="channels">Most Channels</SelectItem>
                <SelectItem value="name">Alphabetical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Playlists Grid / Cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl border border-border bg-card/60" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center p-12 text-center">
            <AlertTriangle className="mb-3 h-10 w-10 text-rose-500" />
            <h2 className="font-display text-xl font-bold">Library unavailable</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "The source service did not respond."}
            </p>
            <Button variant="outline" className="mt-5" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : filteredPlaylists.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center p-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground mb-4">
              <Database className="h-7 w-7" />
            </div>
            <h2 className="font-display text-xl font-bold text-foreground">
              {search ? "No matching playlists found" : "Your library is empty"}
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {search
                ? `No lineups match "${search}". Try searching by another keyword or reset filters.`
                : "Ingest an M3U stream roster or pick a curated preset from the dashboard to get started."}
            </p>
            {!search && (
              <Button asChild className="mt-6 gap-2" size="lg">
                <Link href="/">
                  <Plus className="h-4 w-4" /> Ingest your first playlist
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPlaylists.map((playlist) => {
            const pData = playlist as typeof playlist & {
              githubRepo?: string;
              githubBranch?: string;
              autoPushGithub?: boolean;
              lastPushedAt?: string;
            };

            const sourceIcon =
              playlist.sourceType === "url" ? (
                <Globe className="h-4 w-4 text-sky-500" />
              ) : playlist.sourceType === "file" ? (
                <Upload className="h-4 w-4 text-emerald-500" />
              ) : (
                <FileText className="h-4 w-4 text-amber-500" />
              );

            return (
              <Card
                key={playlist.id}
                className="group flex flex-col justify-between overflow-hidden border-border/80 bg-card transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg"
              >
                <div>
                  {/* Card Top Strip */}
                  <div className="flex items-center justify-between border-b border-border/70 bg-muted/25 px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary">
                        #{String(playlist.id).padStart(4, "0")}
                      </span>
                      <Badge variant="outline" className="gap-1 font-mono text-[10px] uppercase">
                        {sourceIcon} {playlist.sourceType}
                      </Badge>
                    </div>

                    {pData.autoPushGithub && (
                      <Badge variant="secondary" className="gap-1 text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                        <GitBranch className="h-3 w-3" /> Auto-Push
                      </Badge>
                    )}
                  </div>

                  {/* Card Body */}
                  <div className="p-5 space-y-4">
                    <div>
                      <Link href={`/playlists/${playlist.id}`}>
                        <h3 className="font-display text-lg font-bold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                          {playlist.name}
                        </h3>
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground mt-1">
                        Created {format(new Date(playlist.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>

                    {/* Stats Pill Matrix */}
                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                      <div className="text-center">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase">Channels</span>
                        <div className="font-display text-base font-bold text-foreground">
                          {playlist.entryCount.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-center border-l border-border/60">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase">Categories</span>
                        <div className="font-display text-base font-bold text-foreground">
                          {playlist.groups.length}
                        </div>
                      </div>
                    </div>

                    {/* Source URL or Metadata Info */}
                    {playlist.sourceUrl ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                        <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate font-mono text-[11px]">{playlist.sourceUrl}</span>
                      </div>
                    ) : pData.githubRepo ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                        <FolderGit2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate font-mono text-[11px]">{pData.githubRepo}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <HardDrive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-[11px]">Direct uploaded content</span>
                      </div>
                    )}

                    {/* Warnings & Duplicates Chips */}
                    {(playlist.parseWarnings.length > 0 || playlist.duplicatesFound > 0) && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {playlist.parseWarnings.length > 0 && (
                          <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] font-mono text-amber-600">
                            <FileWarning className="h-3 w-3" /> {playlist.parseWarnings.length} warnings
                          </Badge>
                        )}
                        {playlist.duplicatesFound > 0 && (
                          <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/10 text-[10px] font-mono text-indigo-600">
                            {playlist.duplicatesFound} duplicates removed
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="flex items-center justify-between border-t border-border/70 bg-muted/20 p-3 px-5">
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      asChild
                      className="h-8 gap-1 text-xs font-semibold hover:bg-primary/5 hover:text-primary"
                    >
                      <Link href={`/playlists/${playlist.id}`}>
                        <Settings className="h-3.5 w-3.5" /> Studio
                      </Link>
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => handleExportM3U(e, playlist)}
                      className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                      title="Download .m3u8"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPlaylistToDelete(playlist)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete playlist"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      size="sm"
                      asChild
                      className="h-8 gap-1 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Link href={`/playlists/${playlist.id}`}>
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Alert */}
      <AlertDialog open={playlistToDelete !== null} onOpenChange={(open) => !open && setPlaylistToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold">
              Delete "{playlistToDelete?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this playlist, all its indexed channels, and associated validation passes. This action cannot be reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deletePlaylist.isPending}
            >
              {deletePlaylist.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deletePlaylist.isPending ? "Deleting..." : "Delete Playlist"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
