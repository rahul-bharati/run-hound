/**
 * axe-states: run axe-core (WCAG 2.0/2.1 A and AA, 2.2 AA) on four states of the form: initial,
 * after an invalid (empty) submit, after a server error (create request answered 500 by interception)
 * and after successful bookings. Each violated rule becomes ONE finding listing every affected node
 * and the states it was seen in.
 *
 * Each scan waits for entrance animations to end first, and a contrast failure must still be there a moment later,
 * so text is never judged while it fades in (framer-motion hero text).
 *
 * axe 4.13's `label` rule accepts a placeholder as a label, so a placeholder-only field is reported
 * by an extra in-page check under the same `label` rule id.
 */
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import { isPagePost, isSaveRequest } from "../core/saves.js";
import type { Check, CheckContext, DiscoveredForm, Evidence, Fact, Highlight, Scenario, Severity } from "../core/types.js";
import { openForm, openFormSpec } from "../engine/open-form.js";
import { redactSecrets } from "../engine/redact.js";
import { checkResult, clip, evalIn, FindingList, guarded, playwrightSpec, scenarioFor, submitControl, uniquePlaces } from "./lib/a11y-common.js";
import { canaries, fillAndSubmitSpec, fillValid, settle, submitAndWait } from "./lib/a11y-form.js";
import { isRefusedSignIn, simulatedResponse, STOPPED_PAGE_POST_HTML } from "./lib/functional-form.js";

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type StateName = "initial" | "invalid submit" | "server error" | "success";

interface AxeNode {
  target: string[];
  html: string;
  failureSummary: string;
  /** How a person would name the element ("Remove booking for Rex", "Phone"), read from the page; empty when it has none. */
  name?: string;
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
  /** Annotated frames: the first state the rule failed in, plus a frame for nodes first seen in a later state. */
  frames: Evidence[];
  /** Keys of the nodes a frame has tried to mark. */
  marked: Set<string>;
  /** Marks actually drawn across the frames. */
  drawn: number;
}

/** At most this many violating nodes are marked on a frame, and across a rule's frames. */
const MAX_MARKED = 10;

/** How long a scan waits for entrance animations and transitions (fade-ins, slide-ins, toasts) to end. */
const ANIMATION_WAIT_MS = 3_000;
/** How long after a scan the page is scanned again for contrast, to tell faint text from text still fading in. */
const CONTRAST_RECHECK_MS = 1_500;

/**
 * Waits (at most maxMs) for the page's finite animations and transitions to end: CSS animations and transitions and
 * Web Animations (framer-motion's), including those still in their delay. Endless ones (spinners, pulses) are not
 * waited for, and nothing is skipped ahead: the page ends where a person would see it. Returns how many it waited for.
 */
const SETTLE_ANIMATIONS = `async (maxMs) => {
  const finite = document.getAnimations().filter((a) => {
    const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    return a.playState === "running" && timing && Number.isFinite(timing.endTime);
  });
  if (finite.length === 0) return 0;
  await Promise.race([
    Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, maxMs)),
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return finite.length;
}`;

/** Lets entrance animations end before a scan, so text isn't measured half-transparent mid-fade. */
async function settleAnimations(page: Page): Promise<void> {
  await evalIn<number>(page, SETTLE_ANIMATIONS, ANIMATION_WAIT_MS).catch(() => 0);
}

/** A short name for each selector's element, as a person would describe it: label, aria-label, text, alt, placeholder. */
const NAMES = `(selectors) => selectors.map((sel) => {
  let el = null;
  try { el = sel ? document.querySelector(sel) : null; } catch { el = null; }
  if (!el) return "";
  const text = (n) => ((n && n.textContent) || "").replace(/\\s+/g, " ").trim();
  const by = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean).map((id) => text(document.getElementById(id))).join(" ").trim();
  const labels = el.labels ? [...el.labels].map(text).join(" ").trim() : "";
  const name = (el.getAttribute("aria-label") || "").trim() || by || labels || (el.matches("input,select,textarea") ? "" : text(el)) ||
    (el.getAttribute("alt") || "").trim() || (el.getAttribute("title") || "").trim() || (el.getAttribute("placeholder") || "").trim() ||
    (el.getAttribute("name") || "").trim();
  return name.length > 60 ? name.slice(0, 59) + "…" : name;
})`;

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
const PLACEHOLDER_ONLY = `(scope) => {
  const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=radio]):not([type=checkbox]),textarea,select';
  const text = (el) => ((el && el.textContent) || "").trim();
  // Same scope as the axe scan: only inside "include" when given, never inside "exclude".
  const find = (s) => { try { return document.querySelector(s); } catch { return null; } };
  const inside = scope && scope.include ? find(scope.include) : null;
  const outside = ((scope && scope.exclude) || []).map(find).filter(Boolean);
  return [...document.querySelectorAll(sel)].filter((el) => {
    if (scope && scope.include && !(inside && inside.contains(el))) return false;
    if (outside.some((o) => o.contains(el))) return false;
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

/**
 * Answers the form's save request (core/saves.ts) with 500, simulating a server fault. A classic page post is not
 * simulated: the browser would show Run Hound's own stand-in page, and scanning that says nothing about the app.
 * It is answered with a small valid page instead (so nothing is saved) and reported through `pagePost`.
 */
async function failWrites(page: Page, ctx: CheckContext): Promise<{ pagePost: boolean }> {
  const state = { pagePost: false };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const info = { method: request.method(), resourceType: request.resourceType(), url: request.url(), postData: request.postData() };
    if (!isSaveRequest(info, ctx.targetUrl, ctx.runToken)) return route.fallback();
    if (isPagePost(info)) {
      state.pagePost = true;
      return route.fulfill(simulatedResponse(request, 200, STOPPED_PAGE_POST_HTML, "text/html; charset=utf-8"));
    }
    await route.fulfill(simulatedResponse(request, 500, JSON.stringify({ error: "Something went wrong" })));
  });
  return state;
}

/** True when the discovered form is on the page (it is gone after a page post led to another page). */
async function formIsShown(page: Page, form: DiscoveredForm): Promise<boolean> {
  return (await page.locator(form.selector).count().catch(() => 0)) > 0;
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
// A classic form post leads to another page (and a dialog closes after saving): open the form again for the second submission.
if ((await page.locator(${JSON.stringify(form.selector)}).count()) === 0) {
${[`await page.goto(TARGET);`, ...openFormSpec(form)].map((line) => `  ${line}`).join("\n")}
}
${fillAndSubmitSpec(form, canaries(runToken, "ay"))}
await page.waitForLoadState("networkidle");`;
  }
}

/** "1 element", "3 elements". */
function elements(n: number): string {
  return `${n} element${n === 1 ? "" : "s"}`;
}

/** Highlights, facts and caption for the frame of one rule in one state. */
function frameFor(hit: RuleHit, nodes: AxeNode[], state: StateName, maxMarks = MAX_MARKED) {
  const highlights: Highlight[] = [];
  const callouts = new Set<string>();
  for (const node of nodes) {
    const selector = targetSelector(node);
    if (!selector || highlights.length >= maxMarks) continue;
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
    { label: "Failing nodes", value: `${nodes.length}${nodes.length > maxMarks ? ` (first ${maxMarks} marked)` : ""}` },
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
          ((_form.index ?? 0) > 0
            ? "Runs the axe-core WCAG 2.2 AA rules on this form (the main form's scan covers the rest of the page) empty, after an empty submit, after a simulated server error and after two successful test submissions. Creates two test records."
            : "Runs the axe-core WCAG 2.2 AA rules on the page (other forms are scanned in their own scenarios) with the form empty, after an empty submit, after a simulated server error and after two successful test submissions. Creates two test records."),
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
        // The main form's scan covers the whole page (V0); another form's scan covers only that form, so a problem
        // elsewhere on the page is reported once, not once per form.
        const builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
        const scope: { include?: string; exclude: string[] } = { exclude: [] };
        if ((ctx.form.index ?? 0) > 0) {
          // A search form's submit leads to a results page without the form: nothing of this form to scan there.
          if ((await page.locator(ctx.form.selector).count().catch(() => 0)) === 0) {
            notes.push(`${state} state: the form is not on the page (${new URL(page.url()).pathname}), not scanned`);
            return;
          }
          builder.include(ctx.form.selector);
          scope.include = ctx.form.selector;
        } else {
          // The main form's scan leaves the page's other forms to their own scenarios, so nothing is reported twice.
          for (const other of ctx.discoveredPage?.forms.slice(1) ?? []) {
            builder.exclude(other.selector);
            scope.exclude.push(other.selector);
          }
        }
        visited.push(state);
        await settleAnimations(page);
        const results = await builder.analyze();
        // Text faded in by script (not a Web Animation) can still be half-transparent: contrast failures must still be
        // there a moment later, or they were the fade, not the colours.
        const contrast = results.violations.find((v) => v.id === "color-contrast");
        if (contrast) {
          await page.waitForTimeout(CONTRAST_RECHECK_MS);
          await settleAnimations(page);
          const again = new AxeBuilder({ page }).withRules(["color-contrast"]);
          if (scope.include) again.include(scope.include);
          for (const selector of scope.exclude) again.exclude(selector);
          const still = new Set(((await again.analyze()).violations[0]?.nodes ?? []).map((n) => n.target.map(String).join(" ")));
          const before = contrast.nodes.length;
          contrast.nodes = contrast.nodes.filter((n) => still.has(n.target.map(String).join(" ")));
          if (contrast.nodes.length < before) {
            const faded = before - contrast.nodes.length;
            notes.push(`${state} state: ${elements(faded)} passed contrast once ${faded === 1 ? "it" : "they"} finished fading in, not reported`);
          }
          if (contrast.nodes.length === 0) results.violations = results.violations.filter((v) => v !== contrast);
        }
        const violations = results.violations.map((v) => ({
          ruleId: v.id,
          impact: v.impact ?? "moderate",
          help: v.help,
          helpUrl: v.helpUrl,
          description: v.description,
          tags: v.tags,
          nodes: v.nodes.map((n): AxeNode => ({ target: n.target.map(String), html: n.html, failureSummary: n.failureSummary ?? "" })),
        }));
        const placeholderOnly = await evalIn<AxeNode[]>(page, PLACEHOLDER_ONLY, scope);
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
        const allNodes = violations.flatMap((v) => v.nodes);
        const names = await evalIn<string[]>(page, NAMES, allNodes.map((n) => targetSelector(n) ?? "")).catch(() => allNodes.map(() => ""));
        allNodes.forEach((n, i) => (n.name = redactSecrets(names[i] ?? "")));
        // Nodes a rule has not marked yet, by rule: every node of a new rule, and nodes first seen in this state.
        const toMark: { hit: RuleHit; nodes: AxeNode[] }[] = [];
        for (const v of violations) {
          let hit = hits.get(v.ruleId);
          if (!hit) {
            hit = { ...v, nodes: new Map(), states: [], frames: [], marked: new Set(), drawn: 0 };
            hits.set(v.ruleId, hit);
          }
          if (!hit.states.includes(state)) hit.states.push(state);
          const unmarked: AxeNode[] = [];
          for (const node of v.nodes) {
            const key = node.target.join(" ");
            if (!hit.nodes.has(key)) hit.nodes.set(key, { ...node, html: redactSecrets(node.html).slice(0, 500) });
            if (!hit.marked.has(key)) unmarked.push(node);
          }
          if (unmarked.length > 0 && hit.drawn < MAX_MARKED) toMark.push({ hit, nodes: unmarked });
        }
        // A frame per rule in the state it first failed in, plus one for nodes that first fail in a later state,
        // so every failing node (up to 10) is marked somewhere.
        for (const { hit, nodes } of toMark) {
          const first = hit.frames.length === 0;
          ctx.step(`Marking the ${elements(nodes.length)} that ${first ? "fail" : "also fail"} "${hit.ruleId}"`, page);
          const frame = await ctx.capture(page, `axe ${hit.ruleId} in the ${state} state`, frameFor(hit, nodes, state, MAX_MARKED - hit.drawn));
          for (const node of nodes) hit.marked.add(node.target.join(" "));
          hit.drawn += (frame.highlights ?? []).length;
          hit.frames.push(frame);
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
        const simulated = await failWrites(failing.page, ctx);
        ctx.step("Filling the form; the server will answer 500", failing.page);
        await fillValid(failing.page, ctx.form, canaries(ctx.runToken, "ax"));
        await submitAndWait(failing.page, ctx.form, { targetUrl: ctx.targetUrl, runToken: ctx.runToken });
        await settle(failing.page, 1_000);
        if (simulated.pagePost) {
          notes.push("server error state not scanned: the form is sent as a regular page post, so after a server error the browser shows the server's own error page, not this form");
        } else {
          ctx.step("Scanning the form after a server error", failing.page);
          await analyze(failing.page, "server error");
        }

        // Two submissions, so lists that grow after a save are scanned with neighbouring items. A classic form post
        // leads to another page (a thank-you page); the form is opened again for the second submission, and the
        // page the last one led to is what gets scanned.
        const ok = await ctx.openPage();
        const statuses: (number | null)[] = [];
        for (const variant of ["ax", "ay"]) {
          if (!(await formIsShown(ok.page, ctx.form))) {
            ctx.step("Opening the form again (the last submission led to another page or closed the dialog)", ok.page);
            await ok.page.goto(ctx.targetUrl, { waitUntil: "load" });
            await settle(ok.page, 300);
            await openForm(ok.page, ctx.form);
          }
          ctx.step(`Submitting with test values (${variant === "ax" ? "1st" : "2nd"} submission)`, ok.page);
          await fillValid(ok.page, ctx.form, canaries(ctx.runToken, variant));
          statuses.push((await submitAndWait(ok.page, ctx.form, { targetUrl: ctx.targetUrl, runToken: ctx.runToken }))?.status() ?? null);
        }
        await settle(ok.page, 500);
        ctx.step("Scanning the page after two submissions", ok.page);
        await analyze(ok.page, "success");
        if (statuses.some((s) => isRefusedSignIn(ctx.form, s))) {
          notes.push(`success state: the sign-in was refused (${statuses.join(", ")}), as expected for made-up credentials, so the page scanned shows the sign-in error`);
        } else if (statuses.some((s) => s === null || s >= 400)) {
          notes.push(`success state: save responses ${statuses.map((s) => s ?? "none").join(", ")}`);
        }
      } else {
        notes.push("no submit control: only the initial state was scanned");
      }

      const findings = new FindingList("axe-states", "accessibility");
      for (const hit of hits.values()) {
        const nodes = [...hit.nodes.values()];
        const plain = PLAIN[hit.ruleId];
        const places = uniquePlaces(nodes.map((n) => ({ name: n.name || n.target.join(" "), selector: n.target.join(" ") })));
        const where = places.slice(0, 5);
        const more = places.length > where.length ? ` and ${places.length - where.length} more` : "";
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
}// Let entrance animations end first, so text is not measured while it fades in.
await page.evaluate(() => Promise.race([
  Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => undefined))),
  new Promise((resolve) => setTimeout(resolve, 3000)),
]));
const results = await new AxeBuilder({ page }).withTags(${JSON.stringify(AXE_TAGS)}).withRules(${JSON.stringify(hit.ruleId)})${(ctx.form.index ?? 0) > 0 ? `.include(${JSON.stringify(ctx.form.selector)})` : (ctx.discoveredPage?.forms.slice(1) ?? []).map((f) => `.exclude(${JSON.stringify(f.selector)})`).join("")}.analyze();
expect(results.violations).toEqual([]);`;
        findings.add({
          // The count is in the title when the rule fails on several elements: one finding per rule, never per element.
          title: nodes.length > 1 ? `${hit.help} (${elements(nodes.length)})` : hit.help,
          severity: SEVERITY[hit.impact] ?? "low",
          meaning: `${plain?.meaning ?? `${hit.description}.`} Found on ${elements(nodes.length)} (${where.join(", ")}${more}) in the ${stateText} state${hit.states.length > 1 ? "s" : ""} of the form.`,
          impact: plain?.impact ?? "Some people using assistive technology, or with limited vision or dexterity, may not be able to use this part of the form.",
          fix: `${plain?.fix ?? `Follow axe's guidance for "${hit.ruleId}": ${hit.helpUrl}`} Affected: ${where.join(", ")}${more}.`,
          location: places[0] ?? hit.ruleId,
          ...(places.length > 1 ? { locations: places } : {}),
          evidence: [
            {
              kind: "axe",
              label: `axe rule "${hit.ruleId}" (${hit.impact}), seen in: ${stateText}`,
              data: { ruleId: hit.ruleId, impact: hit.impact, helpUrl: hit.helpUrl, states: hit.states, nodes },
            },
            ...hit.frames,
          ],
          spec: playwrightSpec(
            "axe-states",
            findings.items.length + 1,
            `no "${hit.ruleId}" violations in the ${firstState} state`,
            ctx.targetUrl,
            specBody,
            ['import { AxeBuilder } from "@axe-core/playwright";'], ctx.form,
          ),
        });
      }
      notes.unshift(`Scanned states: ${visited.join(", ")}`);
      return checkResult("axe-states", scenario, startedAt, findings.items, notes.join("; "));
    });
  },
};
