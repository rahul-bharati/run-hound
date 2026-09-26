import { ChevronLeft, ChevronRight, Quote, Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { images, type ImageAsset } from "@/lib/images";
import { SectionHeading } from "./SectionHeading";

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  avatar: ImageAsset;
}

// Fictional customers. The portraits are the generated avatars (public/images/README.md); the names shown here are
// the customers', so the images are decorative (alt="") next to them.
const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "We used to plan in three spreadsheets and a group chat. Fernway put everything on one timeline, and our Monday meeting went from an hour to fifteen minutes.",
    name: "Rafael Mendes",
    role: "Founder, Paper Crane Studio",
    avatar: images.avatars[0]!,
  },
  {
    quote: "The workload view is the feature I didn't know I needed. I see who is stretched before a deadline slips, not after.",
    name: "Anika Rao",
    role: "Design lead, Northwind",
    avatar: images.avatars[1]!,
  },
  {
    quote: "Client portals replaced our weekly status emails. Clients check progress themselves, and our inboxes are finally quiet.",
    name: "Daniel Park",
    role: "Engineering manager, Quarry",
    avatar: images.avatars[2]!,
  },
  {
    quote: "Setting up took one afternoon. Importing our old projects from CSV just worked, and the whole team was planning in Fernway the next day.",
    name: "Nia Thompson",
    role: "Producer, Brightside Media",
    avatar: images.avatars[3]!,
  },
  {
    quote: "We bill by the hour, so knowing where the time goes matters. Budgets and time tracking in one place keep every project honest.",
    name: "Samuel Adeyemi",
    role: "Managing partner, Oakline Architects",
    avatar: images.avatars[4]!,
  },
  {
    quote: "It's calm. That's the best word for it. Fewer pings, clearer priorities, and nobody asking what's due this week.",
    name: "Ingrid Holm",
    role: "Studio director, Lumen & Co",
    avatar: images.avatars[5]!,
  },
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Testimonials carousel (APG carousel pattern, no auto-advance): one slide shown at a time, the others aria-hidden
 * and inert; "Previous testimonial" / "Next testimonial" wrap around.
 */
export function Testimonials() {
  const [index, setIndex] = useState(0);
  const count = TESTIMONIALS.length;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  return (
    <section aria-labelledby="testimonials-heading" className="scroll-mt-20">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:px-8 lg:py-28">
        <div>
          <SectionHeading id="testimonials-heading" eyebrow="Customers" title="Loved by small studios" align="left">
            Design studios, agencies and architects use Fernway to keep projects calm and clients happy.
          </SectionHeading>
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <div aria-hidden="true" className="flex gap-0.5 text-warning">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="size-4 fill-current" />
                ))}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">4.9 out of 5</span> average rating
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight">1,200+</p>
              <p className="text-sm text-muted-foreground">studios planning with Fernway</p>
            </div>
          </div>
        </div>

        <div role="region" aria-roledescription="carousel" aria-label="Testimonials" className="relative">
          <div aria-hidden="true" className="absolute -inset-4 -z-10 rounded-[2rem] bg-linear-to-br from-primary/15 via-transparent to-brand-to/15 blur-2xl" />
          <div className="overflow-hidden rounded-3xl border bg-card shadow-xl">
            <div aria-live="polite" className="flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${index * 100}%)` }}>
              {TESTIMONIALS.map((t, i) => {
                const current = i === index;
                return (
                  // The slide is a group wrapping the <figure>: a figure with a figcaption may not take role="group".
                  <div
                    key={t.name}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`${i + 1} of ${count}`}
                    aria-hidden={current ? undefined : true}
                    inert={!current}
                    className="w-full shrink-0"
                  >
                    <figure className="flex h-full flex-col p-6 sm:p-10">
                      <Quote aria-hidden="true" className="size-9 text-primary/70" />
                      <blockquote className="mt-4 flex-1 text-lg leading-relaxed font-medium text-pretty text-foreground sm:text-xl">
                        <p>“{t.quote}”</p>
                      </blockquote>
                      <figcaption className="mt-8 flex items-center gap-4">
                        <img src={t.avatar.src} alt="" width={56} height={56} className="size-14 rounded-full object-cover ring-4 ring-accent" />
                        <span>
                          <span className="block font-semibold text-foreground">{t.name}</span>
                          <span className="block text-sm text-muted-foreground">{t.role}</span>
                        </span>
                      </figcaption>
                    </figure>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between gap-4">
            <p aria-hidden="true" className="font-medium text-muted-foreground tabular-nums">
              <span className="text-foreground">{pad(index + 1)}</span> / {pad(count)}
            </p>
            <div aria-hidden="true" className="hidden h-1 flex-1 overflow-hidden rounded-full bg-muted sm:block">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${((index + 1) / count) * 100}%` }} />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => go(-1)}>
                <ChevronLeft aria-hidden="true" className="size-5" />
                <span className="sr-only">Previous testimonial</span>
              </Button>
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={() => go(1)}>
                <ChevronRight aria-hidden="true" className="size-5" />
                <span className="sr-only">Next testimonial</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
