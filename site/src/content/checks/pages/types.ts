import type { Severity } from "@/components/finding";

/**
 * A check page's hand-written text (DESIGN.md §3.6): one module per built-in check, content/checks/pages/<id>.ts, and
 * the one template app/checks/[id]/page.tsx renders it. Everything else on the page comes from elsewhere, so it is
 * written once: the name, group, test records, sign-in and default from content/checks/data.ts; the finding (its title,
 * "What it means", "Impact", the fix), the evidence, the scenario's step labels and the Playwright test from the run
 * extracts (content/runs/*.json, the check's featured finding); the headings and labels from content/ui.ts.
 *
 * Plain data, no JSX and no value imports: content/routes/checks.ts loads the modules through ./index.ts, and the
 * registry must stay loadable by plain Node (content/routes.ts).
 *
 * The rules pages.test.ts holds every module to: the lede at most 45 words; 300 to 800 words on the page; no sentence
 * of 8 or more words on 3 or more check pages; every step label one the run recorded, in its order; every number in
 * the hand-written text one the run, the check's source or its data line has; every evidence label one the featured
 * finding has; 1 to 3 background links from OWASP, WCAG, CWE, MDN or the IETF; 2 to 4 limits; 2 to 4 related checks.
 */
export type CheckPage = {
  /** The check id (app/src/core/types.ts CHECK_IDS): the page is /checks/<id>/, and reports link it. Never renamed. */
  readonly id: string;
  /** The meta description: 70 to 160 characters, and unique. */
  readonly description: string;
  /**
   * At most 45 words: what goes wrong, in plain words, and how AI builders cause it, without overstating it
   * ("AI builders often leave the button active while the save is in flight …").
   */
  readonly lede: string;
  /** The typical severity when the check fails: one its source (app/src/checks/<id>.ts) assigns. The facts panel and the hub card show it. */
  readonly severity: Severity;
  /**
   * "How Run Hound tests it": steps of the featured finding's scenario, each `label` exactly as the run recorded it
   * (a subset, in the run's order), each with one hand-written line. The last is the step that decides; its ring is
   * `fail`.
   */
  readonly steps: readonly { readonly label: string; readonly line: string }[];
  /** What the check ignores, after "Not counted:". */
  readonly notCounted: string;
  /**
   * The evidence the page shows under "What a finding looks like", in order: each `label` is one of the featured
   * finding's evidence items; `caption` is at most 15 words, sentence case. `alt` describes a picture (a frame or a
   * GIF); a listing (a request card, headers, cookies, console lines) is text already and needs none.
   */
  readonly evidence: readonly { readonly label: string; readonly caption: string; readonly alt?: string }[];
  /** "Reproduce it with Playwright": what the exported test does, before the test itself. */
  readonly reproduce: string;
  /** 1 to 3 background links (OWASP, WCAG, CWE, MDN, IETF), each with one line on why it is relevant. */
  readonly background: readonly { readonly label: string; readonly href: string; readonly why: string }[];
  /** "Limits": 2 to 4 bullets from the check's source header and TESTING.md "Known limitations". */
  readonly limits: readonly string[];
  /** 2 to 4 related built-in checks, by id: the page shows each as its question (content/checks/data.ts). */
  readonly related: readonly string[];
  /**
   * Only for a check with no featured finding in either run extract (content/runs/runs.test.ts noEvidence): the
   * finding's texts as the check's source writes them. The page then says no finding from the test apps is shown yet.
   */
  readonly noEvidence?: { readonly title: string; readonly meaning: string; readonly impact: string; readonly fix: string };
};
