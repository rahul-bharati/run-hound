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
import type { Check, CheckContext, DiscoveredForm, Evidence, Scenario, Severity } from "../core/types.js";
import { redactSecrets } from "../engine/redact.js";
import { checkResult, evalIn, FindingList, guarded, playwrightSpec, scenarioFor, submitControl } from "./lib/a11y-common.js";
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
  nodes: Map<string, AxeNode>;
  states: StateName[];
  screenshot?: Evidence;
}

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
    impact: "People with tremors or limited dexterity, and anyone on a touch screen, will hit the wrong button (for example removing the wrong booking).",
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

export const check: Check = {
  id: "axe-states",
  title: "Automated accessibility scan (axe) in every form state",
  category: "accessibility",

  plan(_form: DiscoveredForm): Scenario[] {
    return [
      scenarioFor("axe-states", "four-states", {
        title: "Scan the form with axe-core before, during and after submitting",
        description:
          "Runs the axe-core WCAG 2.2 AA rules on the empty form, after an empty submit, after a simulated server error and after two successful test bookings. Creates two test bookings.",
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
            nodes: placeholderOnly,
          });
        }
        const fresh: RuleHit[] = [];
        for (const v of violations) {
          let hit = hits.get(v.ruleId);
          if (!hit) {
            hit = { ...v, nodes: new Map(), states: [] };
            hits.set(v.ruleId, hit);
            fresh.push(hit);
          }
          if (!hit.states.includes(state)) hit.states.push(state);
          for (const node of v.nodes) {
            const key = node.target.join(" ");
            if (!hit.nodes.has(key)) hit.nodes.set(key, { ...node, html: redactSecrets(node.html).slice(0, 500) });
          }
        }
        if (fresh.length > 0) {
          const shot = await ctx.screenshot(page, `axe violations in the ${state} state`);
          for (const hit of fresh) hit.screenshot = shot;
        }
      };

      const submit = submitControl(ctx.form);
      const first = await ctx.openPage();
      await analyze(first.page, "initial");

      if (submit) {
        await first.page.locator(submit.selector).first().click();
        await settle(first.page, 1_000);
        await analyze(first.page, "invalid submit");

        const failing = await ctx.openPage();
        await failWrites(failing.page);
        await fillValid(failing.page, ctx.form, canaries(ctx.runToken, "ax"));
        await submitAndWait(failing.page, ctx.form);
        await settle(failing.page, 1_000);
        await analyze(failing.page, "server error");

        // Two bookings, so lists that grow after a booking are scanned with neighbouring items.
        const ok = await ctx.openPage();
        const statuses: (number | null)[] = [];
        for (const variant of ["ax", "ay"]) {
          await fillValid(ok.page, ctx.form, canaries(ctx.runToken, variant));
          statuses.push((await submitAndWait(ok.page, ctx.form))?.status() ?? null);
        }
        await settle(ok.page, 500);
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
          meaning: `${plain?.meaning ?? `${hit.description}.`} Found on ${nodes.length} element(s) (${where.join(", ")}) in the ${stateText} state${hit.states.length > 1 ? "s" : ""} of the form.`,
          impact: plain?.impact ?? "Some people using assistive technology, or with limited vision or dexterity, may not be able to use this part of the form.",
          fix: `${plain?.fix ?? `Follow axe's guidance for "${hit.ruleId}": ${hit.helpUrl}`} Affected: ${where.join(", ")}.`,
          location: where[0] ?? hit.ruleId,
          evidence: [
            {
              kind: "axe",
              label: `axe rule "${hit.ruleId}" (${hit.impact}), seen in: ${stateText}`,
              data: { ruleId: hit.ruleId, impact: hit.impact, helpUrl: hit.helpUrl, states: hit.states, nodes },
            },
            ...(hit.screenshot ? [hit.screenshot] : []),
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
