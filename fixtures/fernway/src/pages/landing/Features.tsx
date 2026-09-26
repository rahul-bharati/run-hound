import { ArrowRight, Blocks, ChartGantt, MessagesSquare, Users, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { images, type ImageAsset } from "@/lib/images";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./SectionHeading";

function BentoCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft transition-shadow duration-300 hover:shadow-xl",
        className,
      )}
    >
      {children}
    </article>
  );
}

function FeatureImage({ image, className }: { image: ImageAsset; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl bg-accent", className)}>
      <img
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        className="aspect-[4/3] size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] dark:brightness-[.85]"
      />
    </div>
  );
}

function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground ring-1 ring-primary/15">
      {children}
    </span>
  );
}

const WORKLOAD = [
  { name: "Priya", load: 92, avatar: images.avatars[1] },
  { name: "Marcus", load: 64, avatar: images.avatars[2] },
  { name: "Sofia", load: 48, avatar: images.avatars[3] },
  { name: "Jonah", load: 30, avatar: images.avatars[4] },
];

/** Bento grid of features (id="features"), using images.features[0..2]. */
export function Features() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <SectionHeading id="features-heading" eyebrow="Features" title="Everything your studio needs, nothing it doesn't">
          From the first kickoff to the final invoice, Fernway keeps plans, people and clients in step without another meeting.
        </SectionHeading>

        <div className="mt-14 grid gap-4 md:grid-cols-6 lg:gap-5">
          <BentoCard className="md:col-span-4 md:grid md:grid-cols-[1fr_1.1fr] md:items-center">
            <div className="p-6 sm:p-8">
              <IconBadge>
                <Blocks className="size-5" />
              </IconBadge>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">Plan in minutes, not meetings</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Drag work onto a board, set owners and dates, and Fernway lines up the plan. Templates for launches, rebrands and
                retainers get you started in one click.
              </p>
              <ul className="mt-5 flex flex-wrap gap-2 text-xs font-medium">
                {["Boards", "Templates", "Dependencies"].map((chip) => (
                  <li key={chip} className="rounded-full border bg-background px-2.5 py-1 text-muted-foreground">
                    {chip}
                  </li>
                ))}
              </ul>
            </div>
            <FeatureImage image={images.features[0]} className="m-3 mt-0 md:m-3" />
          </BentoCard>

          <BentoCard className="md:col-span-2">
            <FeatureImage image={images.features[2]} className="m-3 mb-0" />
            <div className="p-6">
              <h3 className="text-lg font-semibold tracking-tight">Insights at a glance</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Budgets, burn and progress for every project, updated as your team works.
              </p>
            </div>
          </BentoCard>

          <BentoCard className="p-6 md:col-span-2">
            <IconBadge>
              <Users className="size-5" />
            </IconBadge>
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Workload you can see</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Spot who is stretched before a deadline slips.</p>
            <ul aria-hidden="true" className="mt-5 space-y-3">
              {WORKLOAD.map((person) => (
                <li key={person.name} className="flex items-center gap-3 text-xs">
                  <img src={person.avatar!.src} alt="" width={28} height={28} className="size-7 rounded-full object-cover" />
                  <span className="w-12 shrink-0 font-medium text-foreground">{person.name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", person.load > 85 ? "bg-warning" : "bg-primary")}
                      style={{ width: `${person.load}%` }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right text-muted-foreground tabular-nums">{person.load}%</span>
                </li>
              ))}
            </ul>
          </BentoCard>

          <BentoCard className="md:col-span-4 md:grid md:grid-cols-[1.1fr_1fr] md:items-center">
            <FeatureImage image={images.features[1]} className="order-last m-3 mt-0 md:order-first md:m-3" />
            <div className="p-6 sm:p-8">
              <IconBadge>
                <ChartGantt className="size-5" />
              </IconBadge>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">Timelines that adapt</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Move one milestone and everything that depends on it moves too. Share a live timeline with clients instead of
                rebuilding slides every Friday.
              </p>
              <dl className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-xl border bg-background p-3">
                  <dt className="text-xs text-muted-foreground">Planning time</dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight">−68%</dd>
                </div>
                <div className="rounded-xl border bg-background p-3">
                  <dt className="text-xs text-muted-foreground">On-time delivery</dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight">94%</dd>
                </div>
              </dl>
            </div>
          </BentoCard>

          <BentoCard className="p-6 sm:p-8 md:col-span-3">
            <IconBadge>
              <MessagesSquare className="size-5" />
            </IconBadge>
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Client portals</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Give each client a private page with their timeline, files and approvals. No more status emails.
            </p>
            <div aria-hidden="true" className="mt-5 flex items-center gap-3 rounded-xl border bg-background p-3 text-xs">
              <span className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-primary to-brand-to font-semibold text-primary-foreground">
                AC
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">Acme rebrand · client view</span>
                <span className="block truncate text-muted-foreground">fernway.app/p/acme-rebrand</span>
              </span>
              <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">Shared</span>
            </div>
          </BentoCard>

          <BentoCard className="p-6 sm:p-8 md:col-span-3">
            <IconBadge>
              <Zap className="size-5" />
            </IconBadge>
            <h3 className="mt-5 text-lg font-semibold tracking-tight">Automations that do the chasing</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Reminders, hand-offs and client updates run themselves, so your team can stay in the work.
            </p>
            <ul aria-hidden="true" className="mt-5 space-y-2 text-xs">
              {[
                ["Task marked done", "Notify the client"],
                ["Budget reaches 80%", "Alert the project lead"],
              ].map(([when, then]) => (
                <li key={when} className="flex flex-wrap items-center gap-2 rounded-xl border bg-background px-3 py-2">
                  <span className="font-medium text-foreground">{when}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{then}</span>
                </li>
              ))}
            </ul>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}
