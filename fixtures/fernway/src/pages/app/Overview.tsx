/** The dashboard's read-only overview pieces: stat tiles, upcoming deadlines and the team card. */
import { CalendarClock, FolderKanban, ListChecks, Target, TrendingUp, Users, Wallet, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Member, Project, Task } from "@/lib/api";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { daysUntil, MemberAvatar, relativeDue, Sparkline } from "./parts";

interface Stat {
  label: string;
  value: string;
  delta: string;
  note: string;
  icon: LucideIcon;
  trend: number[];
  tone: string;
}

/** The 4 stat tiles ("Workspace at a glance"), computed from the live data where there is any. */
export function StatTiles({ projects, tasks }: { projects: readonly Project[]; tasks: readonly Task[] }) {
  const active = projects.filter((p) => p.status === "active");
  const open = projects.filter((p) => p.status !== "done");
  const dueSoon = active.filter((p) => p.dueDate && daysUntil(p.dueDate) >= 0 && daysUntil(p.dueDate) <= 45).length;
  const openTasks = tasks.filter((t) => !t.done).length;
  const doneTasks = tasks.length - openTasks;
  const inFlight = open.reduce((sum, p) => sum + p.budget, 0);

  const stats: Stat[] = [
    {
      label: "Active projects",
      value: String(active.length),
      delta: "+2 vs last month",
      note: `${dueSoon} due in the next 45 days`,
      icon: FolderKanban,
      trend: [1, 2, 2, 3, 2, 3, 3, 4, 3, 4, active.length],
      tone: "from-emerald-500 to-teal-500",
    },
    {
      label: "Open tasks",
      value: String(openTasks),
      delta: `${doneTasks} done`,
      note: "Across every project today",
      icon: ListChecks,
      trend: [7, 5, 6, 4, 6, 5, 3, 4, 2, 3, openTasks],
      tone: "from-sky-500 to-indigo-500",
    },
    {
      label: "Budget in flight",
      value: formatCurrency(inFlight),
      delta: "+12% vs last quarter",
      note: `Across ${open.length} open ${open.length === 1 ? "project" : "projects"}`,
      icon: Wallet,
      trend: [52, 55, 54, 58, 60, 59, 63, 66, 64, 68, inFlight / 1000],
      tone: "from-teal-500 to-cyan-500",
    },
    {
      label: "On-time delivery",
      value: "94%",
      delta: "+3 pts vs last quarter",
      note: "Projects delivered by their due date",
      icon: Target,
      trend: [86, 88, 87, 89, 90, 89, 91, 92, 91, 93, 94],
      tone: "from-violet-500 to-fuchsia-500",
    },
  ];

  return (
    <ul aria-label="Workspace at a glance" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.label} className="motion-safe:animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
            <Card className="group relative h-full gap-3 overflow-hidden py-5 transition-shadow hover:shadow-glow">
              <div aria-hidden="true" className={cn("pointer-events-none absolute -top-12 -right-10 size-32 rounded-full bg-linear-to-br opacity-15 blur-2xl", s.tone)} />
              <CardContent className="grid gap-3 px-5">
                <p className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
                  <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br text-white shadow-soft", s.tone)}>
                    <Icon className="size-4" />
                  </span>
                  {s.label}
                </p>
                <div className="flex items-end justify-between gap-3">
                  <p className="text-3xl font-semibold tracking-tight">{s.value}</p>
                  <Sparkline values={s.trend} className="mb-1 shrink-0" />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Badge variant="success" className="gap-1">
                    <TrendingUp aria-hidden="true" />
                    {s.delta}
                  </Badge>
                  <span className="text-muted-foreground">{s.note}</span>
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** The next deadlines among projects that are not done. */
export function DeadlinesCard({ projects, members, className }: { projects: readonly Project[]; members: readonly Member[]; className?: string }) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const upcoming = projects
    .filter((p) => p.status !== "done" && p.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4);
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-lg">
          <CalendarClock aria-hidden="true" className="size-5 text-primary" />
          Upcoming deadlines
        </CardTitle>
        <CardDescription>What's due next across the studio.</CardDescription>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is due. Enjoy the calm.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {upcoming.map((p) => {
              const owner = byId.get(p.ownerId);
              const days = daysUntil(p.dueDate);
              return (
                <li key={p.id} className="grid grid-cols-1 gap-2 rounded-xl border bg-card/60 p-3">
                  <div className="flex items-start gap-3">
                    <MemberAvatar member={owner} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {owner?.name ?? "Unassigned"} · {formatDate(p.dueDate)}
                      </p>
                    </div>
                    <Badge variant={days < 14 ? "warning" : "outline"} className="shrink-0">
                      {relativeDue(p.dueDate)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={p.progress} aria-label={`${p.name} progress`} className="h-1.5" />
                    <span className="w-9 text-right text-xs font-medium tabular-nums text-muted-foreground">{p.progress}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Who is on the team and what each person owns. */
export function TeamCard({ projects, members, className }: { projects: readonly Project[]; members: readonly Member[]; className?: string }) {
  const owned = (id: string) => projects.filter((p) => p.ownerId === id && p.status !== "done");
  const ranked = [...members].sort((a, b) => owned(b.id).length - owned(a.id).length).slice(0, 5);
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-lg">
          <Users aria-hidden="true" className="size-5 text-primary" />
          Team
        </CardTitle>
        <CardDescription>
          {members.length} people in the workspace. Busiest first.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div aria-hidden="true" className="flex -space-x-2">
          {members.map((m) => (
            <MemberAvatar key={m.id} member={m} className="size-9" />
          ))}
        </div>
        <ul className="grid grid-cols-1 gap-1">
          {ranked.map((m) => {
            const mine = owned(m.id);
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                <MemberAvatar member={m} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.role}</p>
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  {mine.length === 0 ? "No open projects" : `${mine.length} open ${mine.length === 1 ? "project" : "projects"}`}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
