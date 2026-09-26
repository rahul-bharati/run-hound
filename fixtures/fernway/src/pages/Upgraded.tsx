import { ArrowLeft, CircleCheck, Crown, Info, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AppShell } from "@/components/app/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiPost, isApiError, type UpgradeConfirmation } from "@/lib/api";
import { useSessionUser } from "@/lib/session";
import { useDocumentTitle } from "@/lib/utils";

type State = { status: "loading" } | { status: "ready"; result: UpgradeConfirmation } | { status: "error"; message: string };

/**
 * /app/upgraded (CONTRACT.md "Billing"): where the local test checkout lands after paying, as
 * /app/upgraded?checkout=<id>. On load it asks the server to confirm that checkout (POST /api/billing/confirm); the
 * server grants Pro only for a checkout of this account that it recorded as paid, so opening this page by hand (or
 * with someone else's checkout id) changes nothing. V09 breaks exactly that on the server: the page's request alone
 * grants Pro.
 */
export default function Upgraded() {
  useDocumentTitle("Upgrade");
  const user = useSessionUser();
  const [params] = useSearchParams();
  const checkout = params.get("checkout");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const asked = useRef(-1);

  useEffect(() => {
    // One confirmation per attempt, even when React runs the effect twice.
    if (asked.current === attempt) return;
    asked.current = attempt;
    setState({ status: "loading" });
    apiPost<UpgradeConfirmation>("/api/billing/confirm", { checkout }).then(
      (result) => setState({ status: "ready", result }),
      (err: unknown) => setState({ status: "error", message: isApiError(err) ? err.message : "We couldn't check your payment." }),
    );
  }, [attempt, checkout]);

  const confirmed = state.status === "ready" && state.result.confirmed;
  const plan = state.status === "ready" ? (state.result.plan === "pro" ? "Pro" : "Free") : "";

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:gap-8">
        <div>
          <p className="text-sm font-medium text-primary">{user.workspace}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Your upgrade</h1>
          <p className="mt-2 text-muted-foreground">Fernway checks every payment with the server before it changes your plan.</p>
        </div>

        {state.status === "loading" && (
          <>
            <p role="status" className="sr-only">
              Checking your payment…
            </p>
            <Skeleton className="h-56 max-w-2xl rounded-2xl" />
          </>
        )}

        {state.status === "error" && (
          <Alert variant="destructive" className="max-w-2xl">
            <AlertTitle>We couldn't check your payment</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
            <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </Alert>
        )}

        {state.status === "ready" && (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardDescription>Your account</CardDescription>
              <CardTitle as="h2" className="flex items-center gap-2 text-2xl">
                {confirmed ? <Crown aria-hidden="true" className="size-5 text-primary" /> : <Info aria-hidden="true" className="size-5 text-primary" />}
                {confirmed ? "Pro is active" : "No payment to confirm"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p role="status" className="flex items-start gap-2 text-sm leading-6">
                {confirmed && <CircleCheck aria-hidden="true" className="mt-1 size-4 shrink-0 text-success" />}
                {confirmed
                  ? "Thanks! Your payment went through and your account is on the Pro plan."
                  : `We couldn't find a completed payment for this upgrade, so nothing changed: your account is on the ${plan} plan.`}
              </p>
            </CardContent>
            <CardFooter className="border-t pt-6">
              <Button asChild variant="outline">
                <Link to="/app/settings#billing">
                  <ArrowLeft aria-hidden="true" />
                  Back to billing
                </Link>
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
