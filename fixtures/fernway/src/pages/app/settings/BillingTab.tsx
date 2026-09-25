import { ArrowUpRight, CircleCheck, CreditCard, Receipt, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/sonner";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";

const SEAT_PRICE = 29;
const SEATS = 8;

/** The trial ends 12 days from today (the sidebar's "12 days left"). */
function trialEnd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 12);
  return formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
}

const USAGE = [
  { label: "Projects", used: 6, limit: 20, unit: "" },
  { label: "Seats", used: SEATS, limit: 10, unit: "" },
  { label: "File storage", used: 3.2, limit: 50, unit: " GB" },
] as const;

const INVOICES = [
  { id: "INV-2026-009", date: "2026-09-01", amount: 232, status: "Paid" },
  { id: "INV-2026-008", date: "2026-08-01", amount: 203, status: "Paid" },
  { id: "INV-2026-007", date: "2026-07-01", amount: 203, status: "Paid" },
] as const;

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/**
 * The Billing tab: the current plan with usage, "Change plan" (a link to /#pricing) and "Cancel subscription", which
 * asks in a Radix AlertDialog first (destructive: Run Hound never clicks it by default). The demo workspace keeps
 * billing on the client: cancelling only schedules the end of the plan, and "Resume subscription" undoes it.
 */
export function BillingTab() {
  const endDate = trialEnd();
  const [cancelled, setCancelled] = useState(false);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState("");

  const cancel = () => {
    setCancelled(true);
    setStatus(`Subscription cancelled. Your Studio plan stays active until ${endDate}.`);
    toast.success("Subscription cancelled", { description: `Your Studio plan stays active until ${endDate}.` });
  };
  const resume = () => {
    setCancelled(false);
    setStatus("Subscription resumed. Nothing changes on your next invoice.");
    toast.success("Subscription resumed");
    requestAnimationFrame(() => cancelRef.current?.focus());
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <Card className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-linear-to-br from-primary/25 via-brand-via/20 to-brand-to/20 blur-3xl" />
          <CardHeader>
            <CardDescription>Current plan</CardDescription>
            <CardTitle as="h2" className="flex flex-wrap items-center gap-2 text-2xl">
              <Sparkles aria-hidden="true" className="size-5 text-primary" />
              Studio plan
              <Badge variant={cancelled ? "warning" : "success"}>{cancelled ? "Cancels soon" : "Trial"}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              <span className="text-2xl font-semibold text-foreground">${SEAT_PRICE}</span> per seat a month ·{" "}
              {cancelled ? `ends on ${endDate}` : `trial ends on ${endDate}, then ${money(SEAT_PRICE * SEATS)} a month for ${SEATS} seats`}
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5">
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {USAGE.map((u) => {
                const pct = Math.round((u.used / u.limit) * 100);
                return (
                  <li key={u.label} className="grid gap-2 rounded-xl border bg-card/70 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{u.label}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {u.used}
                        {u.unit} of {u.limit}
                        {u.unit}
                      </span>
                    </div>
                    <Progress value={pct} aria-label={`${u.label} used`} className={cn(pct >= 80 && "[&>[data-slot=progress-indicator]]:from-warning [&>[data-slot=progress-indicator]]:to-warning")} />
                  </li>
                );
              })}
            </ul>
            <p role="status" className={cn("flex items-center gap-1.5 text-sm font-medium", cancelled ? "text-warning" : "text-success", !status && "sr-only")}>
              {status && <CircleCheck aria-hidden="true" className="size-4 shrink-0" />}
              {status}
            </p>
          </CardContent>
          <CardFooter className="flex-wrap gap-3 border-t pt-6">
            <Button asChild>
              <Link to="/#pricing">
                Change plan
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
            {cancelled ? (
              <Button ref={resumeRef} type="button" variant="outline" onClick={resume}>
                Resume subscription
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button ref={cancelRef} type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                    Cancel subscription
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  onCloseAutoFocus={(e) => {
                    // After confirming, the trigger is gone: move focus to "Resume subscription".
                    if (!resumeRef.current) return;
                    e.preventDefault();
                    resumeRef.current.focus();
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your Studio plan stays active until {endDate}. After that the workspace moves to the Free plan: 3 projects
                      and 2 seats. You can resume any time before then.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                    <AlertDialogAction onClick={cancel}>Cancel subscription</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2 text-lg">
              <Receipt aria-hidden="true" className="size-5 text-primary" />
              Invoices
            </CardTitle>
            <CardDescription>Sent to the billing contact on the 1st of each month.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table containerLabel="Invoices table">
              <TableCaption className="text-left">The last 3 invoices, newest first.</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Invoice</TableHead>
                  <TableHead scope="col">Date</TableHead>
                  <TableHead scope="col" className="text-right">
                    Amount
                  </TableHead>
                  <TableHead scope="col">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {INVOICES.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium whitespace-nowrap">{inv.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(inv.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(inv.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="success">
                        <CircleCheck aria-hidden="true" />
                        {inv.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2 text-lg">
            <CreditCard aria-hidden="true" className="size-5 text-primary" />
            Payment method
          </CardTitle>
          <CardDescription>Charged at the end of the trial.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-slate-800 via-slate-900 to-emerald-950 p-5 text-white shadow-soft">
            <div aria-hidden="true" className="absolute -right-8 -bottom-10 size-32 rounded-full bg-emerald-400/20 blur-2xl" />
            <p className="text-xs tracking-widest text-slate-200 uppercase">Visa</p>
            <p className="mt-6 font-mono text-lg tracking-wider">•••• •••• •••• 4242</p>
            <div className="mt-4 flex justify-between text-xs text-slate-200">
              <span>Alex Rivera</span>
              <span>Expires 08/28</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Billing contact: billing@fernway.test</p>
        </CardContent>
      </Card>
    </div>
  );
}
