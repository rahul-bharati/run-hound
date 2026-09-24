/**
 * axe-states: run axe-core (WCAG 2.0/2.1 A and AA, 2.2 AA) on four states of the form: initial,
 * after an invalid (empty) submit, after a server error (create request answered 500 by interception)
 * and after successful bookings. Each violated rule becomes ONE finding listing every affected node
 * and the states it was seen in.
 *
 * axe 4.13's `label` rule accepts a placeholder as a label, so a placeholder-only field is reported
 * by an extra in-page check under the same `label` rule id.
 */
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { Check, CheckContext, DiscoveredForm, Evidence, Fact, Highlight, Scenario, Severity } from "../core/types.js";
import { redactSecrets } from "../engine/redact.js";
import { checkResult, clip, evalIn, FindingList, guarded, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
import { canaries, fillAndSubmitSpec, fillValid, sameOrigin, settle, submitAndWait } from "./lib/a11y-form.js";

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type StateName = "initial" | "invalid submit" | "server error" | "success";

interface AxeNode {
  target: string[];
  html: string;
  failureSummary: string;
}

interface RuleHit {
  ruleId: string;
  impact: string;
  help: string;
  helpUrl: string;
  description: string;
  tags: string[];
  nodes: Map<string, AxeNode>;
  states: StateName[];
  /** Annotated frame of the first state the rule failed in. */
  frame?: Evidence;
}

/** At most this many violating nodes are marked on a frame. */
const MAX_MARKED = 10;

/** axe impact -> Run Hound severity. */
const SEVERITY: Record<string, Severity> = { critical: "high", serious: "medium", moderate: "low", minor: "low" };

/** Plain-language meaning and impact for common rules; other rules fall back to axe's description. */
const PLAIN: Record<string, { meaning: string; impact: string; fix: string }> = {
  label: {
    meaning: "A form field has no label that assistive technology can rely on. A placeholder is not a label: it disappears as soon as someone types and isn't announced consistently.",
    impact: "Screen reader and voice-control users can't tell what to type in the field, and everyone loses the hint once they start typing.",
    fix: "Give the field a visible <label for=\"…\"> (or aria-labelledby pointing at visible text). Keep the placeholder only as an example.",
  },
  "button-name": {
    meaning: "A button has no name, so screen readers announce it only as \"button\".",
    impact: "Screen reader and voice-control users can't tell what the button does or ask for it by name.",
    fix: "Give the icon-only button an accessible name: aria-label=\"…\" or visually hidden text inside it.",
  },
  "color-contrast": {
    meaning: "Some text is too faint against its background (below the WCAG minimum contrast ratio).",
    impact: "People with low vision, colour blindness, or anyone on a phone in sunlight may not be able to read it.",
    fix: "Darken the text colour (or lighten the background) until the contrast ratio is at least 4.5:1 for normal text.",
  },
  "target-size": {
    meaning: "Some buttons are smaller than 24x24 px and packed too close together to tap reliably.",
    impact: "People with tremors or limited dexterity, and anyone on a touch screen, will hit the wrong button (for example removing the wrong item).",
    fix: "Make each target at least 24x24 px (44x44 is better), or leave enough space between small targets.",
  },
};

/** Finds visible fields whose only label is a placeholder (not caught by axe 4.13's `label` rule). */
const PLACEHOLDER_ONLY = `() => {
  const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=radio]):not([type=checkbox]),textarea,select';
  const text = (el) => ((el && el.textContent) || "").trim();
  return [...document.querySelectorAll(sel)].filter((el) => {
    if (el.getClientRects().length === 0) return false;
    if (!(el.getAttribute("placeholder") || "").trim()) return false;
    const labelled = [...(el.labels || [])].some((l) => text(l));
    const aria = (el.getAttribute("aria-label") || "").trim();
    const by = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean).some((id) => text(document.getElementById(id)));
    const title = (el.getAttribute("title") || "").trim();
    return !labelled && !aria && !by && !title;
  }).map((el) => ({
    target: [el.id ? "#" + CSS.escape(el.id) : el.tagName.toLowerCase() + (el.name ? '[name="' + el.name + '"]' : "")],
    html: el.outerHTML.slice(0, 300),
    failureSummary: "Fix any of the following:\\n  Only a placeholder labels this field; add a <label>, aria-label or aria-labelledby",
  }));
}`;

/** WCAG success criteria from axe tags ("wcag412" -> "4.1.2"). */
export function wcagCriteria(tags: string[]): string[] {
  return tags.flatMap((tag) => {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    return m ? [`${m[1]}.${m[2]}.${m[3]}`] : [];
  });
}

/** axe's failure summary as one line, without the "Fix any/all of the following:" preamble. */
function summaryLine(summary: string): string {
  return summary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^fix (any|all) of the following:?$/i.test(line))
    .slice(0, 2)
    .join("; ");
}

/** Callout for one violating node: the rule id plus the measured value when axe gives one. */
function nodeCallout(ruleId: string, node: AxeNode): string {
  const summary = node.failureSummary;
  const contrast = /contrast of ([\d.]+)/i.exec(summary);
  if (contrast) return `${ruleId} ${contrast[1]}:1`;
  const size = /\(([\d.]+)px by ([\d.]+)px/i.exec(summary);
  if (size) return `${ruleId} ${Math.round(Number(size[1]))}×${Math.round(Number(size[2]))} px`;
  if (ruleId === "label" && /placeholder/i.test(summary)) return "label: placeholder is the only label";
  const short: Record<string, string> = { label: "field has no label", "button-name": "no accessible name", "link-name": "no accessible name", "image-alt": "no alt text" };
  return short[ruleId] ? `${ruleId}: ${short[ruleId]}` : ruleId;
}

/** A CSS selector for an axe target, or null for targets inside iframes or shadow roots. */
function targetSelector(node: AxeNode): string | null {
  return node.target.length === 1 && typeof node.target[0] === "string" && !node.target[0].includes(",") ? node.target[0] : null;
}

/** Answers every same-origin non-GET request with 500, simulating a server fault. */
async function failWrites(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "GET" && sameOrigin(request.url(), page.url())) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong" }) });
    } else {
      await route.fallback();
    }
  });
}

/** Spec lines that bring the page into `state` before axe runs. */
function stateSteps(state: StateName, form: DiscoveredForm, runToken: string): string {
  const submit = submitControl(form);
  switch (state) {
    case "initial":
      return "";
    case "invalid submit":
      return submit ? `await page.locator(${JSON.stringify(submit.selector)}).first().click();\nawait page.waitForTimeout(1000);` : "";
    case "server error":
      return `await page.route("**/*", (route) =>
  route.request().method() !== "GET" ? route.fulfill({ status: 500, body: "{}" }) : route.fallback(),
);
${fillAndSubmitSpec(form, canaries(runToken, "ax"))}
await page.waitForTimeout(1000);`;
    case "success":
      return `${fillAndSubmitSpec(form, canaries(runToken, "ax"))}
await page.waitForLoadState("networkidle");
${fillAndSubmitSpec(form, canaries(runToken, "ay"))}
await page.waitForLoadState("networkidle");`;
  }
}

/** "1 element", "3 elements". */
function elements(n: number): string {
  return `${n} element${n === 1 ? "" : "s"}`;
}

/** Highlights, facts and caption for the frame of one rule in one state. */
function frameFor(hit: RuleHit, nodes: AxeNode[], state: StateName) {
  const highlights: Highlight[] = [];
  const callouts = new Set<string>();
  for (const node of nodes) {
    const selector = targetSelector(node);
    if (!selector || highlights.length >= MAX_MARKED) continue;
    // Repeats of the same callout are shortened to the rule id, so a dense list of nodes stays readable.
    const callout = nodeCallout(hit.ruleId, node);
    highlights.push({ selector, label: callouts.has(callout) ? hit.ruleId : callout });
    callouts.add(callout);
  }
  const criteria = wcagCriteria(hit.tags);
  const facts: Fact[] = [
    { label: "Rule", value: `${hit.ruleId}: ${hit.help}` },
    { label: "Impact", value: hit.impact },
    { label: "WCAG criteria", value: criteria.length > 0 ? criteria.join(", ") : "best practice (no WCAG criterion)" },
    { label: "Form state", value: state },
    { label: "Failing nodes", value: `${nodes.length}${nodes.length > MAX_MARKED ? ` (first ${MAX_MARKED} marked)` : ""}` },
    { label: "Failure summary", value: clip(summaryLine(nodes[0]?.failureSummary ?? ""), 220) || "(none given)" },
  ];
  return {
    highlights,
    facts,
    fullPage: true,
    step: `axe scan: ${state} state`,
    caption: `${elements(nodes.length)} ${nodes.length === 1 ? "fails" : "fail"} the axe rule "${hit.ruleId}" (${hit.help}) in the ${state} state of the form.`,
  };
}

export const check: Check = {
  id: "axe-states",
  title: "Automated accessibility scan (axe) in every form state",
  category: "accessibility",

  plan(_form: DiscoveredForm): Scenario[] {
    return [
      scenarioFor("axe-states", "four-states", {
        title: "Scan the form with axe-core before, during and after submitting",
        description:
          "Runs the axe-core WCAG 2.2 AA rules on the empty form, after an empty submit, after a simulated server error and after two successful test submissions. Creates two test records.",
        priority: "high",
      }),
    ];
  },

  async run(ctx: CheckContext, scenario: Scenario) {
    return guarded("axe-states", scenario, async (startedAt) => {
      const hits = new Map<string, RuleHit>();
      const visited: StateName[] = [];
      const notes: string[] = [];

      const analyze = async (page: Page, state: StateName) => {
        visited.push(state);
        const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        const violations = results.violations.map((v) => ({
          ruleId: v.id,
          impact: v.impact ?? "moderate",
          help: v.help,
          helpUrl: v.helpUrl,
          description: v.description,
          tags: v.tags,
          nodes: v.nodes.map((n) => ({ target: n.target.map(String), html: n.html, failureSummary: n.failureSummary ?? "" })),
        }));
        const placeholderOnly = await evalIn<AxeNode[]>(page, PLACEHOLDER_ONLY);
        if (placeholderOnly.length > 0) {
          violations.push({
            ruleId: "label",
            impact: "critical",
            help: "Form elements must have labels",
            helpUrl: "https://dequeuniversity.com/rules/axe/4.13/label",
            description: "Ensures every form element has a label (a placeholder alone does not count)",
            tags: ["wcag2a", "wcag131", "wcag412"],
            nodes: placeholderOnly,
          });
        }
        const fresh: { hit: RuleHit; nodes: AxeNode[] }[] = [];
        for (const v of violations) {
          let hit = hits.get(v.ruleId);
          if (!hit) {
            hit = { ...v, nodes: new Map(), states: [] };
            hits.set(v.ruleId, hit);
            fresh.push({ hit, nodes: v.nodes });
          }
          if (!hit.states.includes(state)) hit.states.push(state);
          for (const node of v.nodes) {
            const key = node.target.join(" ");
            if (!hit.nodes.has(key)) hit.nodes.set(key, { ...node, html: redactSecrets(node.html).slice(0, 500) });
          }
        }
        // One frame per rule, in the state it first failed in, with every violating node (up to 10) marked.
        for (const { hit, nodes } of fresh) {
          ctx.step(`Marking the ${elements(nodes.length)} that fail "${hit.ruleId}"`, page);
          hit.frame = await ctx.capture(page, `axe ${hit.ruleId} in the ${state} state`, frameFor(hit, nodes, state));
        }
      };

      const submit = submitControl(ctx.form);
      const first = await ctx.openPage();
      ctx.step("Scanning the empty form with axe", first.page);
      await analyze(first.page, "initial");

      if (submit) {
        ctx.step("Submitting the empty form", first.page);
        await first.page.locator(submit.selector).first().click();
        await settle(first.page, 1_000);
        ctx.step("Scanning the form after an empty submit", first.page);
        await analyze(first.page, "invalid submit");

        const failing = await ctx.openPage();
        await failWrites(failing.page);
        ctx.step("Filling the form; the server will answer 500", failing.page);
        await fillValid(failing.page, ctx.form, canaries(ctx.runToken, "ax"));
        await submitAndWait(failing.page, ctx.form);
        await settle(failing.page, 1_000);
        ctx.step("Scanning the form after a server error", failing.page);
        await analyze(failing.page, "server error");

        // Two bookings, so lists that grow after a booking are scanned with neighbouring items.
        const ok = await ctx.openPage();
        const statuses: (number | null)[] = [];
        for (const variant of ["ax", "ay"]) {
          ctx.step(`Submitting with test values (${variant === "ax" ? "1st" : "2nd"} submission)`, ok.page);
          await fillValid(ok.page, ctx.form, canaries(ctx.runToken, variant));
          statuses.push((await submitAndWait(ok.page, ctx.form))?.status() ?? null);
        }
        await settle(ok.page, 500);
        ctx.step("Scanning the form after two submissions", ok.page);
        await analyze(ok.page, "success");
        if (statuses.some((s) => s === null || s >= 300)) notes.push(`success state: create responses ${statuses.join(", ")}`);
      } else {
        notes.push("no submit control: only the initial state was scanned");
      }

      const findings = new FindingList("axe-states", "accessibility");
      for (const hit of hits.values()) {
        const nodes = [...hit.nodes.values()];
        const plain = PLAIN[hit.ruleId];
        const where = nodes.map((n) => n.target.join(" ")).slice(0, 5);
        const stateText = hit.states.join(", ");
        const firstState = hit.states[0]!;
        const specBody = `${stateSteps(firstState, ctx.form, ctx.runToken)}
${
  hit.ruleId === "label"
    ? `const unlabelled = await page.evaluate(() => [...document.querySelectorAll("input:not([type=hidden]),textarea,select")]
  .filter((el) => el.getClientRects().length > 0 && !(el as HTMLInputElement).labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
  .map((el) => el.id || el.getAttribute("name")));
expect(unlabelled).toEqual([]);
`
    : ""
}const results = await new AxeBuilder({ page }).withTags(${JSON.stringify(AXE_TAGS)}).withRules(${JSON.stringify(hit.ruleId)}).analyze();
expect(results.violations).toEqual([]);`;
        findings.add({
          title: hit.help,
          severity: SEVERITY[hit.impact] ?? "low",
          meaning: `${plain?.meaning ?? `${hit.description}.`} Found on ${elements(nodes.length)} (${where.join(", ")}) in the ${stateText} state${hit.states.length > 1 ? "s" : ""} of the form.`,
          impact: plain?.impact ?? "Some people using assistive technology, or with limited vision or dexterity, may not be able to use this part of the form.",
          fix: `${plain?.fix ?? `Follow axe's guidance for "${hit.ruleId}": ${hit.helpUrl}`} Affected: ${where.join(", ")}.`,
          location: where[0] ?? hit.ruleId,
          evidence: [
            {
              kind: "axe",
              label: `axe rule "${hit.ruleId}" (${hit.impact}), seen in: ${stateText}`,
              data: { ruleId: hit.ruleId, impact: hit.impact, helpUrl: hit.helpUrl, states: hit.states, nodes },
            },
            ...(hit.frame ? [hit.frame] : []),
          ],
          spec: playwrightSpec(
            "axe-states",
            findings.items.length + 1,
            `no "${hit.ruleId}" violations in the ${firstState} state`,
            ctx.targetUrl,
            specBody,
            ['import { AxeBuilder } from "@axe-core/playwright";'],
          ),
        });
      }
      notes.unshift(`Scanned states: ${visited.join(", ")}`);
      return checkResult("axe-states", scenario, startedAt, findings.items, notes.join("; "));
    });
  },
};
