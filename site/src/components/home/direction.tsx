import Image from "next/image";
import { Container } from "@/components/layout";

const concepts = [
  {
    src: "/home/direction-live-run.webp",
    alt: "Concept mockup of a future run view: a step list with progress, elapsed time and browser, a browser preview of a sign-up form on a placeholder app called Acme, and a timestamped live activity log.",
    title: "A run you can follow step by step",
    text: "Each scenario broken into the actions it takes, with a live activity log beside the browser.",
  },
  {
    src: "/home/direction-report.webp",
    alt: "Concept mockup of a future report: a list of test results with thumbnails, a selected issue with an annotated screenshot, reproduction steps, key facts and the generated Playwright test.",
    title: "A report that reads like a bug ticket",
    text: "Results with thumbnails, reproduction steps, key facts and the Playwright test side by side.",
  },
];

/** Design direction for later versions, shown from the brand mockups. Clearly not V0. */
export function Direction() {
  return (
    <section aria-labelledby="direction-heading" className="border-y border-line-soft bg-band py-14 sm:py-20">
      <Container className="flex flex-col gap-10">
        <div className="flex max-w-3xl flex-col gap-4">
          <p className="inline-flex items-center gap-2 self-start rounded-full border border-warn/40 px-3 py-1.5 font-mono text-[11px] tracking-widest text-warn">
            DESIGN DIRECTION, NOT THE CURRENT V0
          </p>
          <h2 id="direction-heading" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Where it&apos;s heading
          </h2>
          <p className="text-lg leading-relaxed text-muted">
            Concepts for later versions, to show where the interface is going. They are not screenshots:
            V0 does not have these screens yet, and the app, names and numbers in them are placeholders.
          </p>
        </div>
        <ul className="grid gap-6 md:grid-cols-2">
          {concepts.map((c) => (
            <li key={c.src}>
              <figure className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="relative border-b border-line bg-bg-deep">
                  <Image src={c.src} alt={c.alt} width={1400} height={1050} unoptimized className="h-auto w-full" />
                  <span className="absolute left-3 top-3 rounded-full bg-bg-deep/85 px-2.5 py-1 font-mono text-[10px] tracking-widest text-warn backdrop-blur">
                    CONCEPT
                  </span>
                </div>
                <figcaption className="flex flex-col gap-1.5 p-5">
                  <span className="font-display text-lg font-bold leading-snug">{c.title}</span>
                  <span className="text-[15px] leading-relaxed text-muted">{c.text}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
