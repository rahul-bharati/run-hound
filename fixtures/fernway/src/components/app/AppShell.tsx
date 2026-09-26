import {
  Bell,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  Sun,
  User,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/components/ui/sonner";
import { isApiError } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { images } from "@/lib/images";
import { sessionLabel, signOut, useSessionUser } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { cn, initials } from "@/lib/utils";

/** Sidebar links. "Projects" jumps to the dashboard's projects table (id="projects"). */
export const APP_NAV = [
  { label: "Dashboard", to: "/app", icon: LayoutDashboard, end: true },
  { label: "Projects", to: "/app#projects", icon: FolderKanban, end: false },
  { label: "Settings", to: "/app/settings", icon: Settings, end: true },
] as const;

/** The 3 items in the Notifications popover (static demo content). */
const NOTIFICATIONS = [
  { id: "n1", who: "Priya Shah", avatar: 1, text: "commented on Northwind rebrand", when: "12 min ago" },
  { id: "n2", who: "Sofia Alvarez", avatar: 3, text: "moved Juniper website refresh to 81%", when: "1 hour ago" },
  { id: "n3", who: "Marcus Chen", avatar: 2, text: "assigned you to Atlas mobile app", when: "Yesterday" },
] as const;

const SIDEBAR_KEY = "fernway.sidebar";

/** Extra command palette entries a page adds (e.g. the dashboard's "New project"). */
export interface PaletteCommand {
  label: string;
  /** What cmdk matches on (defaults to the label). */
  value?: string;
  keywords?: string[];
  icon: ComponentType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
  onSelect: () => void;
}
export interface PaletteGroup {
  heading: string;
  items: PaletteCommand[];
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

const navItem =
  "group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function NavLinks({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {APP_NAV.map((item) => {
        const Icon = item.icon;
        const content = (
          <>
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span className={cn(collapsed && "sr-only")}>{item.label}</span>
          </>
        );
        return (
          <li key={item.label}>
            {item.to.includes("#") ? (
              <Link to={item.to} className={cn(navItem, collapsed && "justify-center px-0")} onClick={onNavigate}>
                {content}
              </Link>
            ) : (
              <NavLink to={item.to} end={item.end} className={cn(navItem, collapsed && "justify-center px-0")} onClick={onNavigate}>
                {content}
              </NavLink>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The signed-in user's initials (decorative: the name is shown next to it or in the menu). */
function UserAvatar({ className }: { className?: string }) {
  const user = useSessionUser();
  return (
    <Avatar className={className}>
      <AvatarFallback aria-hidden="true">{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * The /app chrome (CONTRACT.md "/app Dashboard"): a collapsible sidebar ("Collapse sidebar" / "Expand sidebar",
 * aria-expanded), nav links (Dashboard, Projects, Settings), and a top bar with "Search" (cmdk command palette;
 * ⌘K / Ctrl+K), "Notifications" (Popover with 3 items), a theme toggle and "Account menu" (Profile, Settings,
 * Sign out). It renders the page's <main id="main">: pages inside AppShell render their <h1> and content only,
 * never a second <main>. W05 (on /app only) strips the names of the icon-only collapse and notifications buttons.
 */
export function AppShell({ children, mainClassName, commands = [] }: { children: ReactNode; mainClassName?: string; commands?: PaletteGroup[] }) {
  const user = useSessionUser();
  const location = useLocation();
  const navigate = useNavigate();
  const { resolvedTheme, toggleTheme } = useTheme();
  const w05 = useBug("W05") && location.pathname === "/app";

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [unread, setUnread] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (fn: () => void) => {
    setPaletteOpen(false);
    fn();
  };

  // POST /api/logout; once the client knows it is signed out, <RequireSession> sends the page to /login?next=<path>.
  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("You're signed out", { description: "Sign in again any time to pick up where you left off." });
    } catch (err) {
      toast.error("Couldn't sign you out", { description: isApiError(err) ? err.message : "Please try again." });
    }
  };

  const iconButton = "rounded-full";

  return (
    <div className="bg-mesh flex min-h-dvh">
      {/* Sidebar (md and up) */}
      <aside
        id="app-sidebar"
        aria-label="Sidebar"
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar backdrop-blur-xl transition-[width] duration-200 md:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
          <Logo to="/app" compact={collapsed} />
        </div>
        <nav aria-label="App" className={cn("flex-1 px-3 py-2", collapsed && "px-2")}>
          <NavLinks collapsed={collapsed} />
        </nav>
        {!collapsed && (
          <div className="mx-3 mb-3 rounded-2xl border border-sidebar-border bg-card p-4 shadow-soft">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles aria-hidden="true" className="size-4 text-primary" />
              Studio plan trial
            </p>
            <p className="mt-1 text-xs text-muted-foreground">12 days left. Upgrade to keep unlimited projects.</p>
            <Button asChild size="sm" variant="outline" className="mt-3 w-full">
              <Link to="/app/settings#billing">View plans</Link>
            </Button>
          </div>
        )}
        <div className={cn("flex items-center gap-3 border-t border-sidebar-border p-3", collapsed && "flex-col")}>
          <UserAvatar />
          <p className={cn("min-w-0 flex-1 text-xs leading-5 text-muted-foreground", collapsed && "sr-only")}>
            {/* Reads "Signed in as Alex Rivera · Rivera Studio" (GET /api/me); shown as name over workspace. */}
            <span className="sr-only">Signed in as </span>
            <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
            <span className="sr-only"> · </span>
            <span className="block truncate">{user.workspace}</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-5" /> : <PanelLeftClose aria-hidden="true" className="size-5" />}
            {!w05 && <span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="glass sticky top-0 z-30 border-b border-border/70">
          <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className={cn(iconButton, "md:hidden")}>
                  <Menu aria-hidden="true" className="size-5" />
                  <span className="sr-only">Open navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="sm:max-w-xs">
                <SheetHeader>
                  <SheetTitle>Navigation</SheetTitle>
                  <SheetDescription>{sessionLabel(user)}</SheetDescription>
                </SheetHeader>
                <nav aria-label="App" className="px-3">
                  <NavLinks onNavigate={() => setMobileNavOpen(false)} />
                </nav>
              </SheetContent>
            </Sheet>

            <Button
              type="button"
              variant="outline"
              onClick={() => setPaletteOpen(true)}
              className="h-10 min-w-10 justify-start gap-2 rounded-full px-3 font-normal text-muted-foreground sm:w-72"
            >
              <Search aria-hidden="true" className="size-4" />
              <span className="sr-only sm:not-sr-only">Search</span>
              <kbd aria-hidden="true" className="ml-auto hidden rounded-md border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium sm:inline">
                ⌘K
              </kbd>
            </Button>

            <div className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />

              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className={cn(iconButton, "relative")}>
                    <Bell aria-hidden="true" className="size-5" />
                    {!w05 && <span className="sr-only">Notifications</span>}
                    {unread && <span aria-hidden="true" className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" aria-labelledby="notifications-heading" className="w-80 p-0">
                  <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                    <h2 id="notifications-heading" className="text-sm font-semibold">
                      Notifications
                    </h2>
                    <Button type="button" variant="link" size="sm" className="h-8 px-1" disabled={!unread} onClick={() => setUnread(false)}>
                      Mark all as read
                    </Button>
                  </div>
                  <ul className="divide-y">
                    {NOTIFICATIONS.map((n) => {
                      const avatar = images.avatars[n.avatar]!;
                      return (
                        <li key={n.id} className="flex gap-3 px-4 py-3">
                          <Avatar className="size-8">
                            <AvatarImage src={avatar.src} alt="" />
                            <AvatarFallback aria-hidden="true">{initials(n.who)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 text-sm">
                            <p>
                              <span className="font-medium">{n.who}</span> {n.text}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              {unread && <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />}
                              {n.when}
                              {unread && <span className="sr-only">(unread)</span>}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className={iconButton}>
                    <UserAvatar className="size-8" />
                    <span className="sr-only">Account menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-foreground">
                    <span className="block text-sm font-semibold">{user.name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/app/settings")}>
                    <User aria-hidden="true" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate("/app/settings")}>
                    <Settings aria-hidden="true" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleSignOut()}>
                    <LogOut aria-hidden="true" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className={cn("mx-auto w-full max-w-7xl flex-1 px-4 py-8 outline-hidden sm:px-6 lg:px-8", mainClassName)}>
          {children}
        </main>
      </div>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Search Fernway" description="Jump to a page or run a command.">
        <CommandInput placeholder="Search pages and commands…" />
        <CommandEmpty>No results.</CommandEmpty>
        <CommandList>
          {commands.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem key={item.label} value={item.value ?? item.label} keywords={item.keywords} onSelect={() => run(item.onSelect)}>
                    <Icon aria-hidden="true" />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          <CommandGroup heading="Go to">
            {APP_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.label} value={`Go to ${item.label}`} onSelect={() => run(() => navigate(item.to))}>
                  <Icon aria-hidden="true" />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Preferences">
            <CommandItem value="Switch theme" onSelect={() => run(toggleTheme)}>
              {resolvedTheme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              {resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            </CommandItem>
            <CommandItem value="Sign out" onSelect={() => run(() => void handleSignOut())}>
              <LogOut aria-hidden="true" />
              Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
