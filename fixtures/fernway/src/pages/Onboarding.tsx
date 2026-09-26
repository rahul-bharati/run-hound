import { useCallback, useState } from "react";
import { Link, useLocation } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { getSession, refreshSession } from "@/lib/session";
import { useDocumentTitle } from "@/lib/utils";
import { firstName } from "./auth/schemas";
import { Done } from "./onboarding/Done";
import { inviteList, type CreatedWorkspace, type InvitesValues, type WorkspaceValues } from "./onboarding/schema";
import { SidePanel } from "./onboarding/SidePanel";
import { Stepper } from "./onboarding/Stepper";
import { StepInvites } from "./onboarding/StepInvites";
import { StepReview } from "./onboarding/StepReview";
import { StepWorkspace } from "./onboarding/StepWorkspace";

type Step = 0 | 1 | 2;

const EMPTY_WORKSPACE: WorkspaceValues = { workspaceName: "", slug: "", useCase: "client" };
const EMPTY_INVITES: InvitesValues["invites"] = [{ email: "" }];

/**
 * /onboarding: a three-step wizard (CONTRACT.md "/onboarding Wizard"). Each step is one <form>; the wizard keeps
 * every step's values, so Back never loses anything. Finish setup posts everything to /api/onboarding.
 */
export default function Onboarding() {
  useDocumentTitle("Set up your workspace");
  const location = useLocation();
  const welcome = typeof (location.state as { welcome?: unknown } | null)?.welcome === "string" ? (location.state as { welcome: string }).welcome : null;

  const [step, setStep] = useState<Step>(0);
  const [moved, setMoved] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceValues>(EMPTY_WORKSPACE);
  const [preview, setPreview] = useState<WorkspaceValues>(EMPTY_WORKSPACE);
  const [slugEdited, setSlugEdited] = useState(false);
  const [invites, setInvites] = useState<InvitesValues["invites"]>(EMPTY_INVITES);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedWorkspace | null>(null);

  const go = (next: Step) => {
    setMoved(true);
    setStep(next);
  };
  const onDraft = useCallback((values: WorkspaceValues) => setPreview(values), []);

  function finished(result: CreatedWorkspace) {
    // Signed in (e.g. straight after sign-up), the server renamed your workspace: pick up the new name. A signed-out
    // visitor never asks (/api/me would only answer 401).
    if (getSession().status === "signed-in") void refreshSession();
    toast.success("Workspace created", {
      description: `${result.workspaceName} is ready.${result.invites.length > 0 ? " Invites are on their way." : ""}`,
    });
    setCreated(result);
  }

  let content;
  if (created) {
    content = <Done created={created} />;
  } else if (step === 0) {
    content = (
      <StepWorkspace
        initial={workspace}
        slugEdited={slugEdited}
        onSlugEdited={setSlugEdited}
        serverSlugError={slugError}
        focusOnMount={moved}
        onDraft={onDraft}
        onNext={(values) => {
          setWorkspace(values);
          setSlugError(null);
          go(1);
        }}
      />
    );
  } else if (step === 1) {
    content = (
      <StepInvites
        initial={invites}
        focusOnMount={moved}
        onBack={(values) => {
          setInvites(values);
          go(0);
        }}
        onSkip={() => {
          setInvites(EMPTY_INVITES);
          go(2);
        }}
        onNext={(values) => {
          setInvites(values.length > 0 ? values : EMPTY_INVITES);
          go(2);
        }}
      />
    );
  } else {
    content = (
      <StepReview
        workspace={workspace}
        invites={inviteList(invites)}
        focusOnMount={moved}
        onBack={() => go(1)}
        onDone={finished}
        onSlugTaken={(message) => {
          setSlugError(message);
          go(0);
        }}
      />
    );
  }

  return (
    <div className="bg-mesh flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Logo to="/" />
        <div className="flex items-center gap-1.5">
          {!created && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/app">Skip for now</Link>
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-10 px-4 pt-4 pb-16 outline-hidden sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]"
      >
        <div className="flex min-w-0 animate-slide-up flex-col gap-6">
          {welcome && (
            <Alert variant="success">
              <AlertTitle>Account created</AlertTitle>
              <AlertDescription>Welcome, {firstName(welcome)}! Three quick steps and your studio is ready.</AlertDescription>
            </Alert>
          )}
          <div>
            <p className="text-sm font-semibold text-primary">Welcome to Fernway</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-balance sm:text-4xl">Set up your workspace</h1>
            <p className="mt-2 max-w-xl text-muted-foreground">Three quick steps: name it, bring your team, and you're ready to plan.</p>
          </div>
          <Stepper current={step} finished={created !== null} />
          <div className="rounded-3xl border bg-card/95 p-5 shadow-soft backdrop-blur-sm sm:p-8">{content}</div>
        </div>
        <SidePanel preview={preview} />
      </main>
    </div>
  );
}
