import type { ReactNode } from "react";
import { CheckCards } from "@/components/home/checks-band";
import { HeroRunFigure } from "@/components/home/hero-run-figure";
import { EvidenceTrio, Pipeline } from "@/components/home/how-it-works";
import { TrailFigure } from "@/components/not-found/trail-figure";
import { ui } from "@/content/ui";
import { cardTraceAt, cardTraceStoryboard } from "@/motion/effects/card-trace";
import { evidenceTrioAt, evidenceTrioStoryboard } from "@/motion/effects/evidence-trio";
import { heroRunStoryboard } from "@/motion/hero-run-storyboard";
import { type Storyboard, storyboardEnd } from "@/motion/storyboard";
import { cssTokens } from "@/motion/tokens";
import { trail404Storyboard } from "@/motion/trail-404-storyboard";

/**
 * The site's motion moments on /_design/ (DESIGN.md §3.14, §4.3), each drawn by the component its page uses, so what
 * moves here is what moves there, and each with its own Replay:
 * - the hero run keeps the Replay its island shows once the run rests (data-part="replay-slot");
 * - the pipeline has a range input that sets its progress, and a Replay that plays it through once;
 * - the evidence trio, the check cards' trace and the 404's trail each have a Replay button.
 *
 * Everything is the server's finished frame until motion is allowed; design-motion.tsx then mounts the hero's and the
 * 404's islands (they play when half visible, as on their pages) and wires the controls. Each Replay is rendered here,
 * hidden with the class `invisible` so its room is kept, and shown only when motion is allowed: under reduced motion or
 * Save-Data there is nothing to replay, and the note says so.
 *
 * The durations shown are each storyboard's end at tokens.css's values (src/motion/storyboard.ts storyboardEnd), and
 * the trigger points the effects' own (evidenceTrioAt, cardTraceAt): nothing is typed twice.
 */
const tokens = cssTokens();
const end = (board: Storyboard) => Math.round(storyboardEnd(board, tokens) * 100) / 100;
const percent = (share: number) => `${Math.round(share * 100)}%`;

export type Moment = {
  name: "hero-run" | "pipeline" | "evidence-trio" | "card-trace" | "trail-404";
  /** The heading's id. */
  id: string;
  title: string;
  /** Where it plays on the site, and what starts it. */
  where: string;
  /** Its length in seconds; the pipeline has none (scroll drives it). */
  seconds?: number;
  source: string;
};

export const moments: readonly Moment[] = [
  {
    name: "hero-run",
    id: "motion-hero-run",
    title: "Hero run",
    where: "Homepage. Plays once when half visible; a press or a key inside it skips to the end.",
    seconds: end(heroRunStoryboard),
    source: "src/motion/hero-run-storyboard.ts",
  },
  {
    name: "pipeline",
    id: "motion-pipeline",
    title: "Pipeline",
    where: "Homepage, How it works. Scroll drives it there, the page's one ScrollTrigger; here the range does.",
    source: "src/motion/effects/pipeline.ts",
  },
  {
    name: "evidence-trio",
    id: "motion-evidence-trio",
    title: "Evidence trio",
    where: `Homepage, How it works. Plays once when its top reaches ${percent(evidenceTrioAt)} of the viewport.`,
    seconds: end(evidenceTrioStoryboard),
    source: "src/motion/effects/evidence-trio.ts",
  },
  {
    name: "card-trace",
    id: "motion-card-trace",
    title: "Check cards",
    where: `Homepage, the checks band. Plays once when its top reaches ${percent(cardTraceAt)} of the viewport.`,
    seconds: end(cardTraceStoryboard),
    source: "src/motion/effects/card-trace.ts",
  },
  {
    name: "trail-404",
    id: "motion-trail-404",
    title: "404 trail",
    where: "The 404. Plays once when half visible.",
    seconds: end(trail404Storyboard),
    source: "src/motion/trail-404-storyboard.ts",
  },
];

/** A reserved Replay button (shown by design-motion.tsx when motion is allowed); its name says which moment. */
function Replay({ moment }: { moment: Moment }) {
  return (
    <button type="button" className="dz-replay invisible" data-dz-replay={moment.name}>
      {ui.replay}
      <span className="sr-only"> {moment.title.toLowerCase()}</span>
    </button>
  );
}

function PipelineRange() {
  return (
    <span className="dz-range">
      <label htmlFor="dz-pipeline-progress" className="text-small text-muted">
        Progress
      </label>
      <input id="dz-pipeline-progress" type="range" min={0} max={100} step={1} defaultValue={100} data-dz-range="pipeline" />
    </span>
  );
}

const figures: Record<Moment["name"], (crop: ReactNode) => ReactNode> = {
  "hero-run": () => (
    <div className="dz-stage-hero">
      <HeroRunFigure />
    </div>
  ),
  pipeline: () => <Pipeline />,
  "evidence-trio": (crop) => <EvidenceTrio crop={crop} />,
  "card-trace": () => <CheckCards />,
  "trail-404": () => (
    <div className="dz-stage-trail">
      <TrailFigure />
    </div>
  ),
};

/** The five moments. `crop` is the evidence trio's page picture (a static image import, as app/page.tsx passes it). */
export function MotionMoments({ crop }: { crop: ReactNode }) {
  return (
    <div className="dz-moments">
      <p className="dz-reduced-note text-body text-muted">
        This browser asks for reduced motion, so each moment shows its finished frame and there is nothing to replay.
      </p>
      {moments.map((moment) => (
        <div key={moment.name} className="dz-moment">
          <div className="dz-moment-head">
            <h3 id={moment.id} className="text-title text-fg">
              {moment.title}
            </h3>
            <p className="text-small text-muted">
              {moment.where}
              {moment.seconds !== undefined ? ` Ends at ${moment.seconds} s.` : ""}{" "}
              <code className="font-mono text-code">{moment.source}</code>
            </p>
          </div>
          {figures[moment.name](crop)}
          {moment.name === "hero-run" ? null : (
            <div className="dz-controls">
              {moment.name === "pipeline" ? <PipelineRange /> : null}
              <Replay moment={moment} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
