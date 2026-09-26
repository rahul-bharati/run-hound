import { groupOf } from "../core/format.js";
import { CHECK_GROUPS, CHECK_IDS, type Check, type CheckGroup, type DiscoveredForm, type DiscoveredPage, type Plan, type PlanEnv, type Scenario } from "../core/types.js";
import { changesCredentials, credentialFormNote, NEVER_SUBMITS } from "../checks/lib/functional-form.js";
import { emptyForm } from "./discover.js";

/** "Book a sitter form", "Form 2": how a form is named in scenario titles and the plan. */
export function formLabel(form: DiscoveredForm, index = form.index ?? 0): string {
  const name = form.name?.replace(/\s+/g, " ").trim();
  if (!name) return form.search ? "Search form" : `Form ${index + 1}`;
  return /\bform$/i.test(name) ? name : `${name} form`;
}

/** Label of page-scoped scenarios. */
export const WHOLE_PAGE = "Whole page";

function isPage(value: DiscoveredForm | DiscoveredPage): value is DiscoveredPage {
  return Array.isArray((value as DiscoveredPage).forms);
}

/**
 * Collects scenarios from every check, in run order: group by group (CHECK_GROUPS order), CHECK_IDS order inside a
 * group, forms in page order inside a check. Scenario ids must be unique across the plan. Destructive scenarios are
 * included but never defaultSelected. A colliding id is disambiguated by prefixing the check id (and a counter if
 * still taken). Plan.groups lists each non-empty group with its scenario ids.
 *
 * Given a form (V0), every check plans for that form. Given a page (V1), form-scoped checks plan once per form (ids of
 * the second and later forms end in "@form-<n>", and titles name the form when there is more than one) and
 * page-scoped checks plan once for the page; every scenario carries its scope and a scopeLabel.
 * `env` (0.4.0) is passed to every check's plan(): whether the run is signed in and has a second account. Without a
 * signed-in env, a plan whose checks include access-control on a page with a form that saves gets signInHint.
 */
export function buildPlan(target: string, formOrPage: DiscoveredForm | DiscoveredPage, checks: Check[], env?: PlanEnv): Plan {
  const page = isPage(formOrPage) ? formOrPage : undefined;
  const forms = page ? page.forms : [formOrPage as DiscoveredForm];
  const mainForm = forms[0] ?? emptyForm(page?.url ?? target);

  const groupRank = (check: Check) => CHECK_GROUPS.findIndex((g) => g.id === groupOf(check.category));
  const rank = (check: Check) => {
    const i = (CHECK_IDS as readonly string[]).indexOf(check.id);
    return i === -1 ? CHECK_IDS.length : i;
  };
  const ordered = [...checks].sort((a, b) => groupRank(a) - groupRank(b) || rank(a) - rank(b));

  const seen = new Set<string>();
  const scenarios: Scenario[] = [];
  const byGroup = new Map<CheckGroup, string[]>();
  const add = (check: Check, proposed: Scenario, extra: Partial<Scenario>, idSuffix = "") => {
    let id = proposed.id + idSuffix;
    if (seen.has(id)) {
      id = `${check.id}:${proposed.id}${idSuffix}`;
      for (let n = 2; seen.has(id); n++) id = `${check.id}:${proposed.id}${idSuffix}#${n}`;
    }
    seen.add(id);
    const defaultSelected = proposed.destructive ? false : proposed.defaultSelected;
    const unchanged = id === proposed.id && defaultSelected === proposed.defaultSelected && Object.keys(extra).length === 0;
    scenarios.push(unchanged ? proposed : { ...proposed, ...extra, id, defaultSelected });
    const group = groupOf(check.category);
    byGroup.set(group, [...(byGroup.get(group) ?? []), id]);
  };

  for (const check of ordered) {
    if (!page) {
      for (const proposed of check.plan(mainForm, undefined, env)) add(check, proposed, {});
      continue;
    }
    if (check.scope === "page") {
      for (const proposed of check.plan(mainForm, page, env)) add(check, proposed, { scope: "page", scopeLabel: WHOLE_PAGE });
      continue;
    }
    forms.forEach((form, index) => {
      const label = formLabel(form, index);
      // Signed in, a form that sets a password would change the test account's (credentialFormNote): opt-in only.
      const guarded = env?.signedIn === true && changesCredentials(form) && !NEVER_SUBMITS.has(check.id);
      for (const planned of check.plan(form, page, env)) {
        const proposed = guarded ? { ...planned, destructive: true, description: `${planned.description} ${credentialFormNote("the test account")}` } : planned;
        const title = forms.length > 1 ? `${proposed.title} (${label})` : proposed.title;
        add(check, proposed, { scope: "form", formIndex: index, scopeLabel: label, title }, index === 0 ? "" : `@form-${index + 1}`);
      }
    });
  }
  const groups = CHECK_GROUPS.filter((g) => byGroup.has(g.id)).map((g) => ({ id: g.id, label: g.label, scenarioIds: byGroup.get(g.id)! }));
  // Signed out, the access checks plan nothing: one hint to sign in replaces them, on a page with a form that saves.
  const signInHint = env?.signedIn !== true && checks.some((c) => c.id === "access-control") && forms.some((f) => !f.search && f.fields.length > 0);
  return { target, form: mainForm, ...(page ? { page } : {}), scenarios, groups, ...(signInHint ? { signInHint: true } : {}) };
}

/** The form a scenario tests: its form on the page (V1), else the plan's only form (V0). */
export function formOfScenario(plan: Plan, scenario: Scenario): DiscoveredForm {
  if (scenario.scope === "page") return plan.form;
  return plan.page?.forms[scenario.formIndex ?? 0] ?? plan.form;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One line on what the plan covers, for the CLI and the web UI: `Found "Book a sitter" with 8 fields; 20 scenarios
 * planned.` for one form; with several forms, each form and its field count; with controls outside the forms, how many.
 * A plan made signed in starts with "Signed in as <label>." (0.4.0).
 */
export function planSummary(plan: Plan): string {
  const forms = plan.page?.forms ?? [plan.form];
  const named = (f: DiscoveredForm) => (f.name ? `"${f.name}"` : f.search ? "a search form" : "a form");
  let found: string;
  if (forms.length === 0) found = "no form";
  else if (forms.length === 1) found = `${named(forms[0]!)} with ${count(forms[0]!.fields.length, "field")}`;
  else found = `${count(forms.length, "form")} (${forms.map((f) => `${named(f)}: ${count(f.fields.length, "field")}`).join(", ")})`;
  const controls = plan.page?.controls.length ?? 0;
  const outside = controls > 0 ? ` and ${count(controls, "control")} outside ${forms.length === 1 ? "it" : "them"}` : "";
  const account = plan.account ? `Signed in as ${plan.account.label}. ` : "";
  return `${account}Found ${found}${outside}; ${count(plan.scenarios.length, "scenario")} planned.`;
}
