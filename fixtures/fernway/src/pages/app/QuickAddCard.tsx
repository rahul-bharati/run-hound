import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, ListTodo, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { apiPost, isApiError, type Project, type Task } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { cn } from "@/lib/utils";
import { LIMITS } from "./constants";

/** Radix Select items cannot have an empty value; this one stands for "no project". */
const NO_PROJECT = "none";

const schema = z.object({
  title: z.string().trim().min(1, "Enter a task.").max(LIMITS.taskTitle, `Use ${LIMITS.taskTitle} characters or fewer.`),
  projectId: z.string(),
});
type Values = z.input<typeof schema>;

const DOT = { active: "bg-emerald-500", paused: "bg-amber-500", done: "bg-slate-400" } as const;

interface QuickAddCardProps {
  projects: readonly Project[];
  tasks: readonly Task[];
  onCreated: (task: Task) => void;
  onToggle: (task: Task, done: boolean) => void;
  className?: string;
}

/**
 * "Quick add" (CONTRACT.md): the Quick add task form (Task, Project, "Add task") and the "Today" list under it. The
 * list sits outside the <form>, so its checkboxes are not fields of the form.
 * W03: "Add task" never disables and nothing guards a second submit, so a double click posts twice.
 */
export function QuickAddCard({ projects, tasks, onCreated, onToggle, className }: QuickAddCardProps) {
  const w03 = useBug("W03");
  const titleId = useId();
  const todayId = useId();
  const inFlight = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState("");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: "", projectId: NO_PROJECT } });
  const projectName = new Map(projects.map((p) => [p.id, p]));

  const onSubmit = async (values: Values) => {
    if (!w03 && inFlight.current) return;
    inFlight.current = true;
    setSaveError("");
    setStatus("");
    const title = values.title.trim();
    try {
      const task = await apiPost<Task>("/api/tasks", { title, projectId: values.projectId === NO_PROJECT ? "" : values.projectId });
      onCreated(task);
      form.reset({ title: "", projectId: values.projectId });
      setStatus(`Added “${task.title}” to Today.`);
      toast.success("Task added", { description: task.title });
    } catch (err) {
      if (isApiError(err) && err.status >= 400 && err.status < 500 && Object.keys(err.errors).length) {
        for (const [field, message] of Object.entries(err.errors)) {
          if (field === "title" || field === "projectId") form.setError(field, { type: "server", message }, { shouldFocus: true });
        }
      }
      const message = isApiError(err) ? err.message : "Something went wrong on our side. Please try again.";
      setSaveError(message);
      toast.error("Task not added", { description: message });
    } finally {
      inFlight.current = false;
    }
  };

  const doneCount = tasks.filter((t) => t.done).length;
  const ordered = [...tasks].reverse();

  return (
    <Card className={cn("gap-5", className)}>
      <CardHeader>
        <CardTitle as="h2" id={titleId} className="flex items-center gap-2 text-lg">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground">
            <ListTodo className="size-4" />
          </span>
          Quick add
        </CardTitle>
        <CardDescription>Capture a task in seconds. It lands in Today, right below.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5">
        <Form {...form}>
          <form aria-labelledby={titleId} noValidate onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Send the Northwind moodboard" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <FormField
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger ref={field.ref} onBlur={field.onBlur}>
                          <SelectValue placeholder="No project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_PROJECT}>No project</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" loading={w03 ? false : form.formState.isSubmitting}>
                {!form.formState.isSubmitting || w03 ? <Plus aria-hidden="true" /> : null}
                Add task
              </Button>
            </div>
            <FormErrorSummary />
            {saveError && (
              <Alert variant="destructive">
                <AlertTitle>Task not added</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <p role="status" className={cn("flex items-center gap-1.5 text-sm font-medium text-success", !status && "sr-only")}>
              {status && <CircleCheck aria-hidden="true" className="size-4" />}
              {status}
            </p>
          </form>
        </Form>

        <div className="grid gap-3 border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 id={todayId} className="text-sm font-semibold">
              Today
            </h3>
            <p className="text-xs text-muted-foreground">
              {doneCount} of {tasks.length} done
            </p>
          </div>
          <Progress value={tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0} aria-label="Tasks done today" className="h-1.5" />
          <ul aria-labelledby={todayId} className="grid grid-cols-1 gap-1">
            {ordered.map((task) => {
              const project = task.projectId ? projectName.get(task.projectId) : undefined;
              const boxId = `task-${task.id}`;
              return (
                <li key={task.id} className="flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60">
                  <Checkbox id={boxId} checked={task.done} onCheckedChange={(v) => onToggle(task, v === true)} className="mt-px" />
                  <div className="grid min-w-0 gap-0.5">
                    <Label htmlFor={boxId} className={cn("cursor-pointer leading-6 font-medium", task.done && "text-muted-foreground line-through")}>
                      {task.title}
                    </Label>
                    {project && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[project.status])} />
                        {project.name}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
