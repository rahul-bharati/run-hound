import type { ReactNode } from "react";
import { Band, SectionHeading } from "@/components/primitives/layout";
import { ArrowLink } from "@/components/primitives/links";
import { kennelEvidence } from "@/content/hero-run";
import { bandIndex, home } from "@/content/home";

/**
 * The pipeline (DESIGN.md §3.1 block 2, §4.3): five steps on a dashed line-strong track, each a numbered ring and an h3.
 * The finished state is the server's: every ring lit (a 28 px bg disc with a 1.5 px accent ring and an fg number) and
 * the accent line drawn along the track. The scroll runtime (src/motion/effects/pipeline.ts) scrubs it from ring 1:
 * the four connectors are CSS lines scaled from their node (across from 1024 px, down below), never SVG with a typed
 * length, and the step words never move. The line is a 1.5 px border, not a fill, so it stays below the accent budget's
 * "strong" threshold (§2.3).
 */
export function Pipeline() {
  const steps = home.how.steps;
  return (
    <ol className="hm-pipeline" data-motion="pipeline">
      {steps.map((step, i) => (
        <li key={step.name}>
          <span className="hm-node" aria-hidden="true">
            <i data-part="node-ring" />
            {i + 1}
          </span>
          {i < steps.length - 1 ? (
            <span className="hm-track" aria-hidden="true">
              <i data-part="connector" />
            </span>
          ) : null}
          <h3>{step.name}</h3>
          <p>{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * One finding, three kinds of proof (§3.1 block 2): the page (a real crop of the evidence frame, passed in as `crop`,
 * since it is a static image import), the requests and the test, inside one outline. The request card and the test
 * excerpt are HTML pictures, aria-hidden, each with one sr-only sentence; the captions carry the facts and never move.
 * The scroll runtime's one-shot effect (effects/evidence-trio.ts) raises the three pictures, draws the accent outline,
 * then hands over to the line-strong outline, which is what the server renders at rest (the accent outline rests
 * hidden by class).
 */
export function EvidenceTrio({ crop }: { crop: ReactNode }) {
  const { proof } = home.how;
  const { requests, test } = kennelEvidence;
  return (
    <div className="hm-trio" data-motion="evidence-trio">
      <svg className="hm-outline" aria-hidden="true">
        <rect data-part="outline-rest" x="0.75" y="0.75" rx="16" />
        <rect className="rest-hidden" data-part="outline-accent" x="0.75" y="0.75" rx="16" />
      </svg>
      <figure className="hm-proof hm-proof-page">
        <div className="hm-media hm-crop" data-part="media">
          {crop}
        </div>
        <figcaption className="figure-caption">{proof.page.caption}</figcaption>
      </figure>
      <figure className="hm-proof">
        <div className="hm-media hm-reqs" data-part="media" aria-hidden="true">
          <b>{requests.title}</b>
          {requests.rows.map((row) => (
            <p key={row.n}>
              <span>{row.n}</span>
              <span>{row.at}</span>
              <b>{row.status}</b>
            </p>
          ))}
        </div>
        <p className="sr-only">{proof.requests.srOnly}</p>
        <figcaption className="figure-caption">{proof.requests.caption}</figcaption>
      </figure>
      <figure className="hm-proof">
        <div className="hm-media hm-code" data-part="media" aria-hidden="true">
          <p>
            {test.filename}
            <span>{test.language}</span>
          </p>
          <pre>{test.lines.join("\n")}</pre>
        </div>
        <p className="sr-only">{proof.test.srOnly}</p>
        <figcaption className="figure-caption">{proof.test.caption}</figcaption>
      </figure>
    </div>
  );
}

/** Block 2, "How it works: nothing runs until you approve" (#see-it-run), on the tinted band. */
export function HowItWorks({ crop }: { crop: ReactNode }) {
  const how = home.how;
  return (
    <Band id={how.id} index={bandIndex("how")} tone="band" labelledBy={`${how.id}-title`}>
      <SectionHeading id={`${how.id}-title`} title={how.title} />
      <Pipeline />
      <h3 className="hm-proof-title">{how.proof.title}</h3>
      <EvidenceTrio crop={crop} />
      <p className="hm-links">
        {how.links.map((link) => (
          <ArrowLink key={link.href} href={link.href}>
            {link.label}
          </ArrowLink>
        ))}
      </p>
    </Band>
  );
}
