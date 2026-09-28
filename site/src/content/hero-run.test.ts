// The hero run window and the evidence trio show one real run: Kennel under Run Hound 0.6.0 (DESIGN.md §3.1, §4.3).
// Every value the frame shows equals the run's extract (content/runs/kennel-0.6.0.json, node R1), or, for the three
// values typed into Kennel's form, the Kennel code and the run's own exported test. And the homepage's moving figures
// render every part of the DOM contract the motion code animates (src/motion/dom-contract.ts, §4.6 #12). `pnpm test`.
import "../components/primitives/test-render";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { html } from "../components/primitives/test-render";
import { domContract } from "../motion/dom-contract";
import { heroRunStoryboard } from "../motion/hero-run-storyboard";
import { storyboardEnd } from "../motion/storyboard";
import { cssTokens } from "../motion/tokens";
import { excerptWidth, heroRun, kennelEvidence, type RunFinding, wrapCode } from "./hero-run";
import { home } from "./home";
import kennel from "./runs/kennel-0.6.0.json" with { type: "json" };
import { site as siteInfo } from "../lib/site";

const site = new URL("../../", import.meta.url);
const run = kennel.runs[0];
const finding = (run.findings as unknown as RunFinding[]).find((f) => f.checkId === "double-submit" && f.featured)!;
/** The web UI and reports print a title's straight quotes; the frame sets them as typographic quotes. */
const curled = (text: string) => text.replace(/"([^"]*)"/g, "“$1”");
const specSource = finding.spec.source;
/** The value the run's exported test typed into a field, by its label. */
const typed = (label: string) => new RegExp(`getByLabel\\("${label}", \\{ exact: true \\}\\)\\.fill\\("([^"]+)"\\)`).exec(specSource)?.[1];

describe("the hero run window shows the Kennel 0.6.0 run", () => {
  test("the run: its id, version, address, form and field count", () => {
    assert.equal(kennel.runHoundVersion, "0.6.0");
    assert.equal(heroRun.runId, run.runId);
    const target = new URL(run.target);
    assert.equal(heroRun.address, `${target.host}${target.pathname}`);
    assert.equal(heroRun.address, "localhost:3160/book");
    assert.equal(heroRun.form, run.form.name);
    assert.equal(heroRun.fieldCount, run.form.fieldCount);
  });

  test("the three fields are the form's, with their types, and the values a person would type", () => {
    assert.equal(heroRun.fields.length, 3);
    for (const field of heroRun.fields) {
      assert.ok(
        run.form.fields.some((f) => f.label === field.label && f.type === field.type),
        `${field.label} (${field.type}) is a field of ${run.form.name}`,
      );
    }
    const [pet, start, email] = heroRun.fields;
    // The pet's name is Kennel's own example (its placeholder), not a value the run invented.
    const app = readFileSync(new URL("../fixtures/kennel/src/App.tsx", site), "utf8");
    assert.ok(app.includes(`placeholder="e.g. ${pet.value}"`), `Kennel's pet name placeholder is "e.g. ${pet.value}"`);
    // Kennel's own labels: each button's text is a line of its own inside a <button> of Kennel's form, and the
    // bookings list's heading is its h2. The window's title is the web UI's name.
    const buttons = [...app.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0].split("\n").map((l) => l.trim()));
    for (const label of heroRun.buttons) assert.ok(buttons.some((lines) => lines.includes(label)), `Kennel has a "${label}" button`);
    assert.match(app, new RegExp(`<h2[^>]*>${heroRun.bookings}</h2>`), `Kennel's bookings heading is "${heroRun.bookings}"`);
    assert.equal(heroRun.app, siteInfo.name);
    // The start date is the one the run typed, as a date input shows it.
    const [year, month, day] = typed("Start date")!.split("-");
    assert.equal(start.value, `${month}/${day}/${year}`);
    // The owner email is the run's, without the run's own nonce.
    const runEmail = typed("Owner email")!;
    assert.match(runEmail, /^owner\.[0-9a-f]+twice@example\.test$/);
    assert.equal(email.value, runEmail.replace(/\.[0-9a-f]+twice@/, "@"));
  });

  test("the bookings: the finding's two saved copies, as its evidence marks them", () => {
    const markers = finding.evidence.flatMap((e) => e.markers ?? []).map((m) => m.label);
    assert.deepEqual(heroRun.saved, ["Saved copy 1", "Saved copy 2"]);
    for (const label of heroRun.saved) assert.ok(markers.includes(label), label);
  });

  test("the plan: four real scenario titles, the rest counted, and the run's progress and duration", () => {
    const titles = run.scenarios.map((s) => curled(s.title));
    assert.equal(heroRun.plan.rows.length, 4);
    for (const row of heroRun.plan.rows) assert.ok(titles.includes(row), `"${row}" is a scenario of the run`);
    assert.deepEqual(heroRun.plan.rows, [
      "Double-click “Book” with valid data",
      "Submit while the server answers with an error",
      "Load the page on a 320 px wide screen",
      "Check the page's security headers",
    ]);
    assert.equal(heroRun.plan.more, run.planned - 4);
    assert.equal(heroRun.plan.morePhone, run.planned - 3);
    assert.equal(heroRun.progress.done, run.approved);
    assert.equal(heroRun.progress.total, run.planned);
    assert.equal(heroRun.progress.seconds, Math.floor(run.durationMs / 1000));
    assert.equal(heroRun.progress.seconds, 56);
  });

  test("the finding: its severity, title, requests and their timing", () => {
    assert.equal(heroRun.finding.severity, finding.severity.toUpperCase());
    assert.equal(heroRun.finding.title, curled(finding.title));
    assert.equal(heroRun.finding.requests.length, finding.requests.length);
    heroRun.finding.requests.forEach((request, i) => {
      const real = finding.requests[i];
      assert.equal(request.line, `${real.method} ${real.path} → ${real.status}`);
      assert.equal(request.at, `+${real.atMs.toFixed(1)} ms`);
    });
    assert.deepEqual(
      heroRun.finding.requests.map((r) => r.at),
      ["+29.8 ms", "+30.0 ms"],
    );
    const gap = Math.round((finding.requests[1].atMs - finding.requests[0].atMs) * 10) / 10;
    assert.equal(heroRun.finding.gapMs, gap);
    assert.equal(heroRun.finding.gapMs, 0.2);
  });
});

describe("the evidence trio shows the same finding", () => {
  test("the page: the recorded bookings crop, as the extract describes it", () => {
    const crop = kennel.crops.find((c) => c.findingId === finding.id)!;
    assert.equal(kennelEvidence.crop.width, crop.width);
    assert.equal(kennelEvidence.crop.height, crop.height);
    assert.ok(existsSync(new URL(`src/${crop.asset}`, site)), crop.asset);
  });

  test("the requests: the request card's title and the two saves", () => {
    const card = finding.evidence.find((e) => e.kind === "card")!;
    assert.equal(kennelEvidence.requests.title, card.title);
    assert.deepEqual(
      kennelEvidence.requests.rows.map((r) => [r.n, r.at, r.status]),
      finding.requests.map((r, i) => [`#${i + 1}`, `+${r.atMs.toFixed(1)} ms`, r.status]),
    );
  });

  test(`the test: the exported spec's key lines, none over ${excerptWidth} characters, "// …" for the rest`, () => {
    assert.equal(kennelEvidence.test.filename, finding.spec.filename);
    assert.ok(kennelEvidence.test.lines.includes("  // …"));
    for (const line of kennelEvidence.test.lines) assert.ok(line.length <= excerptWidth, `${line.length}: ${line}`);
    // Put back together, every line but the elision is a line of the real spec.
    const spec = specSource.split("\n").map((l) => l.trimEnd());
    for (const line of kennelEvidence.test.source) {
      if (line.trim() === "// …") continue;
      assert.ok(spec.includes(line), `"${line}" is a line of ${finding.spec.filename}`);
    }
    assert.ok(kennelEvidence.test.source.some((l) => l.includes(".dblclick()")));
    assert.ok(kennelEvidence.test.source.some((l) => l.includes("toHaveLength(1)")));
  });

  test("wrapCode breaks long lines at the shallowest comma or space, with a hanging indent", () => {
    const wrapped = wrapCode('  await page.getByRole("button", { name: "Book", exact: true }).dblclick();', 58);
    assert.deepEqual(wrapped, ['  await page.getByRole("button",', '      { name: "Book", exact: true }).dblclick();']);
    assert.deepEqual(wrapCode("  expect(creates).toHaveLength(1);", 58), ["  expect(creates).toHaveLength(1);"]);
    // A line with nowhere to break stays whole.
    assert.deepEqual(wrapCode(`test(${"x".repeat(80)})`, 58), [`test(${"x".repeat(80)})`]);
  });
});

describe("the captions agree with the run and the storyboard", () => {
  test("the hero caption names the run's real length and the replay's length", () => {
    const caption = home.hero.caption;
    assert.ok(caption.includes(`A ${heroRun.progress.seconds}-second run on Kennel`), caption);
    const replay = Math.ceil(storyboardEnd(heroRunStoryboard, cssTokens()));
    assert.ok(caption.includes(`replayed in ${replay} seconds.`), `${caption} (the storyboard rests at ${storyboardEnd(heroRunStoryboard, cssTokens())} s)`);
  });

  test("the requests caption gives the real gap", () => {
    assert.ok(home.how.proof.requests.caption.includes(`${heroRun.finding.gapMs} ms apart`), home.how.proof.requests.caption);
  });
});

// ---- The DOM contract, as the homepage renders it -------------------------------------------------------------------

/** How many elements carry data-part="<part>" in a fragment. */
const partCount = (markup: string, part: string) => markup.split(`data-part="${part}"`).length - 1;

/** The opening tags carrying data-part="<part>". */
const partTags = (markup: string, part: string) => [...markup.matchAll(new RegExp(`<[a-z]+[^>]*data-part="${part}"[^>]*>`, "g"))].map((m) => m[0]);

/** Whether each element of a part is held: it carries data-beat="late" or sits inside an element that does. */
function heldParts(markup: string, part: string): boolean[] {
  const out: boolean[] = [];
  const stack: { name: string; late: boolean }[] = [];
  const voids = new Set(["img", "br", "input", "source", "use", "path", "rect", "circle", "line"]);
  for (const m of markup.matchAll(/<(\/?)([a-z]+)([^>]*?)(\/?)>/g)) {
    const [, close, name, attrs, self] = m;
    if (close) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const late = attrs.includes('data-beat="late"');
    if (attrs.includes(`data-part="${part}"`)) out.push(late || stack.some((e) => e.late));
    if (!self && !voids.has(name)) stack.push({ name, late });
  }
  return out;
}

async function render(file: string, name: string, props: Record<string, unknown> = {}): Promise<string> {
  const components = (await import(file)) as Record<string, (p: Record<string, unknown>) => unknown>;
  return html(createElement(components[name] as never, props as never));
}

describe("the homepage renders every part of the DOM contract (src/motion/dom-contract.ts)", () => {
  const figures: { motion: keyof typeof domContract; file: string; component: string; props?: Record<string, unknown> }[] = [
    { motion: "hero-run", file: "../components/home/hero-run-figure", component: "HeroRunFigure" },
    { motion: "pipeline", file: "../components/home/how-it-works", component: "Pipeline" },
    { motion: "evidence-trio", file: "../components/home/how-it-works", component: "EvidenceTrio", props: { crop: createElement("span", null, "crop") } },
    { motion: "card-trace", file: "../components/home/checks-band", component: "CheckCards" },
  ];

  for (const { motion, file, component, props } of figures) {
    test(`${motion}: one root, each part as often as the contract says, held and rest-hidden parts marked`, async () => {
      const markup = await render(file, component, props);
      assert.equal(markup.split(`data-motion="${motion}"`).length - 1, 1, `one [data-motion="${motion}"]`);
      const contract = domContract[motion];
      for (const [part, count] of Object.entries(contract.parts)) assert.equal(partCount(markup, part), count, `data-part="${part}"`);
      for (const part of contract.held) assert.ok(heldParts(markup, part).every(Boolean), `every "${part}" is held (data-beat="late")`);
      for (const part of contract.restHidden) {
        for (const tag of partTags(markup, part)) assert.match(tag, /class="[^"]*\brest-hidden\b/, `"${part}" rests hidden by class`);
      }
      // No inline style anywhere in a figure the server renders (§2.9 rule 6; rest states are classes, G-H1).
      assert.doesNotMatch(markup, /\sstyle="/, "no inline style");
    });
  }

  test("hero-run: the window is aria-hidden, the Replay slot is a hidden button outside it, and a list says what it shows", async () => {
    const markup = await render("../components/home/hero-run-figure", "HeroRunFigure");
    const [slot] = partTags(markup, "replay-slot");
    assert.match(slot, /^<button/);
    assert.match(slot, /type="button"/);
    assert.match(slot, /class="[^"]*\binvisible\b/);
    const window = /<div[^>]*data-hero-window[^>]*>/.exec(markup)?.[0] ?? "";
    assert.match(window, /aria-hidden="true"/);
    // The slot comes after the window has closed: it is outside the aria-hidden part.
    const windowEnd = markup.indexOf("</div>", markup.lastIndexOf('data-part="spec-chip"'));
    assert.ok(markup.indexOf('data-part="replay-slot"') > windowEnd);
    assert.match(markup, /<ol class="sr-only">(<li>[^<]+<\/li>){4}<\/ol>/);
    // The mock "Book" button is a span, never a button (only Replay is).
    assert.equal(markup.split("<button").length - 1, 1);
    // Every value the window shows comes from the run.
    for (const value of [heroRun.address, heroRun.form, ...heroRun.plan.rows, heroRun.finding.title, ...heroRun.finding.requests.map((r) => r.at)]) {
      const encoded = value.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
      assert.ok(markup.includes(encoded), `the window shows "${value}"`);
    }
  });

  test("pipeline: the five steps are an ordered list of h3s, every ring lit at rest (none rest-hidden)", async () => {
    const markup = await render("../components/home/how-it-works", "Pipeline");
    assert.match(markup, /^<ol/);
    assert.equal(markup.split("<h3").length - 1, 5);
    // The server renders the finished state: five rings, none resting hidden, so ring 1 is lit before any motion.
    const rings = partTags(markup, "node-ring");
    assert.equal(rings.length, 5);
    for (const ring of rings) assert.doesNotMatch(ring, /\brest-hidden\b/, ring);
  });
});
