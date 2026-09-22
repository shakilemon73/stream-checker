import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPlaylistQueryKey,
  getListPlaylistsQueryKey,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  FolderGit2,
  GitBranch,
  Loader2,
  Settings,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Real-time Zod validation schema for Playlist Editing
export const playlistEditSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Playlist name is required")
      .max(120, "Playlist name must be 120 characters or less"),
    githubRepo: z
      .string()
      .trim()
      .refine(
        (val) => !val || /^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)?$/.test(val),
        "Repository format should be 'owner/repo' or 'repo-name'"
      ),
    githubBranch: z
      .string()
      .trim()
      .refine(
        (val) => !val || /^[a-zA-Z0-9_./-]+$/.test(val),
        "Branch name contains invalid characters"
      ),
    githubPath: z
      .string()
      .trim()
      .refine((val) => !val || !val.includes(" "), "File path must not contain spaces")
      .refine(
        (val) => !val || /\.(m3u|m3u8|txt)$/i.test(val),
        "File path must end with .m3u, .m3u8, or .txt"
      ),
    autoPushGithub: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.autoPushGithub) {
      if (!data.githubRepo || data.githubRepo.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["githubRepo"],
          message: "Repository name is required when Auto-Push is enabled",
        });
      }
      if (!data.githubPath || data.githubPath.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["githubPath"],
          message: "File path in repository is required when Auto-Push is enabled",
        });
      }
    }
  });

export type PlaylistEditFormData = z.infer<typeof playlistEditSchema>;

export interface PlaylistEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: {
    id: number;
    name: string;
    githubRepo?: string | null;
    githubBranch?: string | null;
    githubPath?: string | null;
    autoPushGithub?: boolean | null;
  } | null;
  onSuccess?: (updated: any) => void;
}

export function PlaylistEditorDialog({
  open,
  onOpenChange,
  playlist,
  onSuccess,
}: PlaylistEditorDialogProps) {
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<PlaylistEditFormData>({
    name: "",
    githubRepo: "",
    githubBranch: "main",
    githubPath: "",
    autoPushGithub: false,
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Sync form data when dialog opens with playlist
  useEffect(() => {
    if (playlist && open) {
      const defaultPath = `${(playlist.name || "playlist")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")}.m3u8`;

      setFormData({
        name: playlist.name || "",
        githubRepo: playlist.githubRepo || "",
        githubBranch: playlist.githubBranch || "main",
        githubPath: playlist.githubPath || defaultPath,
        autoPushGithub: Boolean(playlist.autoPushGithub),
      });
      setTouched({});
      setIsSaving(false);
    }
  }, [playlist, open]);

  // Real-time Zod validation
  const validation = useMemo(() => {
    const result = playlistEditSchema.safeParse(formData);
    const errors: Record<string, string> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] || "name");
        if (!errors[field]) {
          errors[field] = issue.message;
        }
      }
    }
    return {
      isValid: result.success,
      errors,
    };
  }, [formData]);

  const handleFieldChange = (
    field: keyof PlaylistEditFormData,
    value: string | boolean
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleFieldBlur = (field: keyof PlaylistEditFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleSave = async () => {
    if (!playlist) return;

    // Mark all fields touched on submit to expose any hidden validation issues
    setTouched({
      name: true,
      githubRepo: true,
      githubBranch: true,
      githubPath: true,
      autoPushGithub: true,
    });

    // Guard against duplicate submission or invalid inputs
    if (isSaving) return;
    if (!validation.isValid) {
      const firstError = Object.values(validation.errors)[0] || "Please resolve validation errors";
      toast.error(firstError);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "Failed to update playlist");
      }

      const updated = await res.json();

      // 1. Instantly update active playlist cache
      queryClient.setQueryData(getGetPlaylistQueryKey(playlist.id), (old: any) => ({
        ...old,
        ...updated,
        ...formData,
      }));

      // 2. Instantly update library list cache
      queryClient.setQueryData(getListPlaylistsQueryKey(), (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((p: any) =>
          p.id === playlist.id ? { ...p, ...updated, ...formData } : p
        );
      });

      toast.success("Playlist details updated and saved");
      onSuccess?.(updated);
      onOpenChange(false);

      // 3. Invalidate queries in background
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetPlaylistQueryKey(playlist.id) }),
        queryClient.invalidateQueries({ queryKey: getListPlaylistsQueryKey() }),
      ]);
    } catch (err) {
      toast.error(`Failed to update playlist: ${(err as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const hasErrors = !validation.isValid && Object.keys(touched).length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Prevent accidental close while save is in flight
        if (!isSaving) onOpenChange(isOpen);
      }}
    >
      <DialogContent id="playlistEditorModal" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" /> Edit Playlist Settings
          </DialogTitle>
          <DialogDescription>
            Update playlist name and configure repository paths for GitHub Auto-Push synchronization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Playlist Name Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="playlistEditorName" className="text-sm font-medium">
                Playlist Name <span className="text-destructive">*</span>
              </Label>
              <span className="text-[11px] font-mono text-muted-foreground">
                {formData.name.length}/120
              </span>
            </div>
            <Input
              id="playlistEditorName"
              value={formData.name}
              onChange={(e) => handleFieldChange("name", e.target.value)}
              onBlur={() => handleFieldBlur("name")}
              placeholder="e.g. My Premium IPTV Roster"
              disabled={isSaving}
              aria-invalid={Boolean(touched.name && validation.errors.name)}
              aria-describedby={touched.name && validation.errors.name ? "name-error" : undefined}
              className={cn(
                "transition-colors",
                touched.name &&
                  validation.errors.name &&
                  "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
              )}
            />
            {touched.name && validation.errors.name && (
              <p
                id="name-error"
                className="flex items-center gap-1.5 text-xs text-destructive font-medium mt-1 animate-in fade-in-50"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {validation.errors.name}
              </p>
            )}
          </div>

          {/* GitHub Sync Section */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FolderGit2 className="h-4 w-4 text-primary" /> GitHub Repository Sync
              </div>
              {formData.autoPushGithub && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                  <GitBranch className="h-3 w-3" /> Auto-Push Active
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Repository Name */}
              <div className="space-y-1.5">
                <Label htmlFor="playlistEditorRepo" className="text-xs">
                  Repository Name{" "}
                  {formData.autoPushGithub && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="playlistEditorRepo"
                  placeholder="e.g. username/iptv-lineup"
                  value={formData.githubRepo}
                  disabled={isSaving}
                  onChange={(e) => handleFieldChange("githubRepo", e.target.value)}
                  onBlur={() => handleFieldBlur("githubRepo")}
                  aria-invalid={Boolean(touched.githubRepo && validation.errors.githubRepo)}
                  className={cn(
                    "font-mono text-xs",
                    touched.githubRepo &&
                      validation.errors.githubRepo &&
                      "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                  )}
                />
                {touched.githubRepo && validation.errors.githubRepo && (
                  <p
                    id="repo-error"
                    className="flex items-center gap-1 text-[11px] text-destructive font-medium mt-1 animate-in fade-in-50"
                  >
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {validation.errors.githubRepo}
                  </p>
                )}
              </div>

              {/* Branch */}
              <div className="space-y-1.5">
                <Label htmlFor="playlistEditorBranch" className="text-xs">
                  Branch
                </Label>
                <Input
                  id="playlistEditorBranch"
                  placeholder="main"
                  value={formData.githubBranch}
                  disabled={isSaving}
                  onChange={(e) => handleFieldChange("githubBranch", e.target.value)}
                  onBlur={() => handleFieldBlur("githubBranch")}
                  aria-invalid={Boolean(touched.githubBranch && validation.errors.githubBranch)}
                  className={cn(
                    "font-mono text-xs",
                    touched.githubBranch &&
                      validation.errors.githubBranch &&
                      "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                  )}
                />
                {touched.githubBranch && validation.errors.githubBranch && (
                  <p
                    id="branch-error"
                    className="flex items-center gap-1 text-[11px] text-destructive font-medium mt-1 animate-in fade-in-50"
                  >
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {validation.errors.githubBranch}
                  </p>
                )}
              </div>
            </div>

            {/* Target File Path */}
            <div className="space-y-1.5">
              <Label htmlFor="playlistEditorPath" className="text-xs">
                File Path in Repository{" "}
                {formData.autoPushGithub && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="playlistEditorPath"
                placeholder="playlists/live.m3u8"
                value={formData.githubPath}
                disabled={isSaving}
                onChange={(e) => handleFieldChange("githubPath", e.target.value)}
                onBlur={() => handleFieldBlur("githubPath")}
                aria-invalid={Boolean(touched.githubPath && validation.errors.githubPath)}
                className={cn(
                  "font-mono text-xs",
                  touched.githubPath &&
                    validation.errors.githubPath &&
                    "border-destructive/80 focus-visible:ring-destructive bg-destructive/5"
                )}
              />
              {touched.githubPath && validation.errors.githubPath && (
                <p
                  id="path-error"
                  className="flex items-center gap-1 text-[11px] text-destructive font-medium mt-1 animate-in fade-in-50"
                >
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {validation.errors.githubPath}
                </p>
              )}
            </div>

            {/* Auto-Push Toggle */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/60">
              <div className="space-y-0.5">
                <Label
                  htmlFor="playlistEditorAutoPush"
                  className="text-xs font-medium cursor-pointer"
                >
                  Enable Auto-Push to GitHub
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Automatically commits and pushes updates to your repository on edits
                </p>
              </div>
              <Switch
                id="playlistEditorAutoPush"
                checked={formData.autoPushGithub}
                disabled={isSaving}
                onCheckedChange={(checked) => {
                  handleFieldChange("autoPushGithub", checked);
                  if (checked) {
                    setTouched((prev) => ({
                      ...prev,
                      autoPushGithub: true,
                      githubRepo: true,
                      githubPath: true,
                    }));
                  }
                }}
              />
            </div>
          </div>

          {/* Validation Summary Callout if invalid and touched */}
          {hasErrors && (
            <div
              id="playlistEditorValidationSummary"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive animate-in fade-in-50"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold">
                  Please resolve the following before saving:
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  {Object.entries(validation.errors).map(([key, msg]) => (
                    <li key={key}>{msg}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button
            id="cancelPlaylistEditBtn"
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>

          {/* Save Button with Real-time Validation Gate & Loading Feedback */}
          <Button
            id="savePlaylistMetadataBtn"
            type="button"
            onClick={handleSave}
            disabled={isSaving || !validation.isValid}
            className={cn(
              "relative gap-2 font-bold min-w-[140px] shadow-sm transition-all duration-150",
              isSaving && "cursor-not-allowed opacity-90",
              !validation.isValid && "cursor-not-allowed opacity-60"
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary-foreground shrink-0" />
                <span>Saving Changes...</span>
              </>
            ) : (
              <>
                <Check className="h-4 w-4 shrink-0" />
                <span>Save Changes</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
