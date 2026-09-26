/**
 * The floating cards over the auth art. Product previews are illustrations (aria-hidden, nothing focusable); the
 * testimonials are real content in <figure>/<blockquote>.
 */
import { CalendarCheck, CircleCheck, Circle, Sparkles, Star, TrendingUp } from "lucide-react";
import { images } from "@/lib/images";
import { cn } from "@/lib/utils";
import { artCard } from "./AuthLayout";

function AvatarStack({ indexes, size = "size-8" }: { indexes: number[]; size?: string }) {
  return (
    <div className="flex shrink-0 -space-x-2">
      {indexes.map((i) => {
        const a = images.avatars[i]!;
        return <img key={i} src={a.src} alt="" width={a.width} height={a.height} className={cn(size, "rounded-full object-cover ring-2 ring-card")} />;
      })}
    </div>
  );
}

function Stars() {
  return (
    <div role="img" aria-label="Rated 5 out of 5" className="flex gap-0.5 text-warning">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} aria-hidden="true" className="size-4 fill-current" />
      ))}
    </div>
  );
}

function Testimonial({ quote, name, role, avatar }: { quote: string; name: string; role: string; avatar: number }) {
  const a = images.avatars[avatar]!;
  return (
    <figure className={cn(artCard, "max-w-lg p-6")}>
      <Stars />
      <blockquote className="mt-3 text-lg leading-relaxed font-medium text-balance">“{quote}”</blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <img src={a.src} alt="" width={a.width} height={a.height} className="size-10 rounded-full object-cover" />
        <div>
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-sm text-muted-foreground">{role}</p>
        </div>
      </figcaption>
    </figure>
  );
}

export function SignupArt() {
  return (
    <>
      <div className={cn(artCard, "flex items-center gap-3 self-start rounded-full py-1.5 pr-4 pl-1.5")}>
        <AvatarStack indexes={[1, 2, 4, 7]} />
        <p className="text-sm font-medium">Loved by 1,200+ small studios</p>
      </div>

      <div aria-hidden="true" className="relative flex flex-1 items-center justify-center">
        <div className={cn(artCard, "absolute top-4 left-0 flex w-48 animate-float items-center gap-3 p-3 [animation-delay:-3s] lg:left-4")}>
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-accent-foreground">
            <TrendingUp className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">+18%</p>
            <p className="text-xs text-muted-foreground">shipped on time</p>
          </div>
        </div>
        <div className={cn(artCard, "w-72 max-w-full rotate-2 p-5")}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Northwind rebrand</p>
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">On track</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Due Nov 14 · 12 tasks left</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[64%] rounded-full bg-linear-to-r from-primary to-brand-via" />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <AvatarStack indexes={[1, 5, 6]} size="size-7" />
            <span className="text-xs font-medium text-muted-foreground">64% complete</span>
          </div>
        </div>
      </div>

      <Testimonial
        quote="We moved three spreadsheets and a whiteboard into Fernway in one afternoon. Clients finally know where things stand without asking."
        name="Sofia Alvarez"
        role="Project manager, Juniper & Co."
        avatar={3}
      />
    </>
  );
}

const WEEK = [
  { title: "Approve Northwind palette", done: true },
  { title: "Send Atlas sprint notes", done: true },
  { title: "Review Juniper wireframes", done: false },
];

export function LoginArt() {
  return (
    <>
      <div className={cn(artCard, "inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-sm font-medium")}>
        <Sparkles aria-hidden="true" className="size-4 text-primary" />
        New: client portals and weekly digests
      </div>

      <div aria-hidden="true" className="relative flex flex-1 items-center justify-center">
        <div className={cn(artCard, "w-80 max-w-full -rotate-1 p-5")}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">This week</p>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <CalendarCheck className="size-3.5" /> 2 of 3 done
            </span>
          </div>
          <ul className="mt-4 grid gap-3">
            {WEEK.map((t) => (
              <li key={t.title} className="flex items-center gap-2.5 text-sm">
                {t.done ? <CircleCheck className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                <span className={cn(t.done && "text-muted-foreground line-through")}>{t.title}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex h-16 items-end gap-1.5 border-b border-border pb-px">
            {[40, 65, 50, 80, 72, 95, 58].map((h, i) => (
              <span key={i} className={cn("flex-1 rounded-t-md bg-linear-to-t", i === 5 ? "from-primary to-brand-via" : "from-primary/35 to-brand-via/35")} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] font-medium text-muted-foreground">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="flex-1 text-center">
                {d}
              </span>
            ))}
          </div>
        </div>
        <div className={cn(artCard, "absolute right-0 bottom-6 flex w-52 animate-float items-center gap-3 p-3 lg:right-4")}>
          <AvatarStack indexes={[2, 4]} size="size-7" />
          <p className="text-xs font-medium">Marcus and Jonah joined Atlas mobile app</p>
        </div>
      </div>

      <Testimonial
        quote="Our Monday planning went from an hour of status updates to ten minutes of actual decisions."
        name="Marcus Chen"
        role="Engineer, Atlas Climbing"
        avatar={2}
      />
    </>
  );
}
