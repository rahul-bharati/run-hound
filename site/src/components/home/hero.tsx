import Image from "next/image";
import { ButtonLink } from "@/components/button-link";
import { Container } from "@/components/layout";
import { ProductWindow } from "@/components/product-window";
import { links } from "./data";
import { ArrowIcon, ChecklistIcon, CodeIcon, GitHubIcon, MonitorIcon, ShieldIcon } from "./icons";
import { Steps } from "./steps";

const chips = [
  { label: "Open source", Icon: CodeIcon },
  { label: "Runs locally", Icon: MonitorIcon },
  { label: "Deterministic checks", Icon: ChecklistIcon },
  { label: "No evidence, no finding", Icon: ShieldIcon },
];

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden">
      {/* Decorative backdrop: a soft mint glow and the hound mark, very faint. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_75%_30%,rgba(94,230,163,0.09),transparent_70%)]"
      />
      <Image
        src="/brand/hound-mark-light.png"
        alt=""
        aria-hidden="true"
        width={640}
        height={368}
        unoptimized
        className="pointer-events-none absolute -right-40 top-0 -z-10 h-auto w-[620px] max-w-none select-none opacity-[0.05] sm:w-[820px] sm:opacity-[0.07] lg:-right-6 lg:-top-28 lg:w-[1000px] lg:opacity-[0.12]"
      />

      <Container className="grid items-center gap-12 pb-14 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10 lg:pb-20 lg:pt-20">
        <div className="flex min-w-0 flex-col gap-7">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] tracking-[0.18em] sm:text-[13px]">
            <span className="flex items-center gap-2 font-semibold text-fg">
              <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
              OPEN SOURCE
            </span>
            <span className="text-dim max-sm:hidden" aria-hidden="true">
              ·
            </span>
            <span className="text-muted">V0 TESTER PREVIEW (0.1.0)</span>
          </p>

          <h1
            id="hero-heading"
            className="font-display text-[2.6rem] font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-6xl xl:text-[5rem]"
          >
            Find the bugs your AI forgot <span className="text-accent">to test.</span>
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
            Point Run Hound at a form on your local app. It plans a set of checks, you approve them, it runs them
            in a real browser and reports what broke, with annotated evidence and a Playwright test for each
            finding.
          </p>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <ButtonLink href={links.tryLocally}>
                Try V0 Locally
                <ArrowIcon size={18} />
              </ButtonLink>
              <ButtonLink href={links.github} variant="secondary">
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

          <ul className="flex flex-wrap gap-x-5 gap-y-3 text-[14.5px] text-muted">
            {chips.map(({ label, Icon }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon size={18} className="text-accent" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 lg:-mr-16 xl:-mr-28">
          <ProductWindow tilt />
          <p className="mt-4 font-mono text-[11px] tracking-widest text-dim lg:text-right">
            V0 ON KENNEL, OUR DELIBERATELY BROKEN DEMO APP
          </p>
        </div>
      </Container>

      <Steps />
    </section>
  );
}
