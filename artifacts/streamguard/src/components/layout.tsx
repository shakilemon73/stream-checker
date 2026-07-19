import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, ListVideo, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/playlists", label: "Library", icon: ListVideo },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Sidebar */}
      <aside className="w-16 lg:w-64 border-r bg-sidebar flex-shrink-0 flex flex-col items-center lg:items-stretch py-4 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-2 lg:px-6 mb-8 text-primary font-bold">
          <Activity className="w-8 h-8 lg:w-6 lg:h-6 shrink-0" />
          <span className="hidden lg:inline text-xl tracking-tight uppercase">StreamGuard</span>
        </div>
        
        <nav className="flex-1 flex flex-col gap-2 px-2 lg:px-4">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-md transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-muted-foreground"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
