import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2, Server, Globe, SearchCode } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings({ 
    query: { queryKey: getGetSettingsQueryKey() } 
  });
  const updateSettings = useUpdateSettings();

  const [formData, setFormData] = useState({
    defaultConcurrency: "50",
    defaultTimeoutMs: "10000",
    defaultRetryCount: "1",
    perHostConcurrency: "10",
    maxConcurrency: "1000",
    autoProbeDefault: true,
    ffprobePath: "ffprobe"
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        defaultConcurrency: settings.defaultConcurrency.toString(),
        defaultTimeoutMs: settings.defaultTimeoutMs.toString(),
        defaultRetryCount: settings.defaultRetryCount.toString(),
        perHostConcurrency: settings.perHostConcurrency.toString(),
        maxConcurrency: settings.maxConcurrency.toString(),
        autoProbeDefault: settings.autoProbeDefault,
        ffprobePath: settings.ffprobePath
      });
    }
  }, [settings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData(prev => ({ ...prev, [name]: checked }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate({
      data: {
        defaultConcurrency: parseInt(formData.defaultConcurrency),
        defaultTimeoutMs: parseInt(formData.defaultTimeoutMs),
        defaultRetryCount: parseInt(formData.defaultRetryCount),
        perHostConcurrency: parseInt(formData.perHostConcurrency),
        maxConcurrency: parseInt(formData.maxConcurrency),
        autoProbeDefault: formData.autoProbeDefault,
        ffprobePath: formData.ffprobePath
      }
    }, {
      onSuccess: () => {
        toast.success("Settings saved successfully");
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      },
      onError: (err) => {
        toast.error("Failed to save settings");
        console.error(err);
      }
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
        <p className="text-muted-foreground mt-1 text-lg">Configure global defaults for the validation engine</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader className="border-b bg-card/50">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              <CardTitle>Network & Concurrency</CardTitle>
            </div>
            <CardDescription>Default settings for how aggressively to probe streaming hosts.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="defaultConcurrency">Default Global Concurrency</Label>
                <Input 
                  id="defaultConcurrency" name="defaultConcurrency" type="number" 
                  value={formData.defaultConcurrency} onChange={handleChange} 
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Max simultaneous requests across all hosts</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="perHostConcurrency">Per-Host Concurrency</Label>
                <Input 
                  id="perHostConcurrency" name="perHostConcurrency" type="number" 
                  value={formData.perHostConcurrency} onChange={handleChange} 
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Rate limit per domain/IP to prevent bans</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultTimeoutMs">Connection Timeout (ms)</Label>
                <Input 
                  id="defaultTimeoutMs" name="defaultTimeoutMs" type="number" 
                  value={formData.defaultTimeoutMs} onChange={handleChange} 
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Time before assuming stream is dead</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultRetryCount">Retry Count</Label>
                <Input 
                  id="defaultRetryCount" name="defaultRetryCount" type="number" 
                  value={formData.defaultRetryCount} onChange={handleChange} 
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Retries for non-404 failures</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-card/50">
            <div className="flex items-center gap-2">
              <SearchCode className="w-5 h-5 text-primary" />
              <CardTitle>Deep Probe Analysis</CardTitle>
            </div>
            <CardDescription>FFprobe configuration for codec and metadata extraction.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/20">
              <div className="space-y-1">
                <Label className="text-base">Auto-Probe by Default</Label>
                <p className="text-sm text-muted-foreground">Automatically run FFprobe against live streams to gather codec, resolution, and bitrate data.</p>
              </div>
              <Switch 
                checked={formData.autoProbeDefault} 
                onCheckedChange={(c) => handleSwitchChange('autoProbeDefault', c)} 
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="ffprobePath">FFprobe Executable Path</Label>
              <Input 
                id="ffprobePath" name="ffprobePath" type="text" 
                value={formData.ffprobePath} onChange={handleChange} 
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Path to ffprobe binary. Use 'ffprobe' if in system PATH.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-card/50">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-primary" />
              <CardTitle>System Limits</CardTitle>
            </div>
            <CardDescription>Hard limits to protect the underlying server.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-2 max-w-md">
              <Label htmlFor="maxConcurrency">Maximum Permitted Concurrency</Label>
              <Input 
                id="maxConcurrency" name="maxConcurrency" type="number" 
                value={formData.maxConcurrency} onChange={handleChange} 
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Hard cap regardless of job settings to prevent resource exhaustion.</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end pt-4">
          <Button type="submit" size="lg" className="font-bold tracking-wide" disabled={updateSettings.isPending}>
            {updateSettings.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
            SAVE SETTINGS
          </Button>
        </div>
      </form>
    </div>
  );
}
