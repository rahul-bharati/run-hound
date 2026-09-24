/**
 * reflow-320: load the page at 320x800 (WCAG 1.4.10 Reflow) and fail when the page scrolls
 * horizontally (scrollWidth > clientWidth + 1).
 */
import type { Check, CheckContext, DiscoveredForm, Scenario } from "../core/types.js";
import { checkResult, evalIn, FindingList, guarded, playwrightSpec, scenarioFor } from "./lib/a11y-common.js";

const VIEWPORT = { width: 320, height: 800 };

interface Measurement {
  scrollWidth: number;
  clientWidth: number;
  /** The widest elements that stick out past the right edge, for the fix hint. */
  overflowing: { selector: string; width: number; right: number }[];
}

/** Attribute put on the widest overflowing element so the evidence frame can mark exactly that element. */
const WIDEST = "data-rh-widest";

const MEASURE = `(attr) => {
  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;
  const out = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= clientWidth + 1) continue;
    const id = el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.classList[0] ? "." + el.classList[0] : "");
    out.push({ el, selector: id, width: Math.round(r.width), right: Math.round(r.right) });
  }
  out.sort((a, b) => b.width - a.width);
  if (out[0]) out[0].el.setAttribute(attr, "");
  return {
    scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
    clientWidth,
    overflowing: out.slice(0, 5).map(({ selector, width, right }) => ({ selector, width, right })),
  };
}`;

/** "N px wider than the screen" for an element wider than the viewport, else how far it sticks out. */
function overflowCallout(widest: Measurement["overflowing"][number], clientWidth: number): string {
  const wider = widest.width - clientWidth;
  return wider > 0
    ? `${widest.width} px wide: ${wider} px wider than the screen`
    : `Sticks out ${widest.right - clientWidth} px past the screen edge`;
}

export const check: Check = {
  id: "reflow-320",
  title: "Page fits a narrow (320 px) screen",
  category: "accessibility",

  plan(_form: DiscoveredForm): Scenario[] {
    return [
      scenarioFor("reflow-320", "narrow-viewport", {
        title: "Load the form on a 320 px wide screen",
        description: "Opens the page at 320x800 (a small phone, or 400% zoom) and checks it does not scroll sideways.",
        priority: "medium",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("reflow-320", scenario, async (startedAt) => {
      const findings = new FindingList("reflow-320", "accessibility");
      const { page } = await ctx.openPage({ viewport: VIEWPORT });
      ctx.step("Measuring the page width at 320 px", page);
      const m = await evalIn<Measurement>(page, MEASURE, WIDEST);
      if (m.scrollWidth > m.clientWidth + 1) {
        const widest = m.overflowing[0];
        ctx.step("Capturing the whole page at 320 px", page);
        const frame = await ctx.capture(page, "Page at 320 px wide", {
          fullPage: true,
          step: "Load the page at 320x800",
          highlights: [
            ...(widest ? [{ selector: `[${WIDEST}]`, label: overflowCallout(widest, m.clientWidth) }] : []),
            // The part of the page a 320 px screen actually shows; everything right of it needs sideways scrolling.
            { box: { x: 0, y: 0, width: m.clientWidth, height: VIEWPORT.height }, label: `Visible screen: ${m.clientWidth} px`, tone: "info" as const },
          ],
          facts: [
            { label: "Viewport width", value: `${VIEWPORT.width} px (visible width ${m.clientWidth} px)` },
            { label: "Page scroll width", value: `${m.scrollWidth} px` },
            { label: "Horizontal overflow", value: `${m.scrollWidth - m.clientWidth} px` },
            ...(widest
              ? [
                  { label: "Widest element", value: `${widest.selector}, ${widest.width} px wide` },
                  // Its left offset plus its width is where it ends; that edge is what makes the page scroll.
                  { label: "Its right edge", value: `${widest.right} px from the left (${widest.right - m.clientWidth} px past the screen)` },
                ]
              : []),
          ],
          caption: `The page is ${m.scrollWidth} px wide on a ${m.clientWidth} px screen, so it scrolls sideways.`,
        });
        findings.add({
          title: "Page scrolls sideways on a 320 px wide screen",
          severity: "medium",
          meaning: `On a small phone, or when someone zooms in to read, the page is ${m.scrollWidth} px wide but the screen is only ${m.clientWidth} px, so people have to scroll left and right to read and fill in the form.`,
          impact: "People with low vision who zoom in, and people on small phones, can miss fields or give up.",
          fix: `Make the layout fluid: replace fixed widths with max-width and percentages${widest ? ` (start with ${widest.selector}, ${widest.width} px wide)` : ""}, so everything fits in a 320 px wide viewport without horizontal scrolling.`,
          location: widest ? `Page layout (${widest.selector})` : "Page layout",
          evidence: [
            {
              kind: "dom",
              label: "Measured page width at 320x800",
              data: { viewport: VIEWPORT, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, overflowing: m.overflowing },
            },
            frame,
          ],
          spec: playwrightSpec(
            "reflow-320",
            1,
            "page does not scroll horizontally at 320 px",
            ctx.targetUrl,
            `await page.setViewportSize({ width: 320, height: 800 });
const { scrollWidth, clientWidth } = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);`,
          ),
        });
      }
      return checkResult("reflow-320", scenario, startedAt, findings.items, `scrollWidth ${m.scrollWidth}, clientWidth ${m.clientWidth} at 320x800`);
    });
  },
};
