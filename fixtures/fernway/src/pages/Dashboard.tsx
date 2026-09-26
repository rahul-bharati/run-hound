import { FolderPlus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppShell, type PaletteGroup } from "@/components/app/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { apiGet, apiPatch, apiPost, isApiError, taskPath, taskUpdate, type Member, type Project, type Task } from "@/lib/api";
import { useSessionUser } from "@/lib/session";
import { todayIso, useDocumentTitle } from "@/lib/utils";
import { LIMITS } from "./app/constants";
import { useLoad } from "./app/data";
import { NewProjectSheet } from "./app/NewProjectSheet";
import { DeadlinesCard, StatTiles, TeamCard } from "./app/Overview";
import { ProjectsCard, type ProjectFilter } from "./app/ProjectsCard";
import { QuickAddCard } from "./app/QuickAddCard";
import { ThroughputChart } from "./app/ThroughputChart";

interface Workspace {
  projects: Project[];
  members: Member[];
  tasks: Task[];
}

async function loadWorkspace(signal: AbortSignal): Promise<Workspace> {
  const [projects, members, tasks] = await Promise.all([
    apiGet<Project[]>("/api/projects", { signal }),
    apiGet<Member[]>("/api/members", { signal }),
    apiGet<Task[]>("/api/tasks", { signal }),
  ]);
  return { projects, members, tasks };
}

/** Newest first; records created at the same moment keep the server's order. */
const newestFirst = (projects: readonly Project[]) => [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const errorMessage = (err: unknown) => (isApiError(err) ? err.message : "Something went wrong on our side. Please try again.");

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

/** /app (CONTRACT.md "/app Dashboard"). */
export default function Dashboard() {
  useDocumentTitle("Dashboard");
  const user = useSessionUser();
  const { state, reload, setData } = useLoad(loadWorkspace);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [message, setMessage] = useState("");
  const [rowError, setRowError] = useState("");
  const newProjectButton = useRef<HTMLButtonElement>(null);

  const data = state.status === "ready" ? state.data : undefined;
  const projects = useMemo(() => newestFirst(data?.projects ?? []), [data?.projects]);
  const members = data?.members ?? [];
  const tasks = data?.tasks ?? [];

  const addProject = useCallback((project: Project) => setData((d) => ({ ...d, projects: [...d.projects, project] })), [setData]);

  const onProjectCreated = (project: Project) => {
    addProject(project);
    setRowError("");
    setFilter("all");
    setSheetOpen(false);
    setMessage(`“${project.name}” was added to your projects.`);
    toast.success("Project created", { description: project.name });
  };

  const onDuplicate = async (project: Project) => {
    setRowError("");
    const name = `${project.name} (copy)`.slice(0, LIMITS.projectName);
    try {
      const copy = await apiPost<Project>("/api/projects", {
        name,
        description: project.description,
        status: project.status,
        priority: project.priority,
        ownerId: project.ownerId,
        dueDate: project.dueDate && project.dueDate >= todayIso() ? project.dueDate : "",
        budget: project.budget,
        notify: project.notify,
      });
      addProject(copy);
      setMessage(`“${copy.name}” was added to your projects.`);
      toast.success(`Duplicated ${project.name}`, { description: `Saved as ${copy.name}` });
    } catch (err) {
      setMessage("");
      setRowError(`${project.name} was not duplicated. ${errorMessage(err)}`);
      toast.error("Project not duplicated", { description: errorMessage(err) });
    }
  };

  const onArchive = async (project: Project) => {
    try {
      await apiPatch(`/api/projects/${encodeURIComponent(project.id)}`, { archived: true });
    } catch (err) {
      toast.error("Project not archived", { description: errorMessage(err) });
      throw new Error(errorMessage(err));
    }
    setData((d) => ({ ...d, projects: d.projects.filter((p) => p.id !== project.id) }));
    setRowError("");
    setMessage(`Archived “${project.name}”.`);
    toast.success(`Archived ${project.name}`);
  };

  const onTaskCreated = (task: Task) => setData((d) => ({ ...d, tasks: [...d.tasks, task] }));

  const onToggleTask = async (task: Task, done: boolean) => {
    const set = (value: boolean) => setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, done: value } : t)) }));
    set(done);
    try {
      await apiPatch(taskPath(task.id), taskUpdate({ ...task, done }));
    } catch (err) {
      set(!done);
      toast.error("Task not updated", { description: errorMessage(err) });
    }
  };

  const commands: PaletteGroup[] = [
    {
      heading: "Create",
      items: [{ label: "New project", keywords: ["create", "add", "project"], icon: FolderPlus, onSelect: () => setSheetOpen(true) }],
    },
  ];

  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <AppShell commands={commands}>
      <div className="flex flex-col gap-6 lg:gap-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary">{longDate.format(new Date())}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>
            <p className="mt-2 text-muted-foreground">
              {greeting()}, {firstName}. Here's where your studio stands today.
            </p>
          </div>
          <Button ref={newProjectButton} type="button" size="lg" onClick={() => setSheetOpen(true)} className="shadow-glow">
            <Plus aria-hidden="true" />
            New project
          </Button>
        </div>

        {state.status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>We couldn't load your workspace</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
            <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={reload}>
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </Alert>
        )}

        {state.status === "loading" && <DashboardSkeleton />}

        {data && (
          <>
            <StatTiles projects={projects} tasks={tasks} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <ThroughputChart className="min-w-0 xl:col-span-2" />
              <QuickAddCard projects={projects} tasks={tasks} onCreated={onTaskCreated} onToggle={(t, done) => void onToggleTask(t, done)} className="min-w-0" />
            </div>
            <ProjectsCard
              projects={projects}
              members={members}
              filter={filter}
              onFilterChange={setFilter}
              message={message}
              error={rowError}
              onDuplicate={(p) => void onDuplicate(p)}
              onArchive={onArchive}
            />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <DeadlinesCard projects={projects} members={members} className="min-w-0" />
              <TeamCard projects={projects} members={members} className="min-w-0" />
            </div>
          </>
        )}
      </div>

      <NewProjectSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        members={members}
        defaultOwnerId={members.find((m) => m.id === user.id)?.id ?? members[0]?.id ?? user.id}
        onCreated={onProjectCreated}
        returnFocus={newProjectButton}
      />
    </AppShell>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-96 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}
