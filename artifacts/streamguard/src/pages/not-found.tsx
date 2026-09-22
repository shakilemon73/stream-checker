import { Link } from "wouter";
import { ArrowLeft, Compass, Database, Home, RadioTower, Sparkles, Tv2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-56px)] w-full max-w-4xl items-center justify-center px-4 py-16 sm:px-8">
      <div className="w-full max-w-xl rounded-2xl border border-border/80 bg-card p-8 text-center shadow-lg sm:p-12 relative overflow-hidden">
        {/* Background visual signal glow */}
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-destructive/10 blur-3xl" />

        <div className="relative z-10 space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive shadow-sm">
            <WifiOff className="h-8 w-8 animate-pulse" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-0.5 text-xs font-mono font-bold text-destructive">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
              SIGNAL CARRIER LOST // 404
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              No Transmission Detected
            </h1>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
              The endpoint or resource you tuned into does not exist on the current broadcast frequency. Return to the control deck to resume stream operations.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <Button asChild size="lg" className="w-full sm:w-auto gap-2 font-bold shadow-md bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6">
              <Link href="/">
                <RadioTower className="h-4 w-4" /> Control Room Ingest
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto gap-2 font-semibold h-11 px-5">
              <Link href="/playlists">
                <Database className="h-4 w-4" /> Lineup Library
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
