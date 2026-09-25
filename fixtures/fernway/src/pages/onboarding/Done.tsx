import { ArrowRight, PartyPopper } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { CreatedWorkspace } from "./schema";
import { StepHeader } from "./StepHeader";

/** The success view after Finish setup: an inline role="status" confirmation and the way to the dashboard. */
export function Done({ created }: { created: CreatedWorkspace }) {
  const invited = created.invites.length;
  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center">
      <div className="relative">
        <div aria-hidden="true" className="absolute inset-0 scale-150 rounded-full bg-primary/25 blur-2xl" />
        <span aria-hidden="true" className="relative grid size-16 animate-scale-in place-items-center rounded-2xl bg-linear-to-br from-primary to-brand-via text-primary-foreground shadow-glow">
          <PartyPopper className="size-8" />
        </span>
      </div>
      <div className="flex max-w-md flex-col items-center gap-2 [&>div]:items-center">
        <StepHeader id="step-done-title" title="Your workspace is ready" description="Everything is set up. Your first project is one click away." focusOnMount />
        <p role="status" className="mt-2 rounded-xl border border-success/30 bg-accent px-4 py-2 text-sm font-medium break-words text-accent-foreground">
          {created.workspaceName} is ready at {created.url}.
        </p>
        <p className="text-sm text-muted-foreground">
          {invited > 0
            ? `We've sent ${invited === 1 ? "1 invite" : `${invited} invites`}. Teammates can join as soon as they accept.`
            : "You can invite your team any time from Settings."}
        </p>
      </div>
      <Button asChild size="lg" className="group rounded-full px-6">
        <Link to="/app">
          Go to your dashboard
          <ArrowRight aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Button>
    </div>
  );
}
