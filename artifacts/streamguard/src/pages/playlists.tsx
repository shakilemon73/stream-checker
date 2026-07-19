import { useState } from "react";
import { useListPlaylists, useDeletePlaylist } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, ListVideo, AlertTriangle, Plus, Trash2 } from "lucide-react";
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

export default function PlaylistLibrary() {
  const { data: playlists, isLoading } = useListPlaylists();
  const deletePlaylist = useDeletePlaylist();
  const [search, setSearch] = useState("");
  const [playlistToDelete, setPlaylistToDelete] = useState<number | null>(null);

  const filteredPlaylists = playlists?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    (p.sourceUrl && p.sourceUrl.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  const handleDelete = () => {
    if (playlistToDelete !== null) {
      deletePlaylist.mutate({ id: playlistToDelete }, {
        onSuccess: () => setPlaylistToDelete(null)
      });
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Playlist Library</h1>
          <p className="text-muted-foreground mt-1 text-lg">Manage ingested M3U sources</p>
        </div>
        <Button asChild className="shrink-0 font-bold tracking-wide">
          <Link href="/">
            <Plus className="w-5 h-5 mr-2" /> NEW PLAYLIST
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search playlists..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredPlaylists.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-12 text-muted-foreground">
            <ListVideo className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">No playlists found</p>
            <p className="text-sm">Upload or paste a playlist on the dashboard to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredPlaylists.map(playlist => (
            <Card key={playlist.id} className="overflow-hidden hover:border-primary/50 transition-colors">
              <div className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg truncate" title={playlist.name}>{playlist.name}</h3>
                    <Badge variant="secondary" className="uppercase text-[10px] tracking-widest">{playlist.sourceType}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono">
                    <span>{playlist.entryCount.toLocaleString()} channels</span>
                    <span>•</span>
                    <span className="truncate max-w-[200px]" title={playlist.sourceUrl || "Uploaded file/text"}>
                      {playlist.sourceUrl || "Uploaded file/text"}
                    </span>
                    <span>•</span>
                    <span>{format(new Date(playlist.createdAt), "MMM d, yyyy")}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 md:gap-6 shrink-0">
                  <div className="flex gap-2">
                    {playlist.parseWarnings.length > 0 && (
                      <Badge variant="outline" className="bg-[hsl(var(--suspicious))]/10 text-[hsl(var(--suspicious))] border-[hsl(var(--suspicious))]/20 gap-1 font-mono">
                        <AlertTriangle className="w-3 h-3" />
                        {playlist.parseWarnings.length} Warnings
                      </Badge>
                    )}
                    {playlist.duplicatesFound > 0 && (
                      <Badge variant="outline" className="bg-[hsl(var(--geoblocked))]/10 text-[hsl(var(--geoblocked))] border-[hsl(var(--geoblocked))]/20 font-mono">
                        {playlist.duplicatesFound} Duplicates
                      </Badge>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 border-l pl-4 md:pl-6">
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-[hsl(var(--dead))]" onClick={() => setPlaylistToDelete(playlist.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={playlistToDelete !== null} onOpenChange={(open) => !open && setPlaylistToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Playlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this playlist? This action cannot be undone and will not affect historical job runs that used this playlist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
