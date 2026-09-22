import { CHECK_IDS, type Check, type DiscoveredForm, type Plan, type Scenario } from "../core/types.js";

/**
 * Collects scenarios from every check (in CHECK_IDS order). Scenario ids must be unique across the plan.
 * Destructive scenarios are included but never defaultSelected.
 * A colliding id is disambiguated by prefixing the check id (and a counter if still taken).
 */
export function buildPlan(target: string, form: DiscoveredForm, checks: Check[]): Plan {
  const rank = (check: Check) => {
    const i = (CHECK_IDS as readonly string[]).indexOf(check.id);
    return i === -1 ? CHECK_IDS.length : i;
  };
  const ordered = [...checks].sort((a, b) => rank(a) - rank(b));

  const seen = new Set<string>();
  const scenarios: Scenario[] = [];
  for (const check of ordered) {
    for (const proposed of check.plan(form)) {
      let id = proposed.id;
      if (seen.has(id)) {
        id = `${check.id}:${proposed.id}`;
        for (let n = 2; seen.has(id); n++) id = `${check.id}:${proposed.id}#${n}`;
      }
      seen.add(id);
      const defaultSelected = proposed.destructive ? false : proposed.defaultSelected;
      scenarios.push(
        id === proposed.id && defaultSelected === proposed.defaultSelected ? proposed : { ...proposed, id, defaultSelected },
      );
    }
  }
  return { target, form, scenarios };
}
