import { CodeXml, Monitor, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import { ArrowIcon, ButtonLink, ComingSoonBadge, GitHubIcon } from "@/components/button-link";
import { Icon } from "@/components/icon";
import { site } from "@/lib/site";
import { Container } from "@/components/layout";
import { screens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import houndMark from "../../../public/brand/hound-mark-light.png";
import { links } from "./data";
import { Steps } from "./steps";

const chips = [
  { label: "Open source", icon: CodeXml },
  { label: "Runs locally", icon: Monitor },
  { label: "AI planning", icon: Sparkles, soon: true },
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
      <Image
        src={houndMark}
        alt=""
        aria-hidden="true"
        sizes="(min-width: 1024px) 980px, 760px"
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
            <span className="text-muted">
              {site.release} TESTER PREVIEW ({site.version})
            </span>
          </p>

          <h1
            id="hero-heading"
            className="text-balance font-display text-[2.6rem] font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-7xl xl:text-[5rem]"
          >
            Find the bugs your AI forgot <span className="text-accent">to test.</span>
          </h1>

          <p className="max-w-2xl text-pretty text-lg leading-relaxed text-muted sm:text-xl">
            AI-assisted UI testing for AI-built apps. Point Run Hound at a page on your local app: it finds every form
            and control, plans the checks, and after you approve, runs them in a real browser and reports what broke,
            with annotated evidence and a Playwright test for each finding. AI planning and explanations are coming
            soon.
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
            <p className="text-sm text-dim">
              Invite-only preview:{" "}
              <a
                href={links.requestAccess}
                className="text-muted underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent"
              >
                ask for access
              </a>
              .
            </p>
          </div>

          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-3 text-[14.5px] text-muted">
            {chips.map(({ label, icon, soon }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon icon={icon} size={18} className="text-accent" />
                {label}
                {soon ? <ComingSoonBadge /> : null}
              </li>
            ))}
          </ul>
        </div>

        <figure className="w-full min-w-0 [perspective:2400px]">
          <Screenshot
            screen={screens.liveRun}
            preload
            sizes={shotSizes}
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
