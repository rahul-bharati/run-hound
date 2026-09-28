import type { ReactNode } from "react";
import Image from "next/image";
import { evidence, type EvidenceShot } from "@/components/evidence";
import { aiBuiltScreens, v2Screens, type Screen } from "@/components/screens";
import { ArrowLink } from "@/components/primitives/links";
import { Figure } from "@/components/primitives/figure";
import { aboutCheck, checkPageLink, type DemoFigure, type DemoFinding } from "@/content/demo";
import { resolveTarget } from "@/lib/nav";
import { cx } from "@/components/primitives/class-names";
import { EvidenceFigure, halfSizes } from "./evidence-figure";
import { PreloadPicture } from "./preload-picture";
import { Recording } from "./recording";

const screenGroups = { aiBuiltScreens, v2Screens } as const;

/** Where a "pair" of pictures sits side by side (lg:grid-cols-2 below): the second is above the fold there only. */
const pairMedia = "(min-width: 1024px)";

/**
 * A window (DESIGN.md §2.4: a 28 px title bar with three dots, and a mono address when `label` names one), drawn on
 * the server. The web UI screenshots here have no phone crop and no tour to prefetch for, so /demo/ doesn't need
 * components/screenshot.tsx's client code (the page's initial JavaScript is at its budget, §5.2); their markup is the
 * same.
 */
function Window({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="win">
      <div aria-hidden="true" className="win-bar">
        <span className="win-dot" />
        <span className="win-dot" />
        <span className="win-dot" />
        {label ? <span className="win-address min-w-0 truncate">{label}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * One of a finding's pictures: an evidence image from the report (a recording shows its still first, then plays once
 * in view), or a web UI screenshot (lazy, with its blur placeholder, as components/screenshot.tsx draws one), in its
 * window. `preloadMedia` ("all", or the screens where an evidence picture is above the fold) preloads the image that
 * paints first, a recording's still (./preload-picture.tsx), so the page's largest paint is a picture that is already
 * there. ./recording.tsx and components/evidence-image.tsx both render it as <Image src sizes quality={90}>: the
 * srcset preloaded.
 */
export function DemoPicture({ figure, check, sizes = halfSizes, preloadMedia }: { figure: DemoFigure; check?: string; sizes?: string; preloadMedia?: string }) {
  const label = check ? `${check} · ${figure.label}` : figure.label;
  if ("evidence" in figure.picture) {
    const shot: EvidenceShot = evidence[figure.picture.evidence];
    const still = shot.still && shot.src.src.split("?", 1)[0].endsWith(".gif") ? shot.still : undefined;
    return (
      <>
        {preloadMedia ? <PreloadPicture src={still ?? shot.src} sizes={sizes} media={preloadMedia} /> : null}
        {still ? (
          // A recording: its proof frame's still first, the GIF once it is in view (./recording.tsx).
          <Figure caption={figure.caption} reveal>
            <Window label={label}>
              <Recording gif={shot.src} still={still} alt={shot.alt} sizes={sizes} />
            </Window>
          </Figure>
        ) : (
          <EvidenceFigure shot={shot} label={label} caption={figure.caption} sizes={sizes} />
        )}
      </>
    );
  }
  const { group, key } = figure.picture.screen;
  const screens: Record<string, Screen> = screenGroups[group];
  const screen = screens[key];
  return (
    <Figure caption={figure.caption} reveal>
      <Window>
        <Image src={screen.src} alt={screen.alt} sizes={sizes} quality={90} placeholder="blur" className="block h-auto w-full" />
      </Window>
    </Figure>
  );
}

/**
 * A finding on /demo/ (DESIGN.md §3.12): its evidence, then "About this check →" to its check's page (its card on
 * /checks/ until the page exists). The element carries the check id (#double-submit), unless the section already does
 * (`id` false). The link's name ends with the check id for screen readers, so the page's links can be told apart.
 * `layout` lays the pictures out ("pair": side by side from 1024 px); `aside` goes beside a single picture. `lead`: the
 * finding opens the page, above the fold: its first picture is preloaded on every screen, a pair's second where the
 * two sit side by side (DemoPicture).
 */
export function DemoFindingBlock({
  finding,
  id = true,
  layout = "stack",
  sizes,
  aside,
  lead = false,
  className,
}: {
  finding: DemoFinding;
  id?: boolean;
  layout?: "stack" | "pair";
  sizes?: string;
  aside?: ReactNode;
  lead?: boolean;
  className?: string;
}) {
  const preloadMedia = (i: number) => (!lead ? undefined : i === 0 ? "all" : layout === "pair" && i === 1 ? pairMedia : undefined);
  const pictures = finding.figures.map((figure, i) => (
    <DemoPicture key={figure.caption} figure={figure} check={finding.check} sizes={sizes} preloadMedia={preloadMedia(i)} />
  ));
  return (
    <div id={id ? finding.check : undefined} className={cx("flex min-w-0 flex-col gap-4", className)}>
      {layout === "pair" ? <div className="grid items-start gap-6 lg:grid-cols-2 xl:gap-8">{pictures}</div> : pictures}
      {aside}
      <p>
        <ArrowLink href={resolveTarget(checkPageLink(finding.check))} prefetch="intent" className="inline-flex min-h-target-row items-center">
          {aboutCheck}
          <span className="sr-only">: {finding.check}</span>
        </ArrowLink>
      </p>
    </div>
  );
}
