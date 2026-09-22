import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, ListVideo, Settings as SettingsIcon, RadioTower, Menu, X, ChevronRight, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/playlists", label: "Library", icon: ListVideo },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("streamguard-theme");
      if (stored) return stored === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("streamguard-theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("streamguard-theme", "light");
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-[278px] bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col transition-transform duration-300 lg:sticky lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="px-6 pb-6 pt-7">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-[14px] bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_0_0_5px_hsl(var(--sidebar-primary)/.08)]">
              <RadioTower className="h-[19px] w-[19px]" strokeWidth={2.4} />
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-sidebar-primary animate-signal" />
            </div>
            <div>
              <div className="font-display text-[18px] font-bold tracking-tight">StreamGuard</div>
              <div className="signal-label mt-1 text-sidebar-foreground/45">Signal operations</div>
            </div>
            <button className="ml-auto lg:hidden text-sidebar-foreground/70 hover:text-sidebar-foreground" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-8 flex items-center gap-2 text-[11px] text-sidebar-foreground/55">
            <span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
            <span className="font-mono">CONTROL / ONLINE</span>
            <span className="ml-auto font-mono">UTC</span>
          </div>
        </div>
        
        <nav className="flex-1 space-y-1 px-3">
          <div className="signal-label px-3 pb-2 pt-2 text-sidebar-foreground/35">Workspace</div>
          {navItems.map((item) => {
            const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-[10px] px-3 py-3 text-sm transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm" : "text-sidebar-foreground/60"
                )}
                onClick={() => setMobileOpen(false)}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                {isActive && <span className="absolute -left-3 h-7 w-1 rounded-r-full bg-sidebar-primary" />}
                <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-sidebar-primary")} />
                <span>{item.label}</span>
                {item.href === "/" && <span className="ml-auto rounded bg-sidebar-primary/10 px-1.5 py-0.5 font-mono text-[9px] text-sidebar-primary">LIVE</span>}
                {isActive && item.href !== "/" && <ChevronRight className="ml-auto h-3.5 w-3.5 text-sidebar-primary/70" />}
              </Link>
            );
          })}
        </nav>

        {/* Theme Toggle Button */}
        <div className="px-3 pb-2">
          <button
            onClick={toggleTheme}
            className="flex w-full items-center justify-between rounded-[10px] border border-sidebar-border bg-sidebar-accent/30 px-3 py-2.5 text-xs text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            data-testid="button-toggle-theme"
            aria-label="Toggle dark mode"
          >
            <div className="flex items-center gap-2.5">
              {isDark ? <Moon className="h-4 w-4 text-sidebar-primary" /> : <Sun className="h-4 w-4 text-amber-400" />}
              <span>{isDark ? "Dark theme" : "Light theme"}</span>
            </div>
            <span className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-[10px] text-sidebar-foreground/50 uppercase">
              {isDark ? "Dark" : "Light"}
            </span>
          </button>
        </div>

        <div className="m-3 rounded-[10px] border border-sidebar-border bg-sidebar-accent/40 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold"><Activity className="h-3.5 w-3.5 text-sidebar-primary" /> Signal health</div>
          <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-sidebar-foreground/50"><span>Control plane</span><span className="text-sidebar-primary">READY</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-sidebar/70"><div className="h-full w-full rounded-full bg-sidebar-primary" /></div>
          <div className="mt-3 flex items-center justify-between text-[10px] text-sidebar-foreground/40"><span>Last checked</span><span className="font-mono">just now</span></div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 min-h-[100dvh] overflow-y-auto">
        <div className="sticky top-0 z-30 flex h-14 items-center border-b border-border/80 bg-background/90 px-4 backdrop-blur lg:hidden">
          <button className="rounded-md p-2 hover:bg-muted" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu className="h-5 w-5" /></button>
          <div className="ml-3 font-display font-bold">StreamGuard</div>
          <button
            onClick={toggleTheme}
            className="ml-auto mr-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Toggle theme"
          >
            {isDark ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-amber-500" />}
          </button>
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-live animate-signal" /> LIVE</div>
        </div>
        {children}
      </main>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-sidebar/45 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" data-testid="button-navigation-overlay" />}
    </div>
  );
}
