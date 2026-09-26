import { Archive, CalendarDays, Copy, Ellipsis, FolderKanban, PanelRightOpen, Users, Wallet } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Member, Project, ProjectStatus } from "@/lib/api";
import { images } from "@/lib/images";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { priorityLabel, statusLabel } from "./constants";
import { MemberAvatar, PriorityLabel, relativeDue, StatusBadge } from "./parts";

export type ProjectFilter = "all" | ProjectStatus;

const FILTERS: readonly { value: ProjectFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
];

/** A soft gradient tile per status, so rows scan quickly (decorative). */
const TILE = {
  active: "from-emerald-500/20 to-teal-500/20 text-emerald-700 dark:text-emerald-300",
  paused: "from-amber-500/20 to-orange-500/20 text-amber-700 dark:text-amber-300",
  done: "from-slate-500/15 to-sky-500/15 text-slate-600 dark:text-slate-300",
} as const;

function caption(filter: ProjectFilter, count: number): string {
  const noun = count === 1 ? "project" : "projects";
  if (filter === "all") return `Showing all ${count} ${noun}, newest first.`;
  return `Showing ${count} ${statusLabel(filter).toLowerCase()} ${noun}, newest first.`;
}

interface ProjectsCardProps {
  projects: readonly Project[];
  members: readonly Member[];
  filter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
  /** Latest successful save, announced politely ("“X” was added to your projects."). */
  message: string;
  /** Latest failed row action (Duplicate), shown as an alert. */
  error: string;
  onDuplicate: (project: Project) => void;
  /** Resolves when archived; rejects with a message to show. */
  onArchive: (project: Project) => Promise<void>;
}

type Pending = { kind: "open" | "archive"; project: Project } | null;

/**
 * The "Projects" card (id="projects"): status Tabs (All, Active, Paused, Done) that filter a real <table>, and a row
 * actions menu per row ("Actions for <project>": Open, Duplicate, Archive). Open shows a details panel; Archive asks
 * first in an AlertDialog.
 */
export function ProjectsCard({ projects, members, filter, onFilterChange, message, error, onDuplicate, onArchive }: ProjectsCardProps) {
  const titleId = useId();
  const memberById = new Map(members.map((m) => [m.id, m]));
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const tableRegion = useRef<HTMLDivElement | null>(null);
  const pending = useRef<Pending>(null);
  // The dialogs keep their project after closing, so their exit animation still has content.
  const [details, setDetails] = useState<Project | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const archivedId = useRef<string | null>(null);

  const counts = {
    all: projects.length,
    active: projects.filter((p) => p.status === "active").length,
    paused: projects.filter((p) => p.status === "paused").length,
    done: projects.filter((p) => p.status === "done").length,
  };

  const focusTrigger = (id: string) => {
    const el = triggers.current.get(id);
    if (el?.isConnected) el.focus();
    else (document.querySelector<HTMLElement>("#projects [role=tab][aria-selected=true]") ?? tableRegion.current)?.focus();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    setArchiveError("");
    try {
      await onArchive(archiveTarget);
      archivedId.current = archiveTarget.id;
      setArchiveOpen(false);
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : "Something went wrong on our side. Please try again.");
    } finally {
      setArchiving(false);
    }
  };

  const detailsOwner = details ? memberById.get(details.ownerId) : undefined;

  return (
    <Card id="projects" className="scroll-mt-24 gap-5">
      <CardHeader className="gap-1 px-4 sm:px-6">
        <CardTitle as="h2" id={titleId} className="text-lg">
          Projects
        </CardTitle>
        <CardDescription>Every project in the workspace, with its owner, budget and progress.</CardDescription>
      </CardHeader>
      {/* grid-cols-1 is minmax(0, 1fr): the wide table scrolls inside its region instead of widening the page. */}
      <CardContent className="grid grid-cols-1 gap-4 px-4 sm:px-6">
        <p role="status" className={cn("text-sm font-medium text-success", !message && "sr-only")}>
          {message}
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Project not duplicated</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Tabs value={filter} onValueChange={(v) => onFilterChange(v as ProjectFilter)} className="min-w-0 gap-4">
          <TabsList aria-label="Filter projects by status" className="w-full sm:w-fit">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="flex-1 px-2 sm:flex-none sm:px-3">
                {f.label}
                <span aria-hidden="true" className="hidden rounded-md sm:inline bg-muted px-1.5 text-xs font-semibold text-muted-foreground tabular-nums in-data-[state=active]:bg-accent in-data-[state=active]:text-accent-foreground">
                  {counts[f.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {FILTERS.map((f) => {
            const rows = f.value === "all" ? projects : projects.filter((p) => p.status === f.value);
            return (
              <TabsContent key={f.value} value={f.value} className="min-w-0 rounded-xl">
                {rows.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
                    <img src={images.emptyState.src} alt="" width={images.emptyState.width} height={images.emptyState.height} className="h-28 w-auto opacity-90" />
                    <p className="font-medium">No {f.label.toLowerCase()} projects</p>
                    <p className="max-w-sm text-sm text-muted-foreground">Projects show up here as soon as they move to {f.label}.</p>
                  </div>
                ) : (
                  <div ref={f.value === filter ? tableRegion : undefined}>
                    <Table containerLabel="Projects table" className="min-w-[860px]" aria-labelledby={titleId}>
                      <TableCaption className="text-left">{caption(f.value, rows.length)}</TableCaption>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead scope="col" className="pl-4">
                            Project
                          </TableHead>
                          <TableHead scope="col">Owner</TableHead>
                          <TableHead scope="col">Status</TableHead>
                          <TableHead scope="col">Priority</TableHead>
                          <TableHead scope="col">Due</TableHead>
                          <TableHead scope="col" className="text-right">
                            Budget
                          </TableHead>
                          <TableHead scope="col">Progress</TableHead>
                          <TableHead scope="col" className="w-12">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((project) => {
                          const owner = memberById.get(project.ownerId);
                          return (
                            <TableRow key={project.id} className="group/row">
                              <th scope="row" className="py-3 pr-3 pl-4 text-left align-middle font-medium">
                                <span className="flex items-center gap-3">
                                  <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br", TILE[project.status])}>
                                    <FolderKanban className="size-4" />
                                  </span>
                                  <span className="max-w-56 truncate">{project.name}</span>
                                </span>
                              </th>
                              <TableCell>
                                <span className="flex items-center gap-2 whitespace-nowrap">
                                  <MemberAvatar member={owner} className="size-7" />
                                  {owner?.name ?? "Unassigned"}
                                </span>
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={project.status} />
                              </TableCell>
                              <TableCell>
                                <PriorityLabel priority={project.priority} />
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {project.dueDate ? (
                                  <>
                                    <span className="block">{formatDate(project.dueDate)}</span>
                                    <span className="block text-xs text-muted-foreground">
                                      {project.status === "done" ? "Delivered" : relativeDue(project.dueDate)}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">No date</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(project.budget)}</TableCell>
                              <TableCell>
                                <span className="flex items-center gap-2">
                                  <Progress value={project.progress} aria-label={`${project.name} progress`} className="w-20" />
                                  <span className="w-9 text-right text-xs font-medium tabular-nums text-muted-foreground">{project.progress}%</span>
                                </span>
                              </TableCell>
                              <TableCell className="pr-3">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      ref={(el) => {
                                        if (el) triggers.current.set(project.id, el);
                                        else triggers.current.delete(project.id);
                                      }}
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
                                    >
                                      <Ellipsis aria-hidden="true" className="size-5" />
                                      <span className="sr-only">Actions for {project.name}</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    className="w-44"
                                    onCloseAutoFocus={(e) => {
                                      // Open and Archive show a dialog once the menu has closed, so focus moves into it.
                                      const next = pending.current;
                                      if (!next) return;
                                      e.preventDefault();
                                      pending.current = null;
                                      if (next.kind === "open") {
                                        setDetails(next.project);
                                        setDetailsOpen(true);
                                      } else {
                                        setArchiveError("");
                                        setArchiveTarget(next.project);
                                        setArchiveOpen(true);
                                      }
                                    }}
                                  >
                                    <DropdownMenuItem onSelect={() => (pending.current = { kind: "open", project })}>
                                      <PanelRightOpen aria-hidden="true" />
                                      Open
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => onDuplicate(project)}>
                                      <Copy aria-hidden="true" />
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem variant="destructive" onSelect={() => (pending.current = { kind: "archive", project })}>
                                      <Archive aria-hidden="true" />
                                      Archive
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>

      {/* Open: a read-only details panel. */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        {details && (
          <SheetContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              focusTrigger(details.id);
            }}
          >
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={details.status} />
                <PriorityLabel priority={details.priority} />
              </div>
              <SheetTitle className="text-xl">{details.name}</SheetTitle>
              <SheetDescription>{details.description || "No description yet."}</SheetDescription>
            </SheetHeader>
            <SheetBody className="grid grid-cols-1 content-start gap-6 pb-6">
              <div className="rounded-2xl border bg-card p-4 shadow-soft">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Progress</span>
                  <span className="font-semibold tabular-nums">{details.progress}%</span>
                </div>
                <Progress value={details.progress} aria-label={`${details.name} progress`} className="mt-3 h-2.5" />
              </div>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Users aria-hidden="true" className="size-4" />
                    Owner
                  </dt>
                  <dd className="flex items-center gap-2 font-medium">
                    <MemberAvatar member={detailsOwner} className="size-6" />
                    {detailsOwner?.name ?? "Unassigned"}
                  </dd>
                </div>
                <div className="grid gap-1.5">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays aria-hidden="true" className="size-4" />
                    Due
                  </dt>
                  <dd className="font-medium">{details.dueDate ? formatDate(details.dueDate) : "No date"}</dd>
                </div>
                <div className="grid gap-1.5">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Wallet aria-hidden="true" className="size-4" />
                    Budget
                  </dt>
                  <dd className="font-medium tabular-nums">{formatCurrency(details.budget)}</dd>
                </div>
                <div className="grid gap-1.5">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <FolderKanban aria-hidden="true" className="size-4" />
                    Status and priority
                  </dt>
                  <dd className="font-medium">
                    {statusLabel(details.status)}, {priorityLabel(details.priority).toLowerCase()} priority
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">
                {details.notify ? "The team is notified about changes to this project." : "Team notifications are off for this project."}
              </p>
            </SheetBody>
          </SheetContent>
        )}
      </Sheet>

      {/* Archive: destructive, so it asks first. */}
      <AlertDialog
        open={archiveOpen}
        onOpenChange={(open) => {
          if (!open && !archiving) setArchiveOpen(false);
        }}
      >
        {archiveTarget && (
          <AlertDialogContent
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const id = archivedId.current ?? archiveTarget.id;
              archivedId.current = null;
              focusTrigger(id);
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Archive {archiveTarget.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                It leaves the projects table and the dashboard numbers. Its tasks and history are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {archiveError && (
              <Alert variant="destructive">
                <AlertTitle>Project not archived</AlertTitle>
                <AlertDescription>{archiveError}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
              <Button type="button" variant="destructive" loading={archiving} onClick={() => void confirmArchive()}>
                Archive project
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Card>
  );
}
