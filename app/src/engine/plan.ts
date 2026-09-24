import { groupOf } from "../core/format.js";
import { CHECK_GROUPS, CHECK_IDS, type Check, type CheckGroup, type DiscoveredForm, type Plan, type Scenario } from "../core/types.js";

/**
 * Collects scenarios from every check, in run order: group by group (CHECK_GROUPS order), CHECK_IDS order inside a
 * group. Scenario ids must be unique across the plan. Destructive scenarios are included but never defaultSelected.
 * A colliding id is disambiguated by prefixing the check id (and a counter if still taken).
 * Plan.groups lists each non-empty group with its scenario ids.
 */
export function buildPlan(target: string, form: DiscoveredForm, checks: Check[]): Plan {
  const groupRank = (check: Check) => CHECK_GROUPS.findIndex((g) => g.id === groupOf(check.category));
  const rank = (check: Check) => {
    const i = (CHECK_IDS as readonly string[]).indexOf(check.id);
    return i === -1 ? CHECK_IDS.length : i;
  };
  const ordered = [...checks].sort((a, b) => groupRank(a) - groupRank(b) || rank(a) - rank(b));

  const seen = new Set<string>();
  const scenarios: Scenario[] = [];
  const byGroup = new Map<CheckGroup, string[]>();
  for (const check of ordered) {
    const group = groupOf(check.category);
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
      byGroup.set(group, [...(byGroup.get(group) ?? []), id]);
    }
  }
  const groups = CHECK_GROUPS.filter((g) => byGroup.has(g.id)).map((g) => ({ id: g.id, label: g.label, scenarioIds: byGroup.get(g.id)! }));
  return { target, form, scenarios, groups };
}
