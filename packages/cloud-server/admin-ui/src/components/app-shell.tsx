import { Cpu, LayoutDashboard, LogOut, Package, Server, Sparkles, Users } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearStoredAdminToken, getStoredAdminToken, maskToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/users", label: "Users", icon: Users },
  { to: "/computers", label: "Machines", icon: Server },
  { to: "/ai-usage", label: "AI usage", icon: Sparkles },
  { to: "/releases", label: "Releases", icon: Package },
];

export const AppShell = () => {
  const navigate = useNavigate();
  const adminToken = getStoredAdminToken() ?? "";

  const handleLogout = () => {
    clearStoredAdminToken();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 px-4 py-6 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">HeySnap</span>
            <span className="text-xs text-muted-foreground">Admin console</span>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto rounded-md border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Hosted control plane</div>
          <div>api.heysnap.xyz</div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          <nav className="flex items-center gap-1 md:hidden">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  cn(
                    "flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground",
                    isActive && "bg-accent text-accent-foreground",
                  )
                }
                aria-label={item.label}
              >
                <item.icon className="h-4 w-4" />
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-md border border-border/70 bg-card px-2 py-1 font-mono text-xs text-muted-foreground sm:inline">
              {adminToken.length > 0 ? maskToken(adminToken) : "no token"}
            </span>
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  Admin
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Session</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
