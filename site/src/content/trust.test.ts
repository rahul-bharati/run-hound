// content/trust.ts: the facts a visitor checks before trusting Run Hound (the homepage's proof strip and the Start band's
// facts line, §3.1), each with the link to its proof. `pnpm test` (node:test, scripts/test-hooks.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { builtInChecks } from "@/content/checks/data";
import { hasRoute, routes } from "@/content/routes";
import type { Fact } from "@/components/primitives/fact-strip";
import { factsLine, proofStrip, type TrustItem } from "@/content/trust";
import { resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";

const source = readFileSync(new URL("./trust.ts", import.meta.url), "utf8");
const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:/_\-]*/gu) ?? []).length;
const linkOf = (item: TrustItem) => resolveTarget(item.link, routes);

describe("the proof strip (the hero, §3.1 block 0)", () => {
  test("says the four facts, with the count of checks from the checks data", () => {
    assert.deepEqual(
      proofStrip.map((item) => item.label),
      [
        `${builtInChecks.length} checks, all open source`,
        "Runs on your machine",
        "AI off by default",
        "A Playwright test per finding",
      ],
    );
  });

  test("every item links to its proof on this site: the checks, safety, the AI docs and a check's Playwright test", () => {
    assert.deepEqual(
      proofStrip.map((item) => item.link.to),
      ["checks", "docs-safety", "docs-ai", "check-double-submit"],
    );
    assert.equal(proofStrip[3].link.hash, "reproduce");
    for (const item of proofStrip) assert.match(linkOf(item), /^\/[a-z0-9/-]*\/(#[a-z0-9-]+)?$/, item.label);
  });

  test("an item whose page isn't registered yet lands on today's section for it", () => {
    const today: Record<string, string> = {
      "docs-safety": "/docs/#safety",
      "docs-ai": "/docs/#ai",
      "check-double-submit": "/checks/#double-submit",
    };
    for (const item of proofStrip) {
      const to = item.link.to;
      if (!hasRoute(to)) assert.equal(linkOf(item), today[to], item.label);
    }
  });

  test("each item is short enough for the 2 × 2 grid phones get: at most 6 words", () => {
    for (const item of proofStrip) assert.ok(words(item.label) <= 6, item.label);
  });
});

describe("the facts line (the Start band, §3.1 block 6)", () => {
  test("says the license, the engines, the platforms and the release with its date", () => {
    assert.deepEqual(
      factsLine.map((item) => item.label),
      [`${site.license} license`, "Docker or Podman", "amd64 and arm64", `Release ${site.version}, ${site.released}`],
    );
  });

  test("the license links the open-source page's license section, the release what a 0.x release may change", () => {
    assert.deepEqual({ to: factsLine[0].link.to, hash: factsLine[0].link.hash }, { to: "open-source", hash: "license" });
    assert.deepEqual({ to: factsLine[3].link.to, hash: factsLine[3].link.hash }, { to: "open-source", hash: "stability" });
    for (const item of [factsLine[0], factsLine[3]]) assert.match(linkOf(item), /^\/open-source\/#[a-z-]+$/, item.label);
  });

  test("#license is on the open-source page: the registry promises it, or until then the page's markup has it", () => {
    // factsLine[0]'s fallback is its own target, and resolveTarget() checks no anchor on a fallback, so this is the
    // check until F1 promises "license" in content/routes/project.ts with the page's rewrite (then the fallback goes).
    const promised = routes.find((r) => r.id === "open-source")?.anchors.includes("license") ?? false;
    const page = readFileSync(new URL("../app/open-source/page.tsx", import.meta.url), "utf8");
    assert.ok(promised || /\bid=(?:"license"|\{"license"\})/.test(page), "the open-source page has #license");
  });

  test("the engines and the platforms link the install requirements (§3.4: /docs/install/#requirements)", () => {
    for (const item of [factsLine[1], factsLine[2]]) {
      assert.deepEqual({ to: item.link.to, hash: item.link.hash }, { to: "docs-install", hash: "requirements" }, item.label);
      // Until the Install page is registered, the one-page docs' Requirements section.
      if (!hasRoute("docs-install")) assert.equal(linkOf(item), "/docs/#requirements", item.label);
    }
  });
});

describe("every item is a link to its proof, as FactStrip takes it (§2.5)", () => {
  test("each item of both lists has a link that resolves to a page of this site", () => {
    const facts: readonly Fact[] = [...proofStrip, ...factsLine].map((item) => ({ label: item.label, href: resolveTarget(item.link, routes) }));
    for (const fact of facts) assert.match(fact.href, /^\/[a-z0-9/-]*\/(#[a-z0-9-]+)?$/, fact.label);
  });
});

describe("nothing is typed that the data knows", () => {
  test("no count and no release number is written in trust.ts: they come from the checks data and lib/site.ts", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\b\d+\.\d+\.\d+\b/, "a release number");
    assert.doesNotMatch(code, /["'`][^"'`]*\b\d{2,}\b[^"'`]*["'`]/, "a count");
  });
});
