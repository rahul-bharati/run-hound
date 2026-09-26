import { ArrowLeft, Check, Globe, Rocket, UsersRound } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { apiPost } from "@/lib/api";
import { uuid } from "@/lib/utils";
import { toApiError } from "../auth/form-errors";
import { ONBOARDING_MESSAGES, SLUG_PREFIX, type CreatedWorkspace, type WorkspaceValues } from "./schema";
import { StepHeader } from "./StepHeader";
import { USE_CASES } from "./StepWorkspace";

export const FINISH_FAILED = "Couldn't finish setup";

function Row({ term, icon, children }: { term: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4 sm:px-5">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {term}
      </dt>
      <dd className="min-w-0 text-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

export interface StepReviewProps {
  workspace: WorkspaceValues;
  invites: string[];
  focusOnMount: boolean;
  onBack: () => void;
  onDone: (created: CreatedWorkspace) => void;
  /** 409 on the slug: someone took the URL meanwhile. */
  onSlugTaken: (message: string) => void;
}

/**
 * Step 3: review and Finish setup (POST /api/onboarding). One Idempotency-Key per visit to this step, so a retry
 * after a network failure cannot create the workspace twice.
 */
export function StepReview({ workspace, invites, focusOnMount, onBack, onDone, onSlugTaken }: StepReviewProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(uuid);
  const useCase = USE_CASES.find((u) => u.value === workspace.useCase);

  async function finish(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await apiPost<CreatedWorkspace>(
        "/api/onboarding",
        { workspaceName: workspace.workspaceName, slug: workspace.slug, useCase: workspace.useCase, invites },
        { idempotencyKey },
      );
      onDone(created);
    } catch (err) {
      const e = toApiError(err);
      setPending(false);
      if (e.status === 409 && e.errors.slug) {
        toast.error(FINISH_FAILED, { description: ONBOARDING_MESSAGES.slugTaken });
        onSlugTaken(e.errors.slug);
        return;
      }
      setError(e.message);
      toast.error(FINISH_FAILED, { description: e.message });
    }
  }

  return (
    <form aria-labelledby="step-review-title" onSubmit={finish} className="grid gap-6">
      <StepHeader id="step-review-title" step={3} title="Review and finish" description="Check the details below, then finish setup. You can change any of it later in Settings." focusOnMount={focusOnMount} />

      <dl className="divide-y overflow-hidden rounded-2xl border bg-muted/40">
        <Row term="Workspace" icon={<Rocket aria-hidden="true" className="size-4" />}>
          {workspace.workspaceName}
        </Row>
        <Row term="URL" icon={<Globe aria-hidden="true" className="size-4" />}>
          <span className="font-mono text-[13px]">{`${SLUG_PREFIX}${workspace.slug}`}</span>
        </Row>
        <Row term="Used for" icon={<Check aria-hidden="true" className="size-4" />}>
          {useCase?.label ?? workspace.useCase}
        </Row>
        <Row term="Teammates" icon={<UsersRound aria-hidden="true" className="size-4" />}>
          {invites.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {invites.map((email) => (
                <li key={email} className="max-w-full rounded-full border bg-card px-2.5 py-0.5 break-all">
                  {email}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">No teammates invited yet</span>
          )}
        </Row>
      </dl>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{FINISH_FAILED}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-5">
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <Button type="submit" size="lg" className="ml-auto" loading={pending}>
          Finish setup
        </Button>
      </div>
    </form>
  );
}
