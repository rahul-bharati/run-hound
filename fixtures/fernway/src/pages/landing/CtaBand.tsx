import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { LogoMark } from "@/components/Logo";

const ring = "outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

/** Closing call to action: a dark panel with a brand glow (the same in light and dark mode). */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-heading" className="px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
      <div className="relative isolate mx-auto max-w-7xl overflow-hidden rounded-3xl bg-slate-950 px-6 py-14 text-center shadow-2xl ring-1 ring-white/10 ring-inset sm:px-12 sm:py-20">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(40rem_20rem_at_20%_0%,oklch(0.596_0.145_163.225/0.45),transparent_70%),radial-gradient(36rem_22rem_at_90%_100%,oklch(0.588_0.158_241.966/0.4),transparent_70%)]"
        />
        <div aria-hidden="true" className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <LogoMark className="mx-auto size-12 rounded-[28%] shadow-glow" />
        <h2 id="cta-heading" className="mx-auto mt-6 max-w-2xl text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">
          Ready to calm the chaos?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">
          Set up your studio in five minutes. Bring your team, your clients and your spreadsheets.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className={`inline-flex h-11 items-center gap-2 rounded-xl bg-white px-6 text-base font-semibold text-slate-950 shadow-lg transition-colors hover:bg-emerald-50 ${ring}`}
          >
            Create your free account
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            to={{ pathname: "/", hash: "#pricing" }}
            className={`inline-flex h-11 items-center rounded-xl border border-white/25 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10 ${ring}`}
          >
            Compare plans
          </Link>
        </div>
      </div>
    </section>
  );
}
