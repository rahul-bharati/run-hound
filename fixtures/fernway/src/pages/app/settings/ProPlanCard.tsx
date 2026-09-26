import { CircleCheck, Crown, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { apiGet, apiPost, isApiError, profilePath, upgradedPath, type Checkout, type Profile } from "@/lib/api";
import { useSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useLoad } from "../data";

const errorMessage = (err: unknown) => (isApiError(err) ? err.message : "Something went wrong on our side. Please try again.");

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

/**
 * The account's plan (CONTRACT.md "Billing"): `plan` from the profile record (GET /api/users/<me.id>/profile), which
 * only the server changes. On Free: "Upgrade to Pro" starts the local test checkout (POST /api/billing/checkout) and
 * shows it in a dialog; "Pay" there (POST /api/billing/checkout/:id/pay, test mode) then opens the success page
 * /app/upgraded?checkout=<id>, which asks the server to confirm the payment. "Already paid? Refresh your plan" opens
 * /app/upgraded without a checkout. On Pro: "Switch back to Free" (POST /api/billing/cancel).
 */
export function ProPlanCard() {
  const user = useSessionUser();
  const { state, reload, setData } = useLoad((signal) => apiGet<Profile>(profilePath(user.id), { signal }));
  const navigate = useNavigate();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState<"" | "start" | "pay" | "free">("");
  const [error, setError] = useState("");
  const [payError, setPayError] = useState("");
  const [status, setStatus] = useState("");
  const inFlight = useRef(false);

  /** Runs one billing request at a time (a double click sends it once). */
  const run = async (what: "start" | "pay" | "free", fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(what);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };

  const startUpgrade = () =>
    run("start", async () => {
      setError("");
      setStatus("");
      setPayError("");
      try {
        setCheckout(await apiPost<Checkout>("/api/billing/checkout", { plan: "pro" }));
      } catch (err) {
        setError(errorMessage(err));
        toast.error("Couldn't start the upgrade", { description: errorMessage(err) });
      }
    });

  const pay = () =>
    run("pay", async () => {
      if (!checkout) return;
      setPayError("");
      try {
        const paid = await apiPost<Checkout>(`/api/billing/checkout/${encodeURIComponent(checkout.id)}/pay`);
        void navigate(upgradedPath(paid.id));
      } catch (err) {
        setPayError(errorMessage(err));
        toast.error("Payment didn't go through", { description: errorMessage(err) });
      }
    });

  const switchToFree = () =>
    run("free", async () => {
      setError("");
      setStatus("");
      try {
        const { plan } = await apiPost<{ plan: string }>("/api/billing/cancel");
        setData((p) => ({ ...p, plan }));
        setStatus("You're back on the Free plan.");
        toast.success("Switched to Free");
      } catch (err) {
        setError(errorMessage(err));
        toast.error("Plan not changed", { description: errorMessage(err) });
      }
    });

  if (state.status === "loading") return <Skeleton className="h-56 rounded-2xl" />;
  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't load your plan</AlertTitle>
        <AlertDescription>{state.error}</AlertDescription>
        <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={reload}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </Alert>
    );
  }

  const pro = state.data.plan === "pro";
  return (
    <Card>
      <CardHeader>
        <CardDescription>Your account</CardDescription>
        <CardTitle as="h2" className="flex flex-wrap items-center gap-2 text-2xl">
          <Crown aria-hidden="true" className="size-5 text-primary" />
          {pro ? "Pro plan" : "Free plan"}
          <Badge variant={pro ? "success" : "secondary"}>{pro ? "Active" : "Current"}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {pro
            ? "Unlimited projects, client portals and priority support are on for your account."
            : "Pro adds unlimited projects, client portals and priority support for $12 a month."}
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{pro ? "Plan not changed" : "Couldn't start the upgrade"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p role="status" className={cn("flex items-center gap-1.5 text-sm font-medium text-success", !status && "sr-only")}>
          {status && <CircleCheck aria-hidden="true" className="size-4 shrink-0" />}
          {status}
        </p>
      </CardContent>
      <CardFooter className="flex-wrap items-center gap-3 border-t pt-6">
        {pro ? (
          <Button type="button" variant="outline" loading={busy === "free"} onClick={() => void switchToFree()}>
            Switch back to Free
          </Button>
        ) : (
          <>
            <Button type="button" loading={busy === "start"} onClick={() => void startUpgrade()}>
              Upgrade to Pro
            </Button>
            <Link
              to={upgradedPath()}
              className="rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden"
            >
              Already paid? Refresh your plan
            </Link>
          </>
        )}
      </CardFooter>

      <Dialog open={checkout !== null} onOpenChange={(open) => !open && busy !== "pay" && setCheckout(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test checkout</DialogTitle>
            <DialogDescription>Fernway's local test checkout: no card is needed and nothing is charged.</DialogDescription>
          </DialogHeader>
          {checkout && (
            <div className="flex items-baseline justify-between gap-4 rounded-xl border bg-muted/40 p-4">
              <span className="font-medium">Fernway Pro, monthly</span>
              <span className="text-lg font-semibold tabular-nums">{money(checkout.amount, checkout.currency)}</span>
            </div>
          )}
          {payError && (
            <Alert variant="destructive">
              <AlertTitle>Payment didn't go through</AlertTitle>
              <AlertDescription>{payError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy === "pay"}>
                Not now
              </Button>
            </DialogClose>
            <Button type="button" loading={busy === "pay"} onClick={() => void pay()}>
              Pay {checkout ? money(checkout.amount, checkout.currency) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
