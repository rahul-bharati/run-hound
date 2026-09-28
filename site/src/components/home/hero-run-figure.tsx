import { Tick } from "@/components/primitives/tick";
import { heroRun } from "@/content/hero-run";
import { home } from "@/content/home";
import { ui } from "@/content/ui";

/**
 * The hero run (DESIGN.md §3.1 block 0, §4.3): the web UI testing Kennel's booking form, rendered FINISHED. That is
 * what the server sends, and what readers without JavaScript, with reduced motion or Save-Data, crawlers and
 * screenshot tools see; the motion island (src/motion/hero-run-timeline.tsx) plays the same markup from its start.
 *
 * The DOM contract (src/motion/dom-contract.ts): the root is the figure, [data-motion="hero-run"]; every moving part is
 * a data-part inside the aria-hidden window; the parts the run adds carry data-beat="late" (held until the island is
 * ready, or shown by the 3 s fallback), or sit inside one that does; the scan line and the press ring rest hidden by
 * class. The Replay slot is a real button outside the window, reserved with visibility (the class `invisible`), so
 * showing it moves nothing (CLS 0); it sits outside the caption, which stays at most 15 words.
 *
 * The window is a picture, aria-hidden like a screenshot, with a visually hidden list beside it saying what it shows.
 * It is a product figure: its status marks (the rail, the ticks, the progress bar, the EVIDENCE stamp) follow the web
 * UI's own colours and are exempt from the accent budget (§2.3, data-accent-exempt). The app under test keeps the paper
 * palette and Kennel's own orange "Book", which is a span, never a button. Every value comes from content/hero-run.ts.
 * Its inner elements are styled by position (home.css), not a class each: the markup and the RSC payload that repeats
 * it are the page's HTML weight (§2.9).
 */
export function HeroRunFigure() {
  const run = heroRun;
  const late = { "data-beat": "late" } as const;
  return (
    <figure className="hm-run" data-motion="hero-run" data-pagefind-ignore="">
      <div className="win hm-win" data-hero-window="" aria-hidden="true" data-accent-exempt="">
        <div className="win-bar">
          <span className="win-dot" />
          <span className="win-dot" />
          <span className="win-dot" />
          <span className="win-address">{run.address}</span>
          <span className="hm-win-app">{run.app}</span>
        </div>
        <div className="hm-panes">
          <div className="hm-app win-pane">
            <span className="hm-scan rest-hidden" data-part="scan" />
            <b>{run.form}</b>
            {run.fields.map((field) => (
              <p key={field.label} className="hm-field">
                <small>{field.label}</small>
                <span>{field.value}</span>
                <i data-part="chip" {...late}>
                  {field.type}
                </i>
              </p>
            ))}
            <p className="hm-buttons">
              <span>
                {run.buttons[0]}
                <i className="rest-hidden" data-part="press-ring" />
              </span>
              <span>{run.buttons[1]}</span>
            </p>
            <p className="hm-bookings">
              <small>{run.bookings}</small>
              {run.saved.map((label, i) => (
                <span key={label} data-part={`saved-${i + 1}`} {...late}>
                  <small>{run.fields[0].value}</small>
                  <b>{label}</b>
                </span>
              ))}
            </p>
          </div>
          <div className="hm-ui win-pane">
            <p className="hm-rail">
              <i />
              <i data-part="rail-line" data-progress="" {...late} />
              {run.rail.map((step, i) => (
                <span key={step}>
                  <i>{i === 0 ? <b /> : <b data-part={`node-${i + 1}`} {...late} />}</i>
                  <small>{step}</small>
                </span>
              ))}
            </p>
            <p data-part="found" {...late}>
              {`${run.labels.found} `}
              <b>{`“${run.form}”`}</b>
              {`: ${run.fieldCount} ${run.labels.fields}`}
            </p>
            <ul className="hm-plan">
              {run.plan.rows.map((row) => (
                <li key={row} data-part="plan-row" {...late}>
                  <Tick draw />
                  <span>{row}</span>
                </li>
              ))}
              {/* "+17 more" on phones, where the fourth row hides; "+16 more" from 640 px. One label, two numbers. */}
              <li data-part="plan-more" {...late}>
                +<b className="hm-phone">{run.plan.morePhone}</b>
                <b className="hm-wide">{run.plan.more}</b>
                {` ${run.labels.more}`}
              </li>
            </ul>
            <p className="hm-progress">
              <span>
                <i data-part="progress" data-progress="" {...late} />
              </span>
              {`${run.progress.done} / ${run.progress.total} · ${run.progress.seconds} s`}
            </p>
            <div className="hm-finding" data-part="finding" {...late}>
              <p>
                <i>{run.finding.severity}</i>
                <b>{run.finding.title}</b>
              </p>
              {run.finding.requests.map((request, i) => (
                <span key={request.at} className="hm-req" data-part={`request-${i + 1}`}>
                  {request.line}
                  <small>{request.at}</small>
                </span>
              ))}
              <span className="hm-spec" data-part="spec-chip">
                {run.finding.spec}
              </span>
              <span className="hm-stamp" data-part="stamp">
                {run.finding.stamp}
              </span>
            </div>
          </div>
        </div>
      </div>
      <ol className="sr-only">
        {home.hero.srOnly.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <button type="button" className="hm-replay invisible" data-part="replay-slot">
        {ui.replay}
      </button>
      <figcaption className="hm-caption">{home.hero.caption}</figcaption>
    </figure>
  );
}
