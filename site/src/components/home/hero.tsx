import { CodeXml, Monitor, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import { ArrowIcon, ButtonLink, GitHubIcon } from "@/components/button-link";
import { CommandCopy } from "@/components/command-copy";
import { Icon } from "@/components/icon";
import { site } from "@/lib/site";
import { Container } from "@/components/layout";
import { screens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import houndMark from "../../../public/brand/hound-mark-light.png";
import { links } from "./data";
import { Steps } from "./steps";

const chips = [
  { label: "Open source, MIT", icon: CodeXml },
  { label: "Runs locally", icon: Monitor },
  { label: "Optional AI, your own model", icon: Sparkles },
  { label: "No evidence, no finding", icon: ShieldCheck },
];

// The screenshot spans the container: 1136 px from xl, the viewport minus the gutters below that.
const shotSizes =
  "(min-width: 1280px) 1136px, (min-width: 1024px) calc(100vw - 144px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

/**
 * Homepage hero: the pitch, centred over the hound, then a real screenshot of a run on Kennel, tilted back
 * in perspective on larger screens. Same order at every width, so nothing has to squeeze side by side.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden">
      {/* Decorative backdrop: a soft mint glow and the hound mark, very faint, centred behind the hero (hidden on small screens). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_45%_at_50%_20%,rgba(94,230,163,0.09),transparent_70%)]"
      />
      {/* On desktop the mark is the largest image in view at first paint (the LCP), so it loads at once and first;
          phones, where it is hidden, fetch only the smallest file (1px). */}
      <Image
        src={houndMark}
        alt=""
        aria-hidden="true"
        loading="eager"
        fetchPriority="high"
        sizes="(min-width: 1024px) 980px, (min-width: 768px) 760px, 1px"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 hidden h-auto w-[760px] max-w-none -translate-x-1/2 select-none opacity-[0.06] md:block lg:-top-16 lg:w-[980px] lg:opacity-[0.1]"
      />

      <Container className="flex flex-col items-center gap-12 pb-14 pt-12 sm:pt-16 lg:gap-16 lg:pb-20 lg:pt-20">
        <div className="flex max-w-4xl flex-col items-center gap-7 text-center">
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[12px] tracking-[0.18em] sm:text-[13px]">
            <span className="flex items-center gap-2 font-semibold text-fg">
              <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
              OPEN SOURCE
            </span>
            <span className="text-dim max-sm:hidden" aria-hidden="true">
              ·
            </span>
            {/* Each part stays on one line with its separator; on a phone the parts wrap as balanced lines, never one
                word alone and never a line that starts with a separator. */}
            <span className="text-balance text-muted">
              <span className="whitespace-nowrap">RELEASE {site.version} ·</span>{" "}
              <span className="whitespace-nowrap">SINGLE PAGE ·</span>{" "}
              <span className="whitespace-nowrap">{site.preview.toUpperCase()}</span>
            </span>
          </p>

          <h1
            id="hero-heading"
            className="text-balance font-display text-[2.6rem] font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-7xl xl:text-[5rem]"
          >
            Find the bugs your AI forgot <span className="text-accent">to test.</span>
          </h1>

          {/* The first sentence defines Run Hound on its own, so a search result or an AI answer can quote it whole; the
              second names who it's for (docs/overview.md "Who it's for"). Kept short: seven lines on desktop, as
              before the definition was added, and one more on a phone, so the calls to action barely move. */}
          <p className="max-w-2xl text-pretty text-lg leading-relaxed text-muted sm:text-xl">
            {site.name} is an open-source, AI-assisted UI testing tool for apps built with AI app builders such as
            Lovable, Bolt and v0. It&apos;s for solo developers, small teams and QA testers. Point it at a page on your
            local app: it finds the forms and controls, custom widgets and dialog forms included, plans the checks and
            runs the ones you approve in a real browser, with evidence and a Playwright test for each finding. It can
            sign in as test accounts you own, and your AI model can review the plan.
          </p>

          <div className="flex w-full flex-col items-center gap-3">
            <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <ButtonLink href={links.tryLocally} className="whitespace-nowrap">
                {site.cta}
                <ArrowIcon size={18} />
              </ButtonLink>
              <ButtonLink href={links.github} variant="secondary" className="whitespace-nowrap">
                <GitHubIcon size={18} />
                View on GitHub
              </ButtonLink>
            </div>
            <CommandCopy command={site.dockerCommand} className="mt-2 w-full max-w-3xl text-left" />
            <p className="text-sm text-dim">
              Then open <code className="font-mono text-muted">http://localhost:4000</code>. Docker or Podman, no clone
              needed.{" "}
              <a
                href="#start"
                className="text-muted underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent"
              >
                Other ways to start
              </a>
              .
            </p>
            <p className="text-sm text-dim">
              Free and open source: try it without cloning anything, and{" "}
              <a
                href={links.issues}
                className="text-muted underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent"
              >
                file an issue
              </a>{" "}
              if it gets something wrong.
            </p>
          </div>

          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-3 text-[14.5px] text-muted">
            {chips.map(({ label, icon }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon icon={icon} size={18} className="text-accent" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <figure className="w-full min-w-0 [perspective:2400px]">
          {/* Preloaded only on tall screens 1024 px and wider, where it is above the fold (its top edge is at about
              980 px) and can be the largest paint. On phones and laptops it starts below the fold, and lazy loading
              fetches it as soon as it nears the viewport. */}
          <Screenshot
            screen={screens.liveRun}
            sizes={shotSizes}
            preloadMedia="(min-width: 1024px) and (min-height: 1100px)"
            // Phones: just the run column (progress, scenarios, the running one's steps), readable at that width.
            phoneCrop={{ left: 258, top: 8, width: 536, height: 980 }}
            className="lg:origin-bottom lg:[transform:rotateX(9deg)]"
          />
          <figcaption className="mt-4 text-center font-mono text-[11px] tracking-widest text-dim">
            REAL SCREENSHOT · A RUN ON KENNEL, OUR DELIBERATELY BROKEN DEMO APP
          </figcaption>
        </figure>
      </Container>

      <Steps />
    </section>
  );
}
