import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./SectionHeading";

interface Plan {
  name: string;
  blurb: string;
  monthly: number;
  yearly: number;
  cta: string;
  features: string[];
  popular?: boolean;
}

/** Per-seat prices in dollars; yearly is the monthly equivalent when billed once a year (about 20% off). */
export const PLANS: Plan[] = [
  {
    name: "Starter",
    blurb: "For freelancers and duos getting organised.",
    monthly: 0,
    yearly: 0,
    cta: "Start for free",
    features: ["Up to 2 people", "3 active projects", "Board and timeline views", "Email support"],
  },
  {
    name: "Studio",
    blurb: "For growing studios juggling several clients.",
    monthly: 24,
    yearly: 19,
    cta: "Start Studio trial",
    popular: true,
    features: ["Unlimited projects", "Workload planning", "Client portals", "Time tracking and reports", "Priority support"],
  },
  {
    name: "Agency",
    blurb: "For multi-team agencies with bigger budgets.",
    monthly: 59,
    yearly: 47,
    cta: "Start Agency trial",
    features: ["Everything in Studio", "Multiple teams and budgets", "Single sign-on (SSO)", "Advanced permissions", "A dedicated success manager"],
  },
];

const BILLING_ID = "billing-yearly";

/** Pricing (id="pricing"): three plans; the "Bill yearly" Radix Switch changes the prices shown. */
export function Pricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="relative scroll-mt-20 border-y border-border/70 bg-card/40">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <SectionHeading id="pricing-heading" eyebrow="Pricing" title="Simple pricing that grows with you">
          Start free, then pay per seat as your studio grows. Every paid plan starts with a 14-day trial.
        </SectionHeading>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Switch id={BILLING_ID} checked={yearly} onCheckedChange={setYearly} />
          <Label htmlFor={BILLING_ID} className="cursor-pointer text-base">
            Bill yearly
          </Label>
          <Badge variant="success">Save 20%</Badge>
        </div>

        <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const price = yearly ? plan.yearly : plan.monthly;
            const free = plan.monthly === 0;
            return (
              <article
                key={plan.name}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-card p-6 shadow-soft sm:p-8",
                  plan.popular && "border-primary/60 shadow-glow ring-1 ring-primary/40 lg:-my-3 lg:py-11",
                )}
              >
                {plan.popular && (
                  <Badge className="absolute -top-3 left-6 gap-1 px-3 py-1 shadow-soft">
                    <Sparkles aria-hidden="true" />
                    Most popular
                  </Badge>
                )}
                <h3 className="text-lg font-semibold tracking-tight">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.blurb}</p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span data-price className="text-5xl font-bold tracking-tight tabular-nums">
                    ${price}
                  </span>
                  <span className="text-sm text-muted-foreground">{free ? "free forever" : "per seat / month"}</span>
                </p>
                <p className="mt-1 h-5 text-sm text-muted-foreground">
                  {free ? "No credit card needed" : yearly ? `$${plan.yearly * 12} per seat, billed yearly` : "billed monthly"}
                </p>
                <Button asChild variant={plan.popular ? "default" : "outline"} size="lg" className="mt-8 w-full">
                  <Link to="/signup">{plan.cta}</Link>
                </Button>
                <ul className="mt-8 space-y-3 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
