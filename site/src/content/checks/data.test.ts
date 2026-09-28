// Unit tests for content/checks/data.ts: `pnpm test` (node:test, no dependencies; scripts/test-hooks.mjs resolves
// the "@/" imports). The /checks/ page renders every check with an id, so a check can be linked to
// (/checks/#double-submit); these ids must stay unique and stable.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { aiFlowCheck, builtInChecks, categories, previewGroups, releaseAdded } from "@/content/checks/data";

/** A fragment that reads well in a URL: lower case, digits and single hyphens. */
const anchor = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Ids the /checks/ page uses for itself (app/checks/page.tsx; Section adds `${id}-heading`), and the layout's skip-link
 * target. A check's id must not take one of them.
 */
const pageIds = [
  "main",
  "preview",
  "preview-heading",
  "preview-ai-flow",
  "catalog",
  "catalog-heading",
  "advisory",
  "advisory-heading",
  "not-visible",
  "not-visible-heading",
  ...categories.flatMap((c) => [c.id, `${c.id}-title`]),
];

const catalogIds = categories.flatMap((c) => c.checks.map((check) => check.id));
const builtInIds = [...previewGroups.flatMap((g) => g.checks.map((c) => c.id)), aiFlowCheck.id];
const groupAnchors = previewGroups.map((g) => g.anchor);

describe("check ids on /checks/", () => {
  test("every catalog gap has an id that reads well in a URL", () => {
    assert.equal(catalogIds.length, categories.reduce((sum, c) => sum + c.checks.length, 0));
    for (const id of catalogIds) assert.match(id, anchor);
  });

  test("the built-in checks keep the id that plans, reports and the CLI use", () => {
    for (const id of builtInIds) assert.match(id, anchor);
    assert.ok(builtInIds.includes("double-submit"));
    assert.ok(builtInIds.includes("csrf"));
  });

  test("no id is used twice on the page, the groups' anchors included", () => {
    const all = [...pageIds, ...builtInIds, ...catalogIds, ...groupAnchors];
    const seen = new Set<string>();
    const repeated = all.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(repeated, []);
  });
});

describe("builtInChecks", () => {
  test("lists every built-in check once, in the page's order, with its group", () => {
    assert.deepEqual(
      builtInChecks.map((c) => `${c.group} ${c.id}`),
      previewGroups.flatMap((g) => g.checks.map((c) => `${g.group} ${c.id}`)),
    );
  });

  test("leaves out the AI-suggested flows, which aren't counted with them", () => {
    assert.ok(!builtInChecks.some((c) => c.id === aiFlowCheck.id));
  });

  test("are the app's checks: CHECK_IDS in app/src/core/types.ts, the optional ai-flow aside", async () => {
    const repo = new URL("../../../../", import.meta.url).pathname;
    const types = pathToFileURL(join(repo, "app", "src", "core", "types.ts")).href;
    const { CHECK_IDS } = (await import(types)) as { CHECK_IDS: readonly string[] };
    assert.deepEqual(
      builtInChecks.map((c) => c.id).sort(),
      CHECK_IDS.filter((id) => id !== aiFlowCheck.id).sort(),
    );
    assert.ok(CHECK_IDS.includes(aiFlowCheck.id));
  });
});

describe("the release that added each built-in check", () => {
  const byId = new Map(builtInChecks.map((c) => [c.id, c]));
  const releaseOf = (id: string) => {
    const check = byId.get(id);
    assert.ok(check, id);
    return releaseAdded(check);
  };

  test("names the release, never the stage: V0 in 0.1.0, V1 in 0.2.0, the V2 preview in 0.4.0, 0.5.0 and 0.6.0", () => {
    assert.equal(releaseOf("double-submit"), "0.1.0");
    assert.equal(releaseOf("security-headers"), "0.2.0");
    assert.equal(releaseOf("access-control"), "0.4.0");
    assert.equal(releaseOf("mass-assignment"), "0.4.0");
    assert.equal(releaseOf("deep-links"), "0.4.0");
    assert.equal(releaseOf("csrf"), "0.5.0");
    assert.equal(releaseOf("write-access"), "0.6.0");
    assert.equal(releaseOf("paywall-trust"), "0.6.0");
  });

  test("every built-in check has one, a release number", () => {
    for (const c of builtInChecks) assert.match(releaseAdded(c), /^0\.\d+\.0$/, c.id);
  });
});

/** A word as the copy budgets count it (the brief's regex, scripts/check-copy.mjs): "320 px" is two, "axe-core" one. */
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;

describe("each check's plain label and question (the homepage, the checks hub, check pages and search)", () => {
  // The same words wherever a check is named in plain terms: the homepage's checks band, the hub's cards, a check
  // page's related checks and the search index (the design's §3.1, §3.6 and §3.7; brand.md "Copy rules").
  const checks = [...builtInChecks, aiFlowCheck];

  test("every built-in check, and the AI-suggested flows, have a plain label of at most 8 words", () => {
    for (const c of checks) {
      assert.equal(typeof c.plain, "string", `${c.id}: plain`);
      const n = words(c.plain);
      assert.ok(n >= 2 && n <= 8, `${c.id}: "${c.plain}" has ${n} words (2 to 8)`);
    }
  });

  test("a plain label is a statement in sentence case: a capital first, no closing punctuation", () => {
    for (const c of checks) {
      assert.match(c.plain, /^[A-Z]/, c.id);
      assert.doesNotMatch(c.plain, /[.?!:;,]$/, c.id);
    }
  });

  test("every check has a question a reader would ask: at most 10 words, one question mark, at the end", () => {
    for (const c of checks) {
      assert.equal(typeof c.question, "string", `${c.id}: question`);
      assert.match(c.question, /^[A-Z][^?]*\?$/, `${c.id}: "${c.question}"`);
      const n = words(c.question);
      assert.ok(n >= 3 && n <= 10, `${c.id}: "${c.question}" has ${n} words (3 to 10)`);
    }
  });

  test("no two checks share a plain label or a question, so each names one check", () => {
    const plain = checks.map((c) => c.plain.toLowerCase());
    const questions = checks.map((c) => c.question.toLowerCase());
    assert.equal(new Set(plain).size, plain.length, "plain labels");
    assert.equal(new Set(questions).size, questions.length, "questions");
  });

  test("the homepage's twelve examples keep the approved words (the design's §3.1, block 3)", () => {
    const byId = new Map(builtInChecks.map((c) => [c.id, c.plain]));
    const approved: Record<string, string> = {
      "keyboard-completion": "Forms work with the keyboard only",
      "focus-visible": "Keyboard focus is always visible",
      "error-announcement": "Form errors are announced",
      "reflow-320": "The page fits a 320 px screen",
      persistence: "Submitted data is saved",
      "double-submit": "Double-clicking submit saves once",
      "silent-failure": "Server errors are shown",
      "client-only-validation": "The server validates input too",
      "access-control": "Another account can't read your data",
      "write-access": "Another account can't change your data",
      "paywall-trust": "A paid plan needs a real payment",
      "bundle-secrets": "No secret keys in the JavaScript",
    };
    for (const [id, plain] of Object.entries(approved)) assert.equal(byId.get(id), plain, id);
  });

  test("cookie-flags' label promises only what the check tests (it flags SameSite=None, and a missing Secure only on https)", () => {
    const check = builtInChecks.find((c) => c.id === "cookie-flags");
    assert.equal(check?.plain, "Scripts and other sites can't use session cookies");
    assert.doesNotMatch(check?.plain ?? "", /HttpOnly|SameSite|Secure/i, "no cookie attribute the check doesn't require in every case");
  });

  test("silent-failure's question is the design's example of a related check (§3.6)", () => {
    assert.equal(builtInChecks.find((c) => c.id === "silent-failure")?.question, "Is a failed save shown?");
  });
});

describe("the three groups", () => {
  test("are Accessibility, Features and Security, in the order plans and reports use", () => {
    assert.deepEqual(
      previewGroups.map((g) => g.group),
      ["Accessibility", "Features", "Security"],
    );
  });

  test("each has its anchor on /checks/, group-<name>, which the homepage's 'and N more' links (§3.1, §3.7)", () => {
    assert.deepEqual(groupAnchors, ["group-accessibility", "group-features", "group-security"]);
    for (const id of groupAnchors) assert.match(id, anchor);
  });
});
