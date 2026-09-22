import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  useGetPlaylist,
  useGetPlaylistChannels,
  useListJobs,
  getGetPlaylistQueryKey,
  getGetPlaylistChannelsQueryKey,
  getListJobsQueryKey,
  getListPlaylistsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  ExternalLink,
  FileWarning,
  FolderGit2,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Tv2,
  Upload,
  X,
  Check,
  CheckCircle2,
  XCircle,
  Globe,
  Copy,
  Layers,
} from "lucide-react";
import type { Channel } from "@workspace/api-client-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { triggerApiDownload } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StreamPlayer } from "@/components/stream-player";
import { PlaylistEditorDialog } from "@/components/playlist-editor-dialog";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

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

export default function PlaylistDetail() {
  const [, params] = useRoute("/playlists/:id");
  const playlistId = Number(params?.id);
  const validId = Number.isInteger(playlistId) && playlistId > 0;
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Dialogs state
  const [editPlaylistOpen, setEditPlaylistOpen] = useState(false);
  const [githubPushOpen, setGithubPushOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [channelModalMode, setChannelModalMode] = useState<"add" | "edit">("add");
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);

  // Forms state
  const [playlistForm, setPlaylistForm] = useState({
    name: "",
    githubRepo: "",
    githubBranch: "main",
    githubPath: "",
    autoPushGithub: false,
  });

  const [channelForm, setChannelForm] = useState<{
    id?: number;
    tvgName: string;
    tvgLogo: string;
    url: string;
    groupTitle: string;
    userAgent: string;
    referrer: string;
    tvgId: string;
    language: string;
    country: string;
  }>({
    tvgName: "",
    tvgLogo: "",
    url: "",
    groupTitle: "",
    userAgent: "",
    referrer: "",
    tvgId: "",
    language: "",
    country: "",
  });

  const [githubPushForm, setGithubPushForm] = useState({
    message: "",
    repo: "",
    branch: "",
    path: "",
  });
  const [pushingGithub, setPushingGithub] = useState(false);
  const [pushResult, setPushResult] = useState<{ commitUrl?: string; fileUrl?: string; message?: string } | null>(null);
  const [bulkGroupInput, setBulkGroupInput] = useState("");
  const [bulkUaInput, setBulkUaInput] = useState("");

  const { data: playlist, isLoading: playlistLoading, isError: playlistError } = useGetPlaylist(playlistId, {
    query: { enabled: validId, queryKey: getGetPlaylistQueryKey(playlistId) },
  });

  const { data: channelPage, isLoading: channelsLoading } = useGetPlaylistChannels(
    playlistId,
    {
      page,
      limit: PAGE_SIZE,
      ...(group !== "all" ? { group } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    },
    {
      query: {
        enabled: validId,
        queryKey: getGetPlaylistChannelsQueryKey(playlistId, {
          page,
          limit: PAGE_SIZE,
          ...(group !== "all" ? { group } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
        }),
      },
    }
  );

  const { data: jobs, isLoading: jobsLoading } = useListJobs({
    query: { enabled: validId, queryKey: getListJobsQueryKey() },
  });

  const playlistJobs = useMemo(
    () => jobs?.filter((job) => job.playlistId === playlistId) ?? [],
    [jobs, playlistId]
  );
  const totalPages = Math.max(1, Math.ceil((channelPage?.total ?? 0) / PAGE_SIZE));
  const groups = playlist?.groups ?? [];

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    setSelectedIds([]);
  };

  const handleGroup = (value: string) => {
    setGroup(value);
    setPage(1);
    setSelectedIds([]);
  };

  // Open Edit Playlist Dialog using PlaylistEditorDialog
  const openEditPlaylist = () => {
    setEditPlaylistOpen(true);
  };

  const [isSavingChannel, setIsSavingChannel] = useState(false);
  const [channelTouched, setChannelTouched] = useState<Record<string, boolean>>({});

  // Real-time Zod validation schema for Channel
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
      groupTitle: z.string().trim(),
      userAgent: z.string().trim(),
      tvgId: z.string().trim(),
    });

    const res = channelSchema.safeParse(channelForm);
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
  }, [channelForm]);

  // Open Add Channel
  const openAddChannel = () => {
    setChannelModalMode("add");
    setChannelForm({
      tvgName: "",
      tvgLogo: "",
      url: "",
      groupTitle: group !== "all" ? group : (groups[0] || "General"),
      userAgent: "",
      referrer: "",
      tvgId: "",
      language: "",
      country: "",
    });
    setChannelTouched({});
    setChannelModalOpen(true);
  };

  // Open Edit Channel
  const openEditChannel = (ch: Channel) => {
    setChannelModalMode("edit");
    setChannelForm({
      id: ch.id,
      tvgName: ch.tvgName || "",
      tvgLogo: ch.tvgLogo || "",
      url: ch.url,
      groupTitle: ch.groupTitle || "General",
      userAgent: ch.userAgent || "",
      referrer: ch.referrer || "",
      tvgId: ch.tvgId || "",
      language: ch.language || "",
      country: ch.country || "",
    });
    setChannelTouched({});
    setChannelModalOpen(true);
  };

  // Save Channel (Add or Edit)
  const saveChannel = async () => {
    setChannelTouched({
      tvgName: true,
      url: true,
      tvgLogo: true,
      referrer: true,
    });

    if (isSavingChannel) return; // Prevent duplicate submissions

    if (!channelValidation.isValid) {
      const firstErr =
        Object.values(channelValidation.errors)[0] || "Please resolve form validation errors";
      toast.error(firstErr);
      return;
    }

    setIsSavingChannel(true);

    try {
      if (channelModalMode === "add") {
        const res = await fetch(`/api/playlists/${playlistId}/channels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(channelForm),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Server error" }));
          throw new Error(errData.error || "Failed to add channel");
        }
        const createdChannel: Channel = await res.json();

        // 1. Instantly update all cached channel queries
        queryClient.setQueriesData(
          {
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              typeof query.queryKey[0] === "string" &&
              query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
          },
          (old: any) => {
            if (!old || !Array.isArray(old.channels)) return old;
            return {
              ...old,
              total: (old.total ?? 0) + 1,
              channels: [createdChannel, ...old.channels],
            };
          }
        );

        // 2. Instantly update playlist summary groups & entryCount
        queryClient.setQueryData(getGetPlaylistQueryKey(playlistId), (old: any) => {
          if (!old) return old;
          const existingGroups = Array.isArray(old.groups) ? old.groups : [];
          const hasGroup = createdChannel.groupTitle && existingGroups.includes(createdChannel.groupTitle);
          return {
            ...old,
            entryCount: (old.entryCount || 0) + 1,
            groups: hasGroup || !createdChannel.groupTitle ? existingGroups : [...existingGroups, createdChannel.groupTitle],
          };
        });

        // 3. Update library playlist entryCount
        queryClient.setQueryData(getListPlaylistsQueryKey(), (old: any) => {
          if (!Array.isArray(old)) return old;
          return old.map((p: any) =>
            p.id === playlistId ? { ...p, entryCount: (p.entryCount || 0) + 1 } : p
          );
        });

        setSelectedChannel(createdChannel);
        toast.success(`Channel "${createdChannel.tvgName || 'Channel'}" added and saved`);
      } else {
        const res = await fetch(`/api/playlists/${playlistId}/channels/${channelForm.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(channelForm),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Server error" }));
          throw new Error(errData.error || "Failed to update channel");
        }
        const updatedChannel: Channel = await res.json();

        // 1. Instantly update selectedChannel if playing
        if (selectedChannel?.id === updatedChannel.id) {
          setSelectedChannel(updatedChannel);
        }

        // 2. Instantly update channel in all cached queries
        queryClient.setQueriesData(
          {
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              typeof query.queryKey[0] === "string" &&
              query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
          },
          (old: any) => {
            if (!old || !Array.isArray(old.channels)) return old;
            return {
              ...old,
              channels: old.channels.map((c: Channel) =>
                c.id === updatedChannel.id ? { ...c, ...updatedChannel } : c
              ),
            };
          }
        );

        // 3. Instantly update groups in playlist if changed
        queryClient.setQueryData(getGetPlaylistQueryKey(playlistId), (old: any) => {
          if (!old) return old;
          const existingGroups = Array.isArray(old.groups) ? old.groups : [];
          if (updatedChannel.groupTitle && !existingGroups.includes(updatedChannel.groupTitle)) {
            return { ...old, groups: [...existingGroups, updatedChannel.groupTitle] };
          }
          return old;
        });

        toast.success(`Channel "${updatedChannel.tvgName || 'Channel'}" saved instantly`);
      }

      setChannelModalOpen(false);

      // Invalidate queries so server confirms state
      await Promise.all([
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        }),
        queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(playlistId) }),
        queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }),
      ]);
    } catch (err) {
      toast.error(`Error saving channel: ${(err as Error).message}`);
    } finally {
      setIsSavingChannel(false);
    }
  };

  // Delete single channel
  const deleteChannel = async (ch: Channel) => {
    if (!confirm(`Are you sure you want to delete "${ch.tvgName || 'Channel'}"?`)) return;
    try {
      // 1. Instantly remove from cached queries
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        },
        (old: any) => {
          if (!old || !Array.isArray(old.channels)) return old;
          return {
            ...old,
            total: Math.max(0, (old.total ?? 1) - 1),
            channels: old.channels.filter((c: Channel) => c.id !== ch.id),
          };
        }
      );

      // 2. Instantly update playlist count
      queryClient.setQueryData(getGetPlaylistQueryKey(playlistId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          entryCount: Math.max(0, (old.entryCount || 1) - 1),
        };
      });

      if (selectedChannel?.id === ch.id) setSelectedChannel(null);
      toast.success("Channel removed instantly");

      const res = await fetch(`/api/playlists/${playlistId}/channels/${ch.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());

      await Promise.all([
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        }),
        queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(playlistId) }),
        queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }),
      ]);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
      });
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const countToDelete = selectedIds.length;
    if (!confirm(`Delete ${countToDelete} selected channels permanently?`)) return;

    try {
      const idsToRemove = [...selectedIds];
      setSelectedIds([]);

      // 1. Instantly remove from query cache
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        },
        (old: any) => {
          if (!old || !Array.isArray(old.channels)) return old;
          return {
            ...old,
            total: Math.max(0, (old.total ?? idsToRemove.length) - idsToRemove.length),
            channels: old.channels.filter((c: Channel) => !idsToRemove.includes(c.id)),
          };
        }
      );

      // 2. Instantly update playlist count
      queryClient.setQueryData(getGetPlaylistQueryKey(playlistId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          entryCount: Math.max(0, (old.entryCount || idsToRemove.length) - idsToRemove.length),
        };
      });

      toast.success(`Deleted ${countToDelete} channels`);

      const res = await fetch(`/api/playlists/${playlistId}/channels/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelIds: idsToRemove }),
      });
      if (!res.ok) throw new Error(await res.text());

      await Promise.all([
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        }),
        queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(playlistId) }),
        queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }),
      ]);
    } catch (err) {
      toast.error(`Bulk delete failed: ${(err as Error).message}`);
    }
  };

  // Bulk Update Category & User-Agent
  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    const targetIds = [...selectedIds];
    const newGroup = bulkGroupInput.trim();
    const newUa = bulkUaInput.trim();

    try {
      // 1. Instantly reflect in cache
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        },
        (old: any) => {
          if (!old || !Array.isArray(old.channels)) return old;
          return {
            ...old,
            channels: old.channels.map((c: Channel) => {
              if (!targetIds.includes(c.id)) return c;
              return {
                ...c,
                ...(newGroup ? { groupTitle: newGroup } : {}),
                ...(newUa ? { userAgent: newUa } : {}),
              };
            }),
          };
        }
      );

      // If selectedChannel was updated, update it too
      if (selectedChannel && targetIds.includes(selectedChannel.id)) {
        setSelectedChannel({
          ...selectedChannel,
          ...(newGroup ? { groupTitle: newGroup } : {}),
          ...(newUa ? { userAgent: newUa } : {}),
        });
      }

      toast.success(`Updated ${targetIds.length} channels instantly`);
      setBulkCategoryOpen(false);
      setSelectedIds([]);

      const res = await fetch(`/api/playlists/${playlistId}/channels/bulk-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelIds: targetIds,
          ...(newGroup ? { groupTitle: newGroup } : {}),
          ...(newUa ? { userAgent: newUa } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());

      await Promise.all([
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        }),
        queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(playlistId) }),
        queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }),
      ]);
    } catch (err) {
      toast.error(`Bulk update failed: ${(err as Error).message}`);
    }
  };

  // Bulk Mark Active / Inactive
  const handleBulkMarkStatus = async (status: "Active" | "Inactive") => {
    if (selectedIds.length === 0) return;
    const targetIds = [...selectedIds];

    try {
      // 1. Instantly update react-query cache
      queryClient.setQueriesData(
        {
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        },
        (old: any) => {
          if (!old || !Array.isArray(old.channels)) return old;
          return {
            ...old,
            channels: old.channels.map((c: Channel) => {
              if (!targetIds.includes(c.id)) return c;
              return { ...c, groupTitle: status };
            }),
          };
        }
      );

      toast.success(`Marked ${targetIds.length} channels as ${status}`);

      const res = await fetch(`/api/playlists/${playlistId}/channels/bulk-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelIds: targetIds,
          groupTitle: status,
        }),
      });
      if (!res.ok) throw new Error(await res.text());

      await Promise.all([
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            typeof query.queryKey[0] === "string" &&
            query.queryKey[0].startsWith(`/api/playlists/${playlistId}/channels`),
        }),
        queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(playlistId) }),
        queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }),
      ]);
    } catch (err) {
      toast.error(`Failed to mark channels as ${status}: ${(err as Error).message}`);
    }
  };

  // Export M3U
  const downloadM3U = async () => {
    try {
      toast.info("Preparing M3U download...");
      const params = new URLSearchParams();
      if (selectedGroup && selectedGroup !== "all") params.set("group", selectedGroup);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const queryStr = params.toString() ? `?${params.toString()}` : "";

      const defaultFilename = `${playlist?.name ? playlist.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_") : "playlist"}.m3u8`;
      await triggerApiDownload(`/api/playlists/${playlistId}/export${queryStr}`, defaultFilename);
      toast.success("M3U playlist downloaded!");
    } catch (err) {
      toast.error(`Download failed: ${(err as Error).message}`);
    }
  };

  // Export Selected Channels as M3U
  const exportSelectedM3U = async () => {
    if (selectedIds.length === 0) {
      await downloadM3U();
      return;
    }
    try {
      toast.info(`Preparing M3U export for ${selectedIds.length} selected channels...`);
      const defaultFilename = `${playlist?.name ? playlist.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_") : "playlist"}_selected.m3u8`;
      await triggerApiDownload(
        `/api/playlists/${playlistId}/export?channelIds=${selectedIds.join(",")}`,
        defaultFilename
      );
      toast.success(`Exported ${selectedIds.length} selected channels as M3U file`);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  // Open GitHub Push Modal
  const openGithubPush = () => {
    const p = playlist as typeof playlist & {
      githubRepo?: string;
      githubBranch?: string;
      githubPath?: string;
    };
    setGithubPushForm({
      message: `Update ${playlist?.name} M3U via StreamGuard (${playlist?.entryCount} channels)`,
      repo: p?.githubRepo || "",
      branch: p?.githubBranch || "main",
      path: p?.githubPath || `${playlist?.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.m3u8`,
    });
    setPushResult(null);
    setGithubPushOpen(true);
  };

  // Trigger GitHub Push
  const triggerGithubPush = async () => {
    setPushingGithub(true);
    setPushResult(null);
    try {
      const res = await fetch(`/api/playlists/${playlistId}/github-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(githubPushForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GitHub push failed");

      setPushResult(data);
      toast.success("Successfully pushed M3U playlist to GitHub!");
      queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(playlistId) });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPushingGithub(false);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked && channelPage?.channels) {
      setSelectedIds(channelPage.channels.map((c) => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  if (!validId || playlistError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-10">
        <Button variant="ghost" asChild className="-ml-3 mb-6 gap-2">
          <Link href="/playlists"><ArrowLeft className="h-4 w-4" /> Back to library</Link>
        </Button>
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <FileWarning className="mx-auto mb-3 h-10 w-10 text-destructive/70" />
            <h1 className="font-display text-xl font-bold">Playlist not found</h1>
            <p className="text-muted-foreground mt-1">This playlist may have been deleted or the link is invalid.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (playlistLoading || !playlist) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-8 sm:px-7 lg:px-10">
        <div className="h-10 w-52 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const pData = playlist as typeof playlist & {
    githubRepo?: string;
    githubBranch?: string;
    githubPath?: string;
    autoPushGithub?: boolean;
    lastPushedAt?: string;
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-7 lg:px-10 lg:py-8">
      {/* Top Header Navigation & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" asChild className="-ml-3 gap-2">
          <Link href="/playlists"><ArrowLeft className="h-4 w-4" /> Back to library</Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={downloadM3U} className="gap-1.5 shadow-sm">
            <Download className="h-3.5 w-3.5" /> Export .m3u8
          </Button>
          <Button variant="outline" size="sm" onClick={openGithubPush} className="gap-1.5 shadow-sm text-primary border-primary/30 hover:bg-primary/5">
            <FolderGit2 className="h-3.5 w-3.5" /> Push to GitHub
          </Button>
          <Button variant="outline" size="sm" onClick={openEditPlaylist} className="gap-1.5 shadow-sm">
            <Settings className="h-3.5 w-3.5" /> Edit Playlist
          </Button>
          <Button asChild size="sm" className="gap-1.5 shadow-sm">
            <Link href="/"><Play className="h-3.5 w-3.5 fill-current" /> Run Check</Link>
          </Button>
        </div>
      </div>

      {/* Playlist Hero Info */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-primary font-semibold">
            <span>PLAYLIST #{String(playlist.id).padStart(4, "0")}</span>
            {pData.autoPushGithub && (
              <Badge variant="secondary" className="gap-1 text-[10px] bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                <GitBranch className="h-3 w-3" /> Auto-Push Enabled
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h1 className="max-w-3xl break-words font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {playlist.name}
            </h1>
            <Badge variant="outline" className="font-mono text-xs uppercase tracking-wider">{playlist.sourceType}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage channels, customize logos, update stream links, and synchronize directly with GitHub.
          </p>
        </div>

        {/* GitHub status badge */}
        {pData.githubRepo && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 p-2.5 text-xs text-muted-foreground">
            <FolderGit2 className="h-4 w-4 text-primary shrink-0" />
            <div className="truncate max-w-xs">
              <span className="font-medium text-foreground">{pData.githubRepo}</span>
              <span className="text-muted-foreground font-mono ml-1">@{pData.githubBranch || "main"}</span>
              {pData.lastPushedAt && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Last pushed: {format(new Date(pData.lastPushedAt), "MMM d, HH:mm")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Channels", playlist.entryCount.toLocaleString(), "indexed entries"],
          ["Categories", playlist.groups.length.toString(), "content groups"],
          ["Duplicates", playlist.duplicatesFound.toString(), "detected on ingest"],
          ["Created", format(new Date(playlist.createdAt), "MMM d, yyyy"), "catalog timestamp"],
        ].map(([label, value, note]) => (
          <Card key={label} className="border-border/80 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
              <div className="mt-2 font-display text-2xl font-bold">{value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{note}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Source URL Banner */}
      {playlist.sourceUrl && (
        <Card className="border-border/70 bg-card/40">
          <CardContent className="flex items-center justify-between gap-3 p-3.5 text-sm">
            <div className="flex items-center gap-2 truncate text-muted-foreground">
              <ExternalLink className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-medium text-foreground shrink-0">Source URL:</span>
              <a href={playlist.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">
                {playlist.sourceUrl}
              </a>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigator.clipboard.writeText(playlist.sourceUrl!)}>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active Stream Player Preview */}
      {selectedChannel && (
        <div className="rounded-xl border border-primary/30 bg-card p-4 sm:p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between gap-3 border-b border-border/80 pb-3">
            <div className="flex items-center gap-3 min-w-0">
              {selectedChannel.tvgLogo ? (
                <img
                  src={selectedChannel.tvgLogo}
                  alt=""
                  className="h-10 w-10 rounded-lg object-contain bg-black/40 border border-white/10 p-1 shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <Tv2 className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-base font-bold truncate">{selectedChannel.tvgName || selectedChannel.tvgId || "Unnamed Channel"}</h3>
                  <Badge variant="outline" className="text-[10px]">{selectedChannel.groupTitle || "General"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate max-w-xl font-mono mt-0.5">{selectedChannel.url}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => openEditChannel(selectedChannel)}>
                <Edit2 className="h-3.5 w-3.5" /> Edit Channel
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedChannel(null)} aria-label="Close player">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <StreamPlayer
            key={selectedChannel.id}
            url={selectedChannel.url}
            title={selectedChannel.tvgName ?? undefined}
            poster={selectedChannel.tvgLogo}
            userAgent={selectedChannel.userAgent}
            referrer={selectedChannel.referrer}
            className="w-full shadow-inner"
          />
        </div>
      )}

      {/* Floating / Sticky Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="sticky top-4 z-20 my-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-slate-900/95 px-4 py-3 text-slate-100 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-primary/20 text-primary border border-primary/30 font-mono text-xs font-bold">
              {selectedIds.length} Selected
            </Badge>
            <button
              onClick={() => setSelectedIds([])}
              className="text-xs text-slate-400 hover:text-slate-200 underline font-medium"
            >
              Deselect All
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleBulkMarkStatus("Active")}
              className="h-8 gap-1.5 text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 font-semibold"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Mark Active
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleBulkMarkStatus("Inactive")}
              className="h-8 gap-1.5 text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 font-semibold"
            >
              <XCircle className="h-3.5 w-3.5 text-amber-400" /> Mark Inactive
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkCategoryOpen(true)}
              className="h-8 gap-1.5 text-xs bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 font-semibold"
            >
              <Layers className="h-3.5 w-3.5" /> Batch Category/UA
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportSelectedM3U}
              className="h-8 gap-1.5 text-xs bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 font-semibold"
            >
              <Download className="h-3.5 w-3.5 text-primary" /> Export M3U ({selectedIds.length})
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
              className="h-8 gap-1.5 text-xs font-semibold shadow-sm"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Main Channel Inventory Table & Management Studio */}
      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardHeader className="border-b border-border/70 bg-card/60 p-4 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 font-display text-xl">
                <Tv2 className="h-5 w-5 text-primary" /> Channel Studio & Inventory
              </CardTitle>
              <CardDescription className="mt-1">
                Edit stream URLs, customize logos, configure User-Agents, and organize channel categories.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportSelectedM3U} className="h-8 gap-1.5 text-xs font-semibold shadow-xs">
                <Download className="h-3.5 w-3.5" /> {selectedIds.length > 0 ? `Export Selected (${selectedIds.length})` : "Export Filtered M3U"}
              </Button>
              <Button size="sm" onClick={openAddChannel} className="h-8 gap-1.5 text-xs font-semibold shadow-sm">
                <Plus className="h-4 w-4" /> Add Channel
              </Button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-col gap-3 pt-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search channel names, URLs, or categories…"
                className="pl-9"
              />
            </div>
            <Select value={group} onValueChange={handleGroup}>
              <SelectTrigger className="sm:w-64">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories ({playlist.entryCount})</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {channelsLoading ? (
            <div className="space-y-3 p-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          ) : !channelPage || channelPage.channels.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <Tv2 className="h-10 w-10 text-muted-foreground/50 mx-auto" />
              <p className="text-sm font-semibold text-foreground">No channels found</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No channels match your current search filters or category.
              </p>
              <Button size="sm" variant="outline" onClick={openAddChannel} className="mt-2 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add a Channel
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile Card-Based Stack Layout (< md) */}
              <div className="grid gap-3 p-3 sm:p-4 md:hidden">
                <div className="flex items-center justify-between px-1 pb-2 border-b border-border/50 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={channelPage.channels.length > 0 && selectedIds.length === channelPage.channels.length}
                      onCheckedChange={toggleSelectAll}
                      id="select-all-mobile"
                    />
                    <Label htmlFor="select-all-mobile" className="font-semibold text-xs text-foreground cursor-pointer">
                      Select All Page Channels ({channelPage.channels.length})
                    </Label>
                  </div>
                  <span className="font-mono text-[11px]">{selectedIds.length} selected</span>
                </div>

                {channelPage.channels.map((channel, idx) => {
                  const isSelected = selectedIds.includes(channel.id);
                  return (
                    <div
                      key={channel.id}
                      className={cn(
                        "relative flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-xs transition-all min-w-0 overflow-hidden",
                        isSelected && "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                      )}
                    >
                      {/* Top bar: Checkbox, index, Logo, Name & Category */}
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectOne(channel.id)}
                            className="mt-1 shrink-0"
                            aria-label={`Select ${channel.tvgName}`}
                          />

                          {/* Logo */}
                          {channel.tvgLogo ? (
                            <img
                              src={channel.tvgLogo}
                              alt=""
                              className="h-9 w-9 rounded-lg object-contain bg-black/30 border border-border/60 p-0.5 shrink-0"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground border border-border/50 shrink-0">
                              <Tv2 className="h-4 w-4" />
                            </div>
                          )}

                          {/* Name & TVG ID */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-[11px] font-bold text-muted-foreground shrink-0">
                                #{(page - 1) * PAGE_SIZE + idx + 1}
                              </span>
                              <h4 className="font-display font-bold text-sm text-foreground truncate min-w-0">
                                {channel.tvgName || channel.tvgId || "Unnamed Channel"}
                              </h4>
                            </div>
                            {channel.tvgId && (
                              <p className="text-[10px] font-mono text-muted-foreground truncate max-w-full mt-0.5">
                                ID: {channel.tvgId}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Category Badge */}
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] shrink-0 truncate max-w-[100px] font-medium",
                            channel.groupTitle === "Active" && "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
                            channel.groupTitle === "Inactive" && "bg-slate-500/15 text-slate-400 border-slate-500/30"
                          )}
                        >
                          {channel.groupTitle || "General"}
                        </Badge>
                      </div>

                      {/* Stream URL Container (Bounded with truncate) */}
                      <div className="rounded-lg bg-muted/40 p-2 border border-border/40 min-w-0 overflow-hidden">
                        <p className="text-[11px] font-mono text-muted-foreground truncate break-all max-w-full">
                          {channel.url}
                        </p>
                        {(channel.userAgent || channel.referrer) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {channel.userAgent && (
                              <Badge variant="secondary" className="text-[9px] font-mono bg-primary/10 text-primary truncate max-w-[150px]">
                                UA: {channel.userAgent}
                              </Badge>
                            )}
                            {channel.referrer && (
                              <Badge variant="secondary" className="text-[9px] font-mono bg-sky-500/10 text-sky-600 truncate max-w-[150px]">
                                Ref: {channel.referrer}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Card Footer / Quick Action Controls */}
                      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2.5 mt-0.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelectedChannel(channel)}
                          className="h-7 px-2.5 text-xs gap-1.5 bg-primary/10 text-primary hover:bg-primary/20 font-semibold"
                        >
                          <Play className="h-3 w-3 fill-current" /> Preview
                        </Button>

                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditChannel(channel)}
                            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                          >
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteChannel(channel)}
                            className="h-7 px-2 text-xs gap-1 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Tabular Layout (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={channelPage.channels.length > 0 && selectedIds.length === channelPage.channels.length}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-12">Logo</TableHead>
                      <TableHead>Channel Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="hidden lg:table-cell">Headers / Stream URL</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {channelPage.channels.map((channel, idx) => {
                      const isSelected = selectedIds.includes(channel.id);
                      return (
                        <TableRow
                          key={channel.id}
                          className={cn(
                            "transition-colors hover:bg-muted/30",
                            isSelected && "bg-primary/5"
                          )}
                        >
                          <TableCell className="py-2.5">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelectOne(channel.id)}
                              aria-label={`Select ${channel.tvgName}`}
                            />
                          </TableCell>

                          <TableCell className="font-mono text-xs text-muted-foreground py-2.5">
                            {(page - 1) * PAGE_SIZE + idx + 1}
                          </TableCell>

                          {/* Channel Logo Thumbnail */}
                          <TableCell className="py-2.5">
                            {channel.tvgLogo ? (
                              <img
                                src={channel.tvgLogo}
                                alt=""
                                className="h-8 w-8 rounded object-contain bg-black/30 border border-border/60 p-0.5"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src =
                                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='15' x='2' y='7' rx='2' ry='2'/%3E%3Cpolyline points='17 2 12 7 7 2'/%3E%3C/svg%3E";
                                }}
                              />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded bg-muted/60 text-muted-foreground border border-border/50">
                                <Tv2 className="h-4 w-4" />
                              </div>
                            )}
                          </TableCell>

                          {/* Channel Name & TVG ID */}
                          <TableCell className="py-2.5 min-w-0">
                            <div className="font-semibold text-sm text-foreground truncate max-w-[220px]">
                              {channel.tvgName || channel.tvgId || "Unnamed Channel"}
                            </div>
                            {channel.tvgId && (
                              <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
                                ID: {channel.tvgId}
                              </div>
                            )}
                          </TableCell>

                          {/* Category Badge */}
                          <TableCell className="py-2.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "max-w-[150px] truncate text-xs font-normal",
                                channel.groupTitle === "Active" && "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 font-semibold",
                                channel.groupTitle === "Inactive" && "bg-slate-500/15 text-slate-400 border-slate-500/30"
                              )}
                            >
                              {channel.groupTitle || "General"}
                            </Badge>
                          </TableCell>

                          {/* Stream URL & User Agent badge */}
                          <TableCell className="hidden lg:table-cell py-2.5 min-w-0">
                            <div className="font-mono text-xs text-muted-foreground truncate max-w-[340px]">
                              {channel.url}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {channel.userAgent && (
                                <Badge variant="secondary" className="text-[10px] font-mono bg-primary/10 text-primary truncate max-w-[180px]">
                                  UA: {channel.userAgent}
                                </Badge>
                              )}
                              {channel.referrer && (
                                <Badge variant="secondary" className="text-[10px] font-mono bg-sky-500/10 text-sky-600 truncate max-w-[180px]">
                                  Ref: {channel.referrer}
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="text-right py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-primary hover:bg-primary/10"
                                onClick={() => setSelectedChannel(channel)}
                                title="Play Stream"
                                aria-label="Play Stream"
                              >
                                <Play className="h-4 w-4 fill-current" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => openEditChannel(channel)}
                                title="Edit Channel"
                                aria-label="Edit Channel"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                                onClick={() => deleteChannel(channel)}
                                title="Delete Channel"
                                aria-label="Delete Channel"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 p-4 bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, channelPage.total)} of{" "}
                  {channelPage.total.toLocaleString()} channels
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((c) => Math.max(1, c - 1))}
                    disabled={page <= 1}
                    className="h-8 text-xs"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Previous
                  </Button>
                  <span className="text-xs font-mono px-2">
                    Page {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((c) => Math.min(totalPages, c + 1))}
                    disabled={page >= totalPages}
                    className="h-8 text-xs"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Validation History */}
      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-xl">Validation history</CardTitle>
          <CardDescription>Stream health checks previously run for this playlist.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
            </div>
          ) : playlistJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No validation jobs yet for this playlist.</p>
          ) : (
            <div className="space-y-2">
              {playlistJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5 hover:border-primary/50 transition-colors bg-card"
                >
                  <div>
                    <p className="font-semibold text-sm">Job #{job.id}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(job.createdAt), "MMM d, yyyy 'at' HH:mm")} · {job.checked}/{job.total} checked ({job.live} Live, {job.dead} Dead)
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs uppercase">
                    {job.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── DIALOG 1: Edit Playlist & GitHub Settings via PlaylistEditorDialog ── */}
      <PlaylistEditorDialog
        open={editPlaylistOpen}
        onOpenChange={setEditPlaylistOpen}
        playlist={playlist as any}
      />

      {/* ── DIALOG 2: Add / Edit Channel Modal with Live Preview ──────────────── */}
      <Dialog
        open={channelModalOpen}
        onOpenChange={(open) => {
          if (!isSavingChannel) setChannelModalOpen(open);
        }}
      >
        <DialogContent id="channelEditorModal" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {channelModalMode === "add" ? "Add Channel to Playlist" : "Edit Channel"}
            </DialogTitle>
            <DialogDescription>
              Configure channel metadata, custom stream logo, link, User-Agent, and category.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="chName">Channel Name *</Label>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {channelForm.tvgName.length}/120
                  </span>
                </div>
                <Input
                  id="chName"
                  placeholder="e.g. HBO Max HD"
                  value={channelForm.tvgName}
                  disabled={isSavingChannel}
                  onChange={(e) => {
                    setChannelForm({ ...channelForm, tvgName: e.target.value });
                    setChannelTouched((prev) => ({ ...prev, tvgName: true }));
                  }}
                  onBlur={() => setChannelTouched((prev) => ({ ...prev, tvgName: true }))}
                  className={cn(
                    channelTouched.tvgName &&
                      channelValidation.errors.tvgName &&
                      "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                  )}
                />
                {channelTouched.tvgName && channelValidation.errors.tvgName && (
                  <p className="flex items-center gap-1 text-xs text-destructive font-medium mt-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {channelValidation.errors.tvgName}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="chGroup">Category / Group</Label>
                <Input
                  id="chGroup"
                  placeholder="e.g. Movies, Sports, News"
                  value={channelForm.groupTitle}
                  disabled={isSavingChannel}
                  onChange={(e) => setChannelForm({ ...channelForm, groupTitle: e.target.value })}
                />
              </div>
            </div>

            {/* Logo Input with Live Thumbnail Preview */}
            <div className="space-y-1.5">
              <Label htmlFor="chLogo">Channel Logo URL (tvg-logo)</Label>
              <div className="flex items-center gap-3">
                {channelForm.tvgLogo ? (
                  <img
                    src={channelForm.tvgLogo}
                    alt=""
                    className="h-10 w-10 rounded object-contain bg-black/40 border border-border p-1 shrink-0"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='15' x='2' y='7' rx='2' ry='2'/%3E%3Cpolyline points='17 2 12 7 7 2'/%3E%3C/svg%3E";
                    }}
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground border border-border shrink-0">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="flex-1 space-y-1">
                  <Input
                    id="chLogo"
                    placeholder="https://example.com/logo.png"
                    value={channelForm.tvgLogo}
                    disabled={isSavingChannel}
                    onChange={(e) => {
                      setChannelForm({ ...channelForm, tvgLogo: e.target.value });
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
                    <p className="flex items-center gap-1 text-xs text-destructive font-medium">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {channelValidation.errors.tvgLogo}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Stream URL */}
            <div className="space-y-1.5">
              <Label htmlFor="chUrl">Streaming Link / URL *</Label>
              <Input
                id="chUrl"
                placeholder="https://server.com/live/stream.m3u8"
                value={channelForm.url}
                disabled={isSavingChannel}
                onChange={(e) => {
                  setChannelForm({ ...channelForm, url: e.target.value });
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

            {/* User-Agent with Presets */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="chUa">Custom User-Agent</Label>
                <Input
                  id="chUa"
                  placeholder="e.g. VLC/3.0.18, TiviMate/4.7.0"
                  value={channelForm.userAgent}
                  onChange={(e) => setChannelForm({ ...channelForm, userAgent: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label>User-Agent Presets</Label>
                <Select
                  onValueChange={(val) => setChannelForm({ ...channelForm, userAgent: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select a preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_AGENT_PRESETS.map((p) => (
                      <SelectItem key={p.label} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Referrer & TVG ID */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="chRef" className="text-xs">HTTP Referrer</Label>
                <Input
                  id="chRef"
                  placeholder="https://provider.com/"
                  value={channelForm.referrer}
                  disabled={isSavingChannel}
                  onChange={(e) => {
                    setChannelForm({ ...channelForm, referrer: e.target.value });
                    setChannelTouched((prev) => ({ ...prev, referrer: true }));
                  }}
                  onBlur={() => setChannelTouched((prev) => ({ ...prev, referrer: true }))}
                  className={cn(
                    "font-mono text-xs",
                    channelTouched.referrer &&
                      channelValidation.errors.referrer &&
                      "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                  )}
                />
                {channelTouched.referrer && channelValidation.errors.referrer && (
                  <p className="flex items-center gap-1 text-[11px] text-destructive font-medium mt-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {channelValidation.errors.referrer}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="chTvgId" className="text-xs">TVG-ID (EPG Identifier)</Label>
                <Input
                  id="chTvgId"
                  placeholder="e.g. HBO.us"
                  value={channelForm.tvgId}
                  onChange={(e) => setChannelForm({ ...channelForm, tvgId: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {/* Instant Stream Preview inside Modal */}
            {channelForm.url.trim() && (
              <div className="rounded-lg border border-border bg-slate-950/60 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" /> Live Stream Preview Test
                  </span>
                </div>
                <StreamPlayer
                  url={channelForm.url}
                  userAgent={channelForm.userAgent}
                  referrer={channelForm.referrer}
                  title={channelForm.tvgName || "Test Preview"}
                  poster={channelForm.tvgLogo}
                  autoPlay={false}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              onClick={() => setChannelModalOpen(false)}
              disabled={isSavingChannel}
            >
              Cancel
            </Button>
            <Button
              id="saveChannelSubmitBtn"
              onClick={saveChannel}
              disabled={isSavingChannel || !channelValidation.isValid}
              className={cn(
                "relative gap-2 font-bold min-w-[140px] shadow-sm transition-all duration-150",
                isSavingChannel && "cursor-not-allowed opacity-90",
                !channelValidation.isValid && "cursor-not-allowed opacity-60"
              )}
            >
              {isSavingChannel ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary-foreground shrink-0" />
                  <span>Saving Channel...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 shrink-0" />
                  <span>{channelModalMode === "add" ? "Add Channel" : "Save Channel"}</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DIALOG 3: Push to GitHub Modal ───────────────────────────────────── */}
      <Dialog open={githubPushOpen} onOpenChange={setGithubPushOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <FolderGit2 className="h-5 w-5 text-primary" /> Push Playlist to GitHub
            </DialogTitle>
            <DialogDescription>
              Commit this updated M3U playlist file directly to your GitHub repository.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pushRepo" className="text-xs">Repository</Label>
                <Input
                  id="pushRepo"
                  placeholder="e.g. iptv-live-streams"
                  value={githubPushForm.repo}
                  onChange={(e) => setGithubPushForm({ ...githubPushForm, repo: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pushBranch" className="text-xs">Branch</Label>
                <Input
                  id="pushBranch"
                  placeholder="main"
                  value={githubPushForm.branch}
                  onChange={(e) => setGithubPushForm({ ...githubPushForm, branch: e.target.value })}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pushPath" className="text-xs">Target File Path</Label>
              <Input
                id="pushPath"
                placeholder="playlists/live.m3u8"
                value={githubPushForm.path}
                onChange={(e) => setGithubPushForm({ ...githubPushForm, path: e.target.value })}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pushMsg" className="text-xs">Commit Message</Label>
              <Input
                id="pushMsg"
                placeholder="Update playlist via StreamGuard"
                value={githubPushForm.message}
                onChange={(e) => setGithubPushForm({ ...githubPushForm, message: e.target.value })}
                className="text-xs"
              />
            </div>

            {pushResult && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-400 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Check className="h-4 w-4" /> {pushResult.message || "Pushed successfully!"}
                </div>
                {pushResult.fileUrl && (
                  <div className="pt-1">
                    <a
                      href={pushResult.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-mono inline-flex items-center gap-1"
                    >
                      View updated file on GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGithubPushOpen(false)}>Close</Button>
            <Button onClick={triggerGithubPush} disabled={pushingGithub} className="gap-2">
              {pushingGithub ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {pushingGithub ? "Pushing to GitHub..." : "Commit & Push"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DIALOG 4: Bulk Edit Modal ────────────────────────────────────────── */}
      <Dialog open={bulkCategoryOpen} onOpenChange={setBulkCategoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Batch Edit Channels</DialogTitle>
            <DialogDescription>
              Apply category or User-Agent to {selectedIds.length} selected channels.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="bulkGroup">Set Category / Group Title</Label>
              <Input
                id="bulkGroup"
                placeholder="Leave blank to keep existing"
                value={bulkGroupInput}
                onChange={(e) => setBulkGroupInput(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulkUa">Set Custom User-Agent</Label>
              <Input
                id="bulkUa"
                placeholder="Leave blank to keep existing"
                value={bulkUaInput}
                onChange={(e) => setBulkUaInput(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkCategoryOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkUpdate}>Apply to {selectedIds.length} Channels</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
