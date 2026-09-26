import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Briefcase, CircleCheck, CircleX, LoaderCircle, Sprout, UsersRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ONBOARDING_MESSAGES, SLUG_PREFIX, SLUG_RE, slugify, workspaceSchema, type UseCase, type WorkspaceValues } from "./schema";
import { StepHeader } from "./StepHeader";

export const USE_CASES: { value: UseCase; label: string; description: string; icon: LucideIcon }[] = [
  { value: "client", label: "Client projects", description: "Timelines, approvals and budgets for client work.", icon: Briefcase },
  { value: "internal", label: "Internal work", description: "Roadmaps, sprints and your team's rituals.", icon: UsersRound },
  { value: "personal", label: "Personal", description: "Side projects and planning just for you.", icon: Sprout },
];

type SlugStatus = "checking" | "available" | "taken" | "unknown";

/** GET /api/slug-available; "unknown" when the check itself fails (the server decides again on Finish setup). */
async function checkSlug(slug: string): Promise<Exclude<SlugStatus, "checking">> {
  try {
    const res = await apiGet<{ available: boolean }>(`/api/slug-available?slug=${encodeURIComponent(slug)}`);
    return res.available ? "available" : "taken";
  } catch {
    return "unknown";
  }
}

/** Debounced availability of a well-formed slug (null while the slug is empty or malformed). */
function useSlugCheck(slug: string) {
  const [check, setCheck] = useState<{ slug: string; status: SlugStatus } | null>(null);
  useEffect(() => {
    if (!SLUG_RE.test(slug)) {
      setCheck(null);
      return;
    }
    let current = true;
    setCheck({ slug, status: "checking" });
    const timer = window.setTimeout(() => {
      void checkSlug(slug).then((status) => {
        if (current) setCheck({ slug, status });
      });
    }, 350);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [slug]);
  return [check, setCheck] as const;
}

export const SLUG_STATUS_ID = "workspace-url-status";

export interface StepWorkspaceProps {
  initial: WorkspaceValues;
  slugEdited: boolean;
  onSlugEdited: (edited: boolean) => void;
  /** A 409 from Finish setup: shown on the URL field, which takes focus. */
  serverSlugError: string | null;
  focusOnMount: boolean;
  onDraft: (values: WorkspaceValues) => void;
  onNext: (values: WorkspaceValues) => void;
}

/** Step 1, the Workspace form: name, URL (slug, availability checked as you type) and what it is for. */
export function StepWorkspace({ initial, slugEdited, onSlugEdited, serverSlugError, focusOnMount, onDraft, onNext }: StepWorkspaceProps) {
  const form = useForm<WorkspaceValues>({ resolver: zodResolver(workspaceSchema), defaultValues: initial });
  const [workspaceName, slug, useCase] = useWatch({ control: form.control, name: ["workspaceName", "slug", "useCase"] });
  const [check, setCheck] = useSlugCheck(slug);

  useEffect(() => {
    onDraft({ workspaceName, slug, useCase });
  }, [workspaceName, slug, useCase, onDraft]);

  useEffect(() => {
    if (serverSlugError) form.setError("slug", { type: "server", message: serverSlugError }, { shouldFocus: true });
    // Only when the step first appears.
  }, []);

  async function onSubmit(values: WorkspaceValues) {
    const known = check && check.slug === values.slug && check.status !== "checking" ? check.status : null;
    const status = known ?? (await checkSlug(values.slug));
    setCheck({ slug: values.slug, status });
    if (status === "taken") {
      form.setError("slug", { type: "server", message: ONBOARDING_MESSAGES.slugTaken }, { shouldFocus: true });
      return;
    }
    onNext(values);
  }

  const status = check?.slug === slug ? check.status : null;

  return (
    <Form {...form}>
      <form noValidate aria-labelledby="step-workspace-title" onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <StepHeader
          id="step-workspace-title"
          step={1}
          title="Name your workspace"
          description="This is where your projects, clients and team will live. You can change all of it later."
          focusOnMount={focusOnMount && !serverSlugError}
        />

        <FormField
          control={form.control}
          name="workspaceName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workspace name</FormLabel>
              <FormControl>
                <Input
                  autoComplete="organization"
                  required
                  placeholder="Juniper Studio"
                  className="h-11"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    if (!slugEdited) form.setValue("slug", slugify(e.target.value, true), { shouldValidate: form.formState.isSubmitted });
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workspace URL</FormLabel>
              <div className="flex min-w-0 items-stretch">
                <span className="inline-flex shrink-0 items-center rounded-l-xl border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground select-none">
                  {SLUG_PREFIX}
                </span>
                <FormControl aria-describedby={SLUG_STATUS_ID}>
                  <Input
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="url"
                    placeholder="juniper-studio"
                    className="h-11 rounded-l-none"
                    {...field}
                    onChange={(e) => {
                      const next = slugify(e.target.value);
                      onSlugEdited(next !== "");
                      field.onChange(next);
                    }}
                  />
                </FormControl>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <FormDescription>Lowercase letters, numbers and hyphens.</FormDescription>
                <p id={SLUG_STATUS_ID} role="status" className="flex min-h-5 items-center gap-1.5 text-sm font-medium">
                  {status === "checking" && (
                    <>
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">Checking…</span>
                    </>
                  )}
                  {status === "available" && (
                    <>
                      <CircleCheck aria-hidden="true" className="size-4 text-success" />
                      <span className="text-success">Available</span>
                    </>
                  )}
                  {status === "taken" && (
                    <>
                      <CircleX aria-hidden="true" className="size-4 text-destructive" />
                      <span className="text-destructive">Taken</span>
                    </>
                  )}
                </p>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="useCase"
          render={({ field }) => (
            <FormItem className="gap-3">
              <FormLabel htmlFor={undefined}>What will you use Fernway for?</FormLabel>
              <FormControl labelMode="labelledby">
                <RadioGroup ref={field.ref} name={field.name} value={field.value} onValueChange={field.onChange} className="grid gap-3 sm:grid-cols-3">
                  {USE_CASES.map((u) => {
                    const id = `use-case-${u.value}`;
                    const Icon = u.icon;
                    return (
                      <label
                        key={u.value}
                        htmlFor={id}
                        className={cn(
                          "group/card relative flex cursor-pointer flex-col gap-3 rounded-2xl border bg-card p-4 shadow-xs transition-all duration-200",
                          "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-soft",
                          "has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:shadow-glow",
                          "has-[button:focus-visible]:border-primary",
                        )}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span
                            aria-hidden="true"
                            className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-has-[[data-state=checked]]/card:bg-primary group-has-[[data-state=checked]]/card:text-primary-foreground"
                          >
                            <Icon className="size-5" />
                          </span>
                          {/* Selection follows focus (WAI-ARIA radio group). Radix only does that while the arrow key
                              is still held when its deferred focus lands, so an instant key press (automation, some
                              switch devices) would move focus without selecting. */}
                          <RadioGroupItem
                            id={id}
                            value={u.value}
                            aria-labelledby={`${id}-label`}
                            aria-describedby={`${id}-description`}
                            onFocus={() => {
                              if (field.value !== u.value) field.onChange(u.value);
                            }}
                          />
                        </span>
                        <span className="grid gap-1">
                          <span id={`${id}-label`} className="font-semibold text-foreground">
                            {u.label}
                          </span>
                          <span id={`${id}-description`} className="text-sm text-muted-foreground">
                            {u.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormErrorSummary />

        <div className="flex justify-end border-t pt-5">
          <Button type="submit" size="lg" className="group w-full sm:w-auto" loading={form.formState.isSubmitting}>
            Continue
            {!form.formState.isSubmitting && <ArrowRight aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />}
          </Button>
        </div>
      </form>
    </Form>
  );
}
