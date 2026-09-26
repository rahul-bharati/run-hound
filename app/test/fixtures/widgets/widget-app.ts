/**
 * Fixture app for widget filling (0.4.0): the Radix/shadcn "New project" form (radix-form.html) at /projects, a
 * two-step wizard (wizard.html) at /wizard and shadcn radio cards (radio-cards.html) at /plan, with the JSON API
 * they post to.
 *
 * projectForm() is what discovery reports for /projects under the 0.4.0 contract (FormField.widget, nativeSelector,
 * requiredBy), written out by hand so the fill tests don't depend on discovery.
 */
import { readFileSync } from "node:fs";
import type { DiscoveredForm, FormField } from "../../../src/core/types.js";
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../test-support/server.js";

const page = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

/** Keys POST /api/projects needs (like the zod schema); a missing one answers 400. */
const PROJECT_REQUIRED = ["name", "teamSize", "priority", "owner"];

export interface WidgetApp extends FixtureServer {
  /** Parsed JSON bodies of the POSTs to `path`, in order. */
  posts(path: string): Record<string, unknown>[];
}

export async function startWidgetApp(): Promise<WidgetApp> {
  const server = await startFixtureServer({
    pages: { "/projects": page("radix-form.html"), "/wizard": page("wizard.html"), "/plan": page("radio-cards.html") },
    routes: {
      "POST /api/projects": (req, res) => {
        const body = parse(req);
        const missing = PROJECT_REQUIRED.filter((k) => typeof body[k] !== "string" || String(body[k]).trim() === "");
        if (missing.length > 0 || body["terms"] !== true) return json(res, 400, { errors: missing });
        json(res, 201, { id: "p1", ...body });
      },
      "POST /api/workspaces": (req, res) => json(res, 201, { id: "w1", ...parse(req) }),
    },
  });
  return {
    ...server,
    posts: (path) => server.requests.filter((r) => r.method === "POST" && r.url.startsWith(path)).map(parse),
  };
}

function parse(req: RecordedRequest): Record<string, unknown> {
  try {
    return JSON.parse(req.body || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The fields of /projects, as discovery reports them (0.4.0). Keys are the form value names. */
export function projectFields(): Record<string, FormField> {
  // Radix renders a checkbox's aria-hidden "bubble" input right after its button.
  const bubble = (id: string) => `#${id} + input`;
  return {
    name: {
      key: "name",
      accessibleName: "Project name *",
      label: "Project name *",
      placeholder: null,
      type: "text",
      role: "textbox",
      required: true,
      requiredBy: "label",
      selector: "#f-name",
    },
    teamSize: {
      key: "teamSize",
      accessibleName: "Team size",
      label: "Team size",
      placeholder: null,
      type: "select",
      role: "combobox",
      required: false,
      selector: "#f-team",
      widget: "aria-select",
      nativeSelector: "#f-team + select",
      options: [
        { label: "1–5", selector: "#f-team + select > option:nth-child(2)" },
        { label: "6–20", selector: "#f-team + select > option:nth-child(3)" },
        { label: "21–50", selector: "#f-team + select > option:nth-child(4)" },
      ],
    },
    priority: {
      key: "priority",
      accessibleName: null,
      label: "Priority",
      placeholder: null,
      type: "radio",
      role: "radiogroup",
      required: false,
      selector: "#f-priority",
      widget: "aria-radio",
      options: [
        { label: "low", selector: "#f-p-low" },
        { label: "medium", selector: "#f-p-medium" },
        { label: "high", selector: "#f-p-high" },
      ],
    },
    budget: {
      key: "budget",
      // The Radix Slider puts aria-label on its root, so the thumb (the focusable slider) has no name.
      accessibleName: null,
      label: null,
      placeholder: null,
      type: "range",
      role: "slider",
      required: false,
      selector: "#f-budget [role=slider]",
      widget: "aria-slider",
      constraints: { min: "0", max: "50000" },
    },
    notify: {
      key: "notify",
      accessibleName: "Notify the team",
      label: "Notify the team",
      placeholder: null,
      type: "checkbox",
      role: "switch",
      required: false,
      selector: "#f-notify",
      widget: "aria-switch",
      nativeSelector: bubble("f-notify"),
    },
    owner: {
      key: "owner",
      accessibleName: "Owner",
      label: "Owner",
      placeholder: null,
      type: "select",
      role: "combobox",
      required: false,
      selector: "#f-owner",
      // A Popover + cmdk combobox: its choices only exist once it is open, so discovery lists none.
      widget: "aria-select",
    },
    city: {
      key: "city",
      accessibleName: "City",
      label: "City",
      placeholder: null,
      type: "text",
      role: "combobox",
      required: false,
      selector: "#f-city",
      widget: "aria-combobox",
    },
    region: {
      key: "region",
      accessibleName: "Region",
      label: "Region",
      placeholder: null,
      type: "select",
      role: "combobox",
      required: false,
      selector: "#f-region",
      options: [
        { label: "Europe", selector: "#f-region > option:nth-child(2)" },
        { label: "Americas", selector: "#f-region > option:nth-child(3)" },
      ],
    },
    terms: {
      key: "terms",
      accessibleName: "I accept the terms",
      label: "I accept the terms",
      placeholder: null,
      type: "checkbox",
      role: "checkbox",
      required: false,
      selector: "#f-terms",
      widget: "aria-checkbox",
      nativeSelector: bubble("f-terms"),
    },
  };
}

/** The /projects form as discovery reports it. */
export function projectForm(url: string): DiscoveredForm {
  return {
    url,
    index: 0,
    selector: "#project",
    name: "New project",
    fields: Object.values(projectFields()),
    controls: [{ accessibleName: "Create project", text: "Create project", role: "button", tag: "button", selector: "#create", isSubmit: true }],
  };
}

/** The radio cards of /plan as discovery reports them. */
export function planField(): FormField {
  return {
    key: "plan",
    accessibleName: "Plan",
    label: null,
    placeholder: null,
    type: "radio",
    role: "radiogroup",
    required: false,
    selector: "#plan",
    widget: "aria-radio",
    options: ["starter", "team", "studio"].map((p) => ({ label: p, selector: `#plan-${p}` })),
  };
}

/** Step 1 of /wizard as discovery reports it. */
export function wizardForm(url: string): DiscoveredForm {
  return {
    url,
    index: 0,
    selector: "#step-1",
    name: null,
    fields: [
      { key: "workspace", accessibleName: "Workspace name", label: "Workspace name", placeholder: null, type: "text", role: "textbox", required: false, selector: "#ws" },
    ],
    controls: [{ accessibleName: "Continue", text: "Continue", role: "button", tag: "button", selector: "#step-1 button[type=submit]", isSubmit: true }],
  };
}
