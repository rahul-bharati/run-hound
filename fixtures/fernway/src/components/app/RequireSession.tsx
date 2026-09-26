import { RotateCcw } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Logo } from "@/components/Logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { loadSession, loginPath, useSession } from "@/lib/session";
import { useDocumentTitle } from "@/lib/utils";

/**
 * The auth guard for /app and /app/settings (CONTRACT.md "Accounts"): asks GET /api/me, then renders the page for a
 * signed-in user, or sends a signed-out visitor to /login?next=<path> (replacing the history entry, so Back does not
 * bounce). While it asks, a quiet loading view; if the check itself fails, an alert with "Try again".
 */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();

  useEffect(() => {
    if (session.status === "unknown") void loadSession();
  }, [session.status]);

  if (session.status === "signed-in") return <Outlet />;
  if (session.status === "signed-out") return <Navigate to={loginPath(location)} replace />;
  if (session.status === "error") return <SessionProblem message={session.message} />;
  return <SessionLoading />;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-mesh flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center px-4 py-4 sm:px-6">
        <Logo to="/" />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 pb-24 text-center outline-hidden">
        {children}
      </main>
    </div>
  );
}

function SessionLoading() {
  return (
    <Frame>
      <Spinner className="size-6 text-primary" />
      <p role="status" className="text-sm text-muted-foreground">
        Opening your workspace…
      </p>
    </Frame>
  );
}

function SessionProblem({ message }: { message: string }) {
  useDocumentTitle("Something went wrong");
  return (
    <Frame>
      <h1 className="text-2xl font-bold tracking-tight">We couldn't open your workspace</h1>
      <Alert variant="destructive" className="text-left">
        <AlertTitle>Your session couldn't be checked</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button type="button" variant="outline" onClick={() => void loadSession(true)}>
        <RotateCcw aria-hidden="true" />
        Try again
      </Button>
    </Frame>
  );
}
