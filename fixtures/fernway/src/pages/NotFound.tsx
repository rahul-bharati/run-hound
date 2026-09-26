import { ArrowRight, Compass, CreditCard, House, LayoutDashboard, UserPlus } from "lucide-react";
import { Link, useLocation } from "react-router";
import { MarketingFooter } from "@/components/site/MarketingFooter";
import { MarketingHeader } from "@/components/site/MarketingHeader";
import { Button } from "@/components/ui/button";
import { images } from "@/lib/images";
import { useDocumentTitle } from "@/lib/utils";

const DESTINATIONS = [
  { to: { pathname: "/", hash: "#features" }, icon: Compass, title: "Tour the product", text: "Timelines, workloads and client digests." },
  { to: { pathname: "/", hash: "#pricing" }, icon: CreditCard, title: "Compare plans", text: "Free for small teams, fair as you grow." },
  { to: "/signup", icon: UserPlus, title: "Create an account", text: "Start a 14-day Studio trial." },
];

const cardLink =
  "group flex h-full items-start gap-3 rounded-2xl border bg-card/90 p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Any unknown path: the server answers it with 404 and this view. */
export default function NotFound() {
  useDocumentTitle("Page not found");
  const { pathname } = useLocation();
  const art = images.emptyState;
  return (
    <div className="bg-mesh flex min-h-dvh flex-col">
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-10 px-4 py-16 text-center outline-hidden sm:py-20">
        <div className="relative animate-slide-up">
          <div aria-hidden="true" className="absolute -inset-3 -z-10 rounded-[2.5rem] sm:-inset-6 bg-linear-to-br from-primary/20 via-brand-via/10 to-brand-to/20 blur-2xl" />
          <div className="rounded-3xl bg-white p-4 shadow-soft ring-1 ring-border sm:p-6 dark:bg-slate-200">
            <img src={art.src} alt="" width={art.width} height={art.height} className="h-auto w-56 max-w-full mix-blend-multiply sm:w-80" />
          </div>
          <span
            aria-hidden="true"
            className="absolute -top-4 -right-2 rotate-6 sm:-right-4 rounded-2xl bg-linear-to-br from-primary to-brand-via px-3 py-1.5 font-mono text-lg font-bold text-primary-foreground shadow-glow"
          >
            404
          </span>
        </div>

        <div className="flex max-w-xl flex-col items-center gap-4">
          <p className="text-sm font-semibold tracking-wide text-primary uppercase">Error 404</p>
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">Page not found</h1>
          <p className="text-lg text-muted-foreground">
            We couldn't find <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] break-all text-foreground">{pathname}</code>. It may
            have moved, or the link may be out of date.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="rounded-full">
              <Link to="/">
                <House aria-hidden="true" />
                Back to home
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full">
              <Link to="/app">
                <LayoutDashboard aria-hidden="true" />
                Open the dashboard
              </Link>
            </Button>
          </div>
        </div>

        <nav aria-label="Popular pages" className="w-full">
          <ul className="grid gap-3 sm:grid-cols-3">
            {DESTINATIONS.map((d) => (
              <li key={d.title}>
                <Link to={d.to} className={cardLink}>
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <d.icon className="size-4" />
                  </span>
                  <span className="grid gap-0.5">
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                      {d.title}
                      <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="text-sm text-muted-foreground">{d.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <MarketingFooter />
    </div>
  );
}
