import type { RouteId } from "@/content/routes";

/**
 * Statements several pages make, each written once here so the pages can't drift apart: the principles Run Hound is
 * built around, what a browser can't see, and the AI data-flow sentence. A page reads them from here; no other file
 * declares one of these lists or repeats one of their sentences (claims.test.ts).
 *
 * Plain data, server-only like every content module: a client component gets what it shows as props.
 */

/**
 * What goes to the model when AI is on, as a clause a page completes ("With AI on, …", "turn it on and …"). The privacy
 * policy and the docs' "What is sent" describe the whole data flow (brand.md: legal pages stay precise about it); this
 * is its one-line form.
 */
export const aiDataFlow = "only redacted page structure and finding text go to the model you choose";

export type Principle = {
  /** A statement, as its heading. */
  readonly title: string;
  /** Its reasons, in plain words. */
  readonly text: string;
  /** A page that shows it at work, read after the text. */
  readonly link?: { readonly label: string; readonly to: RouteId };
};

/** The principles Run Hound is built around, in full: How it works ("Design principles") and llms-full.txt. */
export const principles: readonly Principle[] = [
  {
    title: "AI plans and explains. Real checks decide.",
    text: "Pass or fail comes from Playwright assertions, axe-core and captured traffic in a real browser, never from a model guessing. With AI on (it is off by default), your own model reviews the plan, suggests flows and explains findings, but a real check with evidence still decides every result, and findings from AI-suggested flows are advisory. Findings that rely on judgement, or on production values a dev server doesn't send, are marked advisory.",
  },
  {
    title: "No evidence, no finding.",
    text: "Every reported defect has an annotated screenshot, a GIF or the request and response, plus a replayable spec. A wrong finding costs you time, so each false positive is treated as a bug in Run Hound.",
  },
  {
    title: "Build on Playwright and axe-core.",
    text: "Proven tools do the heavy lifting. Run Hound adds exploration, approval, triage and plain-language reporting on top instead of reinventing them.",
    link: { label: "How that compares with other testing tools", to: "compare" },
  },
  {
    title: "Only owned targets, safe by default.",
    text: "Run Hound tests localhost and private addresses only (plus host names you list yourself); public sites are refused. The browser is pinned to the approved address, destructive scenarios are opt-in, and reports redact secret-looking text. Test accounts are yours, and their passwords, sessions and usernames are kept out of everything a run writes. With AI on, only redacted page structure is sent to your model, and a remote endpoint needs your consent first.",
  },
];

/**
 * The same ground in three short items, as the homepage's "Built to be trusted" says it (running locally, asking first,
 * evidence), until the redesigned homepage replaces that section with its safety band (the design's §3.1, block 5).
 * Kept beside the full list, so the two are edited together.
 */
export const principlesInShort: readonly { readonly title: string; readonly text: string }[] = [
  {
    title: "Runs on your machine",
    text: `It tests one page of an app running locally or on a private address, and reports stay on your machine. AI is off by default; turn it on and ${aiDataFlow}.`,
  },
  {
    title: "Asks before it tests",
    text: "You see every planned scenario, and the test records it may create, before anything runs. Destructive scenarios are off by default.",
  },
  {
    title: "No evidence, no finding",
    text: "AI plans and explains; real checks decide. Pass or fail comes from Playwright assertions, axe-core and captured traffic in a real browser, never from a model's guess.",
  },
];

export type CantSee = {
  /** The topic in a few words: How it works lists every one. */
  readonly topic: string;
  /** Its name and what to find out: the checks page and llms-full.txt list the topics that have one. */
  readonly checklist?: { readonly name: string; readonly line: string };
};

/**
 * What a browser can't see: one entry for each item of the checklist every report ends with (app/src/engine/report.ts
 * NOT_VISIBLE), in its order. Backend error monitoring has no checklist line yet, so the checks page and llms-full.txt
 * list four of the five; its line comes with the rewrite of /checks/#not-visible, which today's text can't change (a
 * blocker for the orchestrator: claims.ts has no handover to C1).
 */
export const cantSee: readonly CantSee[] = [
  {
    topic: "Database backups",
    checklist: { name: "Database backups", line: "Whether backups exist and whether you have ever restored one." },
  },
  {
    topic: "Webhook signature verification on the server",
    checklist: {
      name: "Webhook signatures",
      line: "Whether your server verifies that payment and other webhooks really come from the provider.",
    },
  },
  {
    topic: "Dependency hygiene, such as hallucinated or look-alike packages in your lockfile",
    checklist: {
      name: "Dependency lockfiles",
      line: "Whether your AI added packages that don't exist, or look-alikes of real ones.",
    },
  },
  { topic: "Backend error monitoring" },
  {
    topic: "Legal compliance: Run Hound reports WCAG failures but doesn't certify compliance",
    checklist: {
      name: "Legal certification",
      line: "Run Hound reports WCAG failures. It does not certify compliance with laws like the EAA or ADA.",
    },
  },
];

/** Every topic, as How it works lists them. */
export const cantSeeTopics: readonly string[] = cantSee.map((c) => c.topic);

/** The topics with a name and a line, as the checks page and llms-full.txt list them. */
export const cantSeeChecklist: readonly { readonly name: string; readonly line: string }[] = cantSee.flatMap((c) =>
  c.checklist ? [c.checklist] : [],
);
