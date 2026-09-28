/**
 * The homepage's one-shot effects (DESIGN.md §4.3): the evidence trio and the check cards. The engine (engine.ts)
 * imports them only for a page that has one of them, so the pages with figure reveals alone (/how-it-works/, /demo/,
 * the check pages) don't download them (§5.2: their motion is within 32,000 B).
 */
import { cardTraceStoryboard } from "./card-trace";
import { evidenceTrioStoryboard } from "./evidence-trio";

export const homeOneShots = { "evidence-trio": evidenceTrioStoryboard, "card-trace": cardTraceStoryboard } as const;
