import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { images } from "@/lib/images";

/**
 * Split screen for /signup and /login (CONTRACT.md): the form column on the left, the art (images.authArt) with
 * floating cards on the right from md up. The art column is a top-level <aside> named by `asideLabel`.
 */
export function AuthLayout({ children, aside, asideLabel }: { children: ReactNode; aside: ReactNode; asideLabel: string }) {
  const art = images.authArt;
  return (
    <div className="bg-mesh min-h-dvh md:grid md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Logo to="/" />
          <ThemeToggle />
        </header>
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col items-center justify-center px-4 pt-2 pb-10 outline-hidden sm:px-8">
          <div className="w-full max-w-md animate-slide-up">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-5 text-sm text-muted-foreground sm:px-8">
          <p>© {new Date().getFullYear()} Fernway Labs</p>
          <p className="inline-flex items-center gap-1.5">
            <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
            Demo app: no real accounts or payments
          </p>
        </footer>
      </div>

      <aside aria-label={asideLabel} className="relative hidden min-w-0 p-3 md:block">
        <div className="sticky top-3 isolate flex h-[calc(100dvh-1.5rem)] min-h-[40rem] flex-col overflow-hidden rounded-[2rem] shadow-soft ring-1 ring-border/60">
          <img src={art.src} alt={art.alt} width={art.width} height={art.height} className="absolute inset-0 -z-20 size-full object-cover" />
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-linear-to-t from-slate-950/50 via-slate-950/0 to-slate-950/10 dark:from-slate-950/80 dark:via-slate-950/35 dark:to-slate-950/40"
          />
          <div aria-hidden="true" className="absolute -top-28 -right-20 -z-10 size-80 animate-float rounded-full bg-primary/25 blur-3xl" />
          <div className="flex flex-1 flex-col justify-between gap-6 p-6 lg:p-10">{aside}</div>
        </div>
      </aside>
    </div>
  );
}

/** A frosted card for the art column (solid enough that text on it keeps AA contrast). */
export const artCard = "rounded-2xl bg-card/92 text-card-foreground shadow-xl ring-1 ring-border/60 backdrop-blur-md";
