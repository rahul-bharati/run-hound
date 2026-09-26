import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useRef, useState, type RefObject } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Form, FormControl, FormDescription, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, isApiError, type Member, type Project } from "@/lib/api";
import { cn, formatCurrency, todayIso } from "@/lib/utils";
import { BUDGET, LIMITS, PROJECT_PRIORITY_OPTIONS, PROJECT_STATUS_OPTIONS } from "./constants";
import { MemberAvatar, PRIORITY_LEVEL, PriorityBars } from "./parts";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a project name.").max(LIMITS.projectName, `Use ${LIMITS.projectName} characters or fewer.`),
  description: z.string().trim().max(LIMITS.description, `Keep the description to ${LIMITS.description} characters or fewer.`),
  status: z.enum(["active", "paused", "done"], { error: "Choose Active, Paused or Done." }),
  priority: z.enum(["low", "medium", "high"], { error: "Choose Low, Medium or High." }),
  ownerId: z.string().min(1, "Choose an owner."),
  dueDate: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid due date.")
    .refine((v) => v === "" || v >= todayIso(), "Choose a due date that is not in the past."),
  budget: z.number().int().min(BUDGET.min).max(BUDGET.max),
  notify: z.boolean(),
});
type Values = z.input<typeof schema>;
const FIELDS = Object.keys(schema.shape) as (keyof Values)[];

interface NewProjectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: readonly Member[];
  defaultOwnerId: string;
  onCreated: (project: Project) => void;
  /** Where focus goes when the sheet closes (the "New project" button), whoever opened it. */
  returnFocus: RefObject<HTMLElement | null>;
}

/**
 * "New project": a Radix Dialog rendered as a right-side sheet with the New project form (CONTRACT.md). The form
 * only exists while the sheet is open, and starts fresh each time.
 */
export function NewProjectSheet({ open, onOpenChange, members, defaultOwnerId, onCreated, returnFocus }: NewProjectSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>New project</SheetTitle>
          <SheetDescription>Plan the basics now. You can change any of it later.</SheetDescription>
        </SheetHeader>
        <NewProjectForm members={members} defaultOwnerId={defaultOwnerId} onCreated={onCreated} />
      </SheetContent>
    </Sheet>
  );
}

function NewProjectForm({ members, defaultOwnerId, onCreated }: Pick<NewProjectSheetProps, "members" | "defaultOwnerId" | "onCreated">) {
  const inFlight = useRef(false);
  const budgetHintId = useId();
  const [saveError, setSaveError] = useState("");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      description: "",
      status: "active",
      priority: "medium",
      ownerId: defaultOwnerId,
      dueDate: "",
      budget: BUDGET.default,
      notify: true,
    },
  });

  const owners: ComboboxOption[] = members.map((m) => ({
    value: m.id,
    label: m.name,
    description: m.role,
    keywords: [m.email, m.role],
    icon: <MemberAvatar member={m} className="size-6 ring-0" />,
  }));

  const onSubmit = async (values: Values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaveError("");
    try {
      const project = await apiPost<Project>("/api/projects", {
        name: values.name.trim(),
        description: values.description.trim(),
        status: values.status,
        priority: values.priority,
        ownerId: values.ownerId,
        dueDate: values.dueDate,
        budget: values.budget,
        notify: values.notify,
      });
      onCreated(project);
    } catch (err) {
      let fieldErrors = 0;
      if (isApiError(err)) {
        for (const [field, message] of Object.entries(err.errors)) {
          if ((FIELDS as string[]).includes(field)) {
            form.setError(field as keyof Values, { type: "server", message }, { shouldFocus: fieldErrors === 0 });
            fieldErrors++;
          }
        }
      }
      const message = isApiError(err) ? err.message : "Something went wrong on our side. Please try again.";
      setSaveError(message);
      toast.error("Project not created", { description: message });
    } finally {
      inFlight.current = false;
    }
  };

  const submitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form noValidate aria-labelledby={undefined} onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col gap-4">
        <SheetBody className="grid grid-cols-1 content-start gap-5">
          {saveError && (
            <Alert variant="destructive">
              <AlertTitle>Project not created</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
          <FormErrorSummary visible />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Project name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Cedar onboarding kit" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder="What does done look like?" className="min-h-20 resize-y" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger ref={field.ref} onBlur={field.onBlur}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PROJECT_STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Due date</FormLabel>
                  <FormControl>
                    <Input type="date" min={todayIso()} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={undefined}>Priority</FormLabel>
                <FormControl labelMode="labelledby">
                  <RadioGroup ref={field.ref} value={field.value} onValueChange={field.onChange} orientation="horizontal" className="grid-cols-3 gap-2">
                    {PROJECT_PRIORITY_OPTIONS.map((p) => {
                      const id = `priority-${p.value}`;
                      const checked = field.value === p.value;
                      return (
                        <div
                          key={p.value}
                          className={cn(
                            "relative flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 shadow-xs transition-colors",
                            checked ? "border-primary bg-accent/60 ring-1 ring-primary" : "hover:bg-muted/60",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <PriorityBars level={PRIORITY_LEVEL[p.value]} className={checked ? "text-primary" : "text-muted-foreground"} />
                            <RadioGroupItem id={id} value={p.value} className="after:absolute after:inset-0 after:content-['']" />
                          </div>
                          <Label htmlFor={id} className="cursor-pointer">
                            {p.label}
                          </Label>
                          <span className="hidden text-xs text-muted-foreground sm:block" aria-hidden="true">
                            {p.hint}
                          </span>
                        </div>
                      );
                    })}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="ownerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Owner</FormLabel>
                <FormControl>
                  <Combobox
                    ref={field.ref}
                    onBlur={field.onBlur}
                    options={owners}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder="Choose an owner"
                    searchLabel="Search team members"
                    searchPlaceholder="Search by name or role…"
                    emptyText="No team member matches."
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="budget"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-3">
                  <FormLabel htmlFor={undefined}>Budget</FormLabel>
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(field.value)}</span>
                </div>
                <FormControl labelMode="labelledby" aria-describedby={budgetHintId}>
                  <Slider
                    ref={field.ref}
                    min={BUDGET.min}
                    max={BUDGET.max}
                    step={BUDGET.step}
                    value={[field.value]}
                    onValueChange={(v) => field.onChange(v[0] ?? BUDGET.min)}
                    onBlur={field.onBlur}
                    valueText={(v) => formatCurrency(v)}
                  />
                </FormControl>
                <div id={budgetHintId} className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatCurrency(BUDGET.min)}</span>
                  <span className="sr-only">to</span>
                  <span>{formatCurrency(BUDGET.max)}, in steps of {formatCurrency(BUDGET.step)}</span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="notify"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-xs">
                <div className="grid gap-1">
                  <FormLabel>Notify the team</FormLabel>
                  <FormDescription className="text-xs">Email the owner and everyone following the workspace.</FormDescription>
                </div>
                <FormControl>
                  <Switch ref={field.ref} checked={field.value} onCheckedChange={field.onChange} onBlur={field.onBlur} />
                </FormControl>
              </FormItem>
            )}
          />
        </SheetBody>

        <SheetFooter>
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </SheetClose>
          <Button type="submit" loading={submitting}>
            Create project
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}
