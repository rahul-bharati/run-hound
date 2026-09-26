import { CircleCheck, Sparkles, Star } from "lucide-react";
import { images } from "@/lib/images";
import { DemoDialog } from "./DemoDialog";
import { WAITLIST_HEADING_ID, WaitlistForm } from "./WaitlistForm";

const STACK = [images.avatars[1], images.avatars[3], images.avatars[4], images.avatars[6]];

/** Decorative app UI floating over the hero art (hidden from assistive tech; the art's alt describes the image). */
function FloatingCards() {
  return (
    <div aria-hidden="true">
      <div className="absolute top-14 -left-6 hidden w-56 animate-float rounded-2xl border bg-card/95 p-4 shadow-xl backdrop-blur sm:block lg:-left-10">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-foreground">Brand refresh</span>
          <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">On track</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[72%] rounded-full bg-linear-to-r from-primary via-brand-via to-brand-to" />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>72% complete</span>
          <span>Due Nov 14</span>
        </div>
      </div>

      <div className="absolute -right-4 bottom-8 hidden w-60 animate-float rounded-2xl border bg-card/95 p-4 shadow-xl backdrop-blur [animation-delay:-4.5s] sm:block lg:-right-8">
        <p className="text-xs font-semibold text-foreground">Due today</p>
        <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
          {["Homepage wireframes", "Client review call", "Invoice #1042"].map((task, i) => (
            <li key={task} className="flex items-center gap-2">
              <CircleCheck className={i === 0 ? "size-4 text-success" : "size-4 text-muted-foreground"} />
              <span className={i === 0 ? "text-muted-foreground line-through" : "text-foreground"}>{task}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex -space-x-2">
          {STACK.slice(0, 3).map((avatar) => (
            <img key={avatar!.src} src={avatar!.src} alt="" width={24} height={24} className="size-6 rounded-full object-cover ring-2 ring-card" />
          ))}
        </div>
      </div>

      <div className="absolute -top-4 right-8 hidden items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur md:flex">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        3 teammates online
      </div>
    </div>
  );
}

/** Hero: headline, the Waitlist form in a glass card, "Book a demo", social proof and the framed hero art. */
export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-x-clip">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12 lg:px-8 lg:pt-20 lg:pb-24">
        <div className="animate-slide-up">
          <p className="inline-flex max-w-full items-center gap-2 rounded-full border bg-card/80 py-1 pr-3 pl-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
              <Sparkles aria-hidden="true" className="size-3" />
              New
            </span>
            <span className="truncate">Client portals are here</span>
          </p>
          <h1 id="hero-heading" className="mt-5 text-4xl leading-[1.08] font-bold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl">
            Plan every project <span className="text-gradient">without the chaos</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
            Fernway gives small studios one calm place for timelines, workloads and client updates. Plan in minutes, spot overloaded
            teammates early and keep every client in the loop.
          </p>

          <div className="mt-8 max-w-xl rounded-2xl border bg-card/85 p-5 shadow-soft backdrop-blur-xl sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div>
                <h2 id={WAITLIST_HEADING_ID} className="text-lg font-semibold tracking-tight">
                  Join the waitlist
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Early teams get the Studio plan free for three months.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                Invites go out weekly
              </span>
            </div>
            <div className="mt-5">
              <WaitlistForm />
            </div>
          </div>

          <div className="mt-6 flex max-w-xl flex-wrap items-start gap-x-6 gap-y-4">
            <DemoDialog />
            <div className="flex items-center gap-3 pt-1">
              <div className="flex -space-x-2">
                {STACK.map((avatar) => (
                  <img key={avatar!.src} src={avatar!.src} alt="" width={36} height={36} className="size-9 rounded-full object-cover ring-2 ring-background" />
                ))}
              </div>
              <div className="text-sm">
                <div aria-hidden="true" className="flex items-center gap-0.5 text-warning">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star key={i} className="size-3.5 fill-current" />
                  ))}
                </div>
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground">4.9 out of 5</span> from 300+ studios
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-2xl animate-fade-in lg:max-w-none">
          <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-linear-to-tr from-primary/30 via-brand-via/20 to-brand-to/30 opacity-70 blur-3xl" />
          <figure className="relative rounded-3xl border bg-card/90 p-2 shadow-2xl backdrop-blur">
            <div aria-hidden="true" className="flex items-center gap-1.5 px-3 pt-1 pb-2.5">
              <span className="size-2.5 rounded-full bg-red-400/80" />
              <span className="size-2.5 rounded-full bg-amber-400/80" />
              <span className="size-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-3 truncate rounded-md bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">fernway.app/studio/brand-refresh</span>
            </div>
            <img
              src={images.heroArt.src}
              alt={images.heroArt.alt}
              width={images.heroArt.width}
              height={images.heroArt.height}
              fetchPriority="high"
              className="aspect-[16/10] w-full rounded-2xl object-cover dark:brightness-[.85]"
            />
          </figure>
          <FloatingCards />
        </div>
      </div>
    </section>
  );
}
