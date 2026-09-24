/**
 * reflow-320: load the page at 320x800 (WCAG 1.4.10 Reflow) and fail when the page scrolls
 * horizontally (scrollWidth > clientWidth + 1).
 */
import type { Check, CheckContext, DiscoveredForm, Scenario } from "../core/types.js";
import { checkResult, evalIn, FindingList, guarded, playwrightSpec, scenarioFor } from "./lib/a11y-common.js";

const VIEWPORT = { width: 320, height: 800 };

interface Overflowing {
  selector: string;
  width: number;
  right: number;
  /** The start of the element's text, to tell what sticks out. */
  text: string;
  /** True when the element's text holds one of Run Hound's own test values (it contains the run token). */
  testData: boolean;
}

interface Measurement {
  scrollWidth: number;
  clientWidth: number;
  /** The widest elements that stick out past the right edge, for the fix hint. */
  overflowing: Overflowing[];
}

/** Attribute put on the widest overflowing element so the evidence frame can mark exactly that element. */
const WIDEST = "data-rh-widest";

/**
 * Elements whose box ends past the right edge; when there are none, elements whose content spills out of their box
 * past the edge (a long word with no wrap point, such as an email address in a list item), deepest first.
 */
const MEASURE = `(args) => {
  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;
  const token = (args.token || "").toLowerCase();
  const describe = (el) => el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.classList[0] ? "." + el.classList[0] : "");
  const textOf = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();
  // Test data is the cause only when text spills out of a box that itself fits (spill), or the element is inline
  // text as wide as its words: a block with its own fixed width overflows whatever text is inside it.
  const entry = (el, width, right, spill) => {
    const text = textOf(el);
    const textWide = spill || getComputedStyle(el).display.startsWith("inline");
    return { el, selector: describe(el), width: Math.round(width), right: Math.round(right), text: text.slice(0, 80), testData: !!token && textWide && text.toLowerCase().includes(token) };
  };
  let out = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= clientWidth + 1) continue;
    out.push(entry(el, r.width, r.right, false));
  }
  out.sort((a, b) => b.width - a.width);
  if (out.length === 0) {
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).overflowX !== "visible") continue;
      const right = r.left + el.scrollWidth;
      if (right <= clientWidth + 1) continue;
      // The innermost element that spills is the culprit; its ancestors spill only because of it.
      if (out.length && el.contains(out[out.length - 1].el)) continue;
      out = out.filter((o) => !o.el.contains(el));
      out.push(entry(el, el.scrollWidth, right, true));
    }
    out.sort((a, b) => b.right - a.right);
  }
  if (out[0]) out[0].el.setAttribute(args.attr, "");
  return {
    scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
    clientWidth,
    overflowing: out.slice(0, 5).map(({ selector, width, right, text, testData }) => ({ selector, width, right, text, testData })),
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
      const m = await evalIn<Measurement>(page, MEASURE, { attr: WIDEST, token: ctx.runToken });
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
                  { label: "Widest element", value: `${widest.selector}, ${widest.width} px wide${widest.text ? `: "${widest.text.slice(0, 60)}"` : ""}` },
                  ...(widest.testData ? [{ label: "Its text", value: "a test value Run Hound saved earlier in this run" }] : []),
                  // Its left offset plus its width is where it ends; that edge is what makes the page scroll.
                  { label: "Its right edge", value: `${widest.right} px from the left (${widest.right - m.clientWidth} px past the screen)` },
                ]
              : []),
          ],
          caption: `The page is ${m.scrollWidth} px wide on a ${m.clientWidth} px screen, so it scrolls sideways.`,
        });
        // Only Run Hound's own long test values (saved by an earlier scenario, such as an email address with no
        // wrap point) stick out: the layout itself reflows. Worth knowing, since real long values do the same, but
        // advisory, and it depends on what earlier scenarios saved.
        const onlyTestData = m.overflowing.length > 0 && m.overflowing.every((o) => o.testData);
        findings.add({
          ...(onlyTestData ? { confidence: "advisory" as const } : {}),
          title: onlyTestData ? "Long unbroken text runs off a 320 px wide screen" : "Page scrolls sideways on a 320 px wide screen",
          severity: onlyTestData ? "low" : "medium",
          meaning: onlyTestData
            ? `On a 320 px screen the layout fits, but a long word with no place to wrap (${widest ? `"${widest.text.slice(0, 60)}"` : "a test value"}, saved by Run Hound earlier in this run) is wider than the screen, so the page scrolls sideways. Real long values, such as long email addresses, would do the same.`
            : `On a small phone, or when someone zooms in to read, the page is ${m.scrollWidth} px wide but the screen is only ${m.clientWidth} px, so people have to scroll left and right to read and fill in the form.`,
          impact: "People with low vision who zoom in, and people on small phones, can miss fields or give up.",
          fix: onlyTestData
            ? `Let long words wrap where they are shown${widest ? ` (${widest.selector})` : ""}: add overflow-wrap: anywhere (or word-break: break-word) to that element.`
            : `Make the layout fluid: replace fixed widths with max-width and percentages${widest ? ` (start with ${widest.selector}, ${widest.width} px wide)` : ""}, so everything fits in a 320 px wide viewport without horizontal scrolling.`,
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
