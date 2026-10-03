/**
 * Notes the orchestrator builds after the run: lateChangeNote (when the route credited with a grant wasn't the
 * last one to load).
 */
import type { PaywallGrant } from "../../interfaces/paywall-trust.js";
import { didFor, putDownTo } from "./entitlement-reads.js";
import { pathOf } from "./urls.js";
import type { PaywallOpened } from "../../interfaces/paywall-trust.js";

/**
 * The note for a grant read late (Grant.lateMs), or after a route that didn't load as a page (Grant.seenAfter), which
 * says what it is put down to; "" for neither. When routes that didn't load either were opened between the credited
 * route and `seenAfter` (Grant.between), it names them, and never says `seenAfter` was opened next or that the credited
 * route was the last thing Run Hound did before it (0.6.0 closeout, review round 2).
 */
export function lateChangeNote(g: Pick<PaywallGrant, "route" | "seenAfter" | "between" | "lateMs">): string {
  const LATE = "(a change that lands late, such as a queued job's)";
  const seen = g.seenAfter ? `${g.seenAfter.route.path}${g.seenAfter.res ? ` (${outcomeText(g.seenAfter.res)})` : ""}` : "";
  const quiet = g.lateMs !== undefined ? `Run Hound had opened nothing for ${Math.round(g.lateMs / 1000)} s after ` : "";
  if (g.seenAfter && g.between && g.between.length > 0) {
    const since = g.route.source === "tab" ? didFor(g.route) : g.route.path;
    const list = g.between.map((v) => `${v.route.path}${v.res ? `, ${outcomeText(v.res)}` : ""}`).join("; ");
    const to = g.route.source === "tab" ? "that tab" : putDownTo(g.route);
    return `The change was read only after ${quiet}${seen}, which didn't load as a page, nor did what Run Hound opened between ${since} and it (${list}), so it is put down to ${to} ${LATE}.`;
  }
  if (g.seenAfter) {
    return g.lateMs !== undefined
      ? `The change was read only after ${quiet}${seen}, which didn't load as a page, so it is put down to ${putDownTo(g.route)} ${LATE}.`
      : `The change was read only after ${seen}, opened next, which didn't load as a page, so it is put down to ${putDownTo(g.route)} ${LATE}.`;
  }
  if (g.lateMs === undefined) return "";
  return g.route.source === "tab"
    ? `The change was read only after ${quiet}${didFor(g.route)}, so it is put down to that tab, the last thing Run Hound did ${LATE}.`
    : `The change was read only after ${quiet}${g.route.path}, so it is put down to ${g.route.path}, the last page it opened ${LATE}.`;
}

export function outcomeText(o: PaywallOpened): string {
  switch (o.outcome) {
    case "answered":
      return "answered";
    case "not-found":
      return o.status !== null && o.status >= 400 ? `answered ${o.status}` : "showed a not-found page";
    case "sign-in":
      return "sent to sign-in";
    case "left":
      return "left the app";
    case "moved":
      return o.sameAs !== undefined ? `showed the same page as ${o.sameAs}` : `went to ${pathOf(o.landed)}`;
    case "not-loaded":
      return "didn't load";
    case "stopped":
      return "stopped";
    default:
      return "";
  }
}

export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);