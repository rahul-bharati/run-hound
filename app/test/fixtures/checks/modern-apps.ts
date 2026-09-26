/**
 * Small single-page apps built the way AI app builders build them (react-hook-form + zod behaviour, no native
 * `required`, sonner toasts, client-side routing with history.pushState), without a framework, for the feature
 * checks' tests (persistence, double-submit, keyboard-completion, silent-failure).
 *
 * Every GET outside /api answers the same page; the script renders by location.pathname, like a React Router app.
 */
import { json, startFixtureServer, type FixtureServer, type RouteHandler } from "../../../test-support/server.js";

export interface ModernField {
  name: string;
  label: string;
  /** Input type; "textarea" for a textarea. */
  type: "text" | "email" | "tel" | "password" | "textarea";
}

export interface ModernAppOptions {
  /** Path of the form page, e.g. "/contact". */
  path: string;
  heading: string;
  fields: ModernField[];
  submitLabel: string;
  /**
   * What the app does after a 2xx:
   * - "toast": a sonner-style toast "Thanks, <name>!" and the form is reset; nothing is listed anywhere.
   * - "welcome": pushState to /welcome, which greets the user by the name kept in history.state.
   * - "list": the saved records are listed under the form (rendered from GET /api/records).
   * - "records-page": pushState to /records, which lists the saved records (rendered from GET /api/records).
   */
  after: "toast" | "welcome" | "list" | "records-page";
  /** CSS for each listed record, e.g. "text-transform: uppercase". */
  recordCss?: string;
  /** Show saved phone numbers as "(555) 014-2123" instead of as typed. */
  formatPhone?: boolean;
  /** Fields the server saves but never lists. */
  unlisted?: string[];
  /**
   * A two-step wizard: the first field alone on step 1 with a "Continue" submit button (no request), the other
   * fields on step 2, whose submit saves everything.
   */
  wizard?: boolean;
  /** Script run once on load, before the first render (e.g. a page-load POST, like a GraphQL query). */
  onLoad?: string;
  /** Extra script run after the save request succeeded, before the page updates. */
  afterSave?: string;
  /**
   * How records are saved and read: "rest" (POST and GET /api/records) or "graphql" (every call is a POST to
   * /graphql, as Apollo Client sends them: a query on load and after each save, a mutation to save).
   */
  api?: "rest" | "graphql";
  /** Keep the submit button enabled while saving (no double-submit guard). */
  noGuard?: boolean;
  /** How long the server takes to answer a save, in ms. */
  saveDelayMs?: number;
  /** Extra routes (win over the built-in ones). */
  routes?: Record<string, RouteHandler>;
}

export interface ModernApp extends FixtureServer {
  /** Records the API saved, in order. */
  records: Record<string, unknown>[];
  /** Full URL of the form page. */
  formUrl: string;
}

function page(o: ModernAppOptions): string {
  const cfg = JSON.stringify({
    path: o.path,
    heading: o.heading,
    fields: o.fields,
    submitLabel: o.submitLabel,
    after: o.after,
    formatPhone: Boolean(o.formatPhone),
    unlisted: o.unlisted ?? [],
    wizard: Boolean(o.wizard),
    graphql: o.api === "graphql",
    guard: !o.noGuard,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lab</title>
<link rel="icon" href="data:,">
<style>
  body { font-family: system-ui, sans-serif; margin: 0; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
  .field { display: grid; gap: 6px; margin-bottom: 16px; }
  .error { color: #b00020; font-size: 14px; margin: 0; }
  button { padding: 8px 16px; }
  [data-sonner-toaster] { position: fixed; bottom: 24px; right: 24px; width: 356px; list-style: none; margin: 0; padding: 0; }
  [data-sonner-toast] { position: absolute; bottom: 0; right: 0; width: 356px; padding: 16px; background: #fff; border: 1px solid #ccc; }
  #records li { ${o.recordCss ?? ""} }
</style>
</head>
<body>
<main id="app"></main>
<section aria-label="Notifications alt+T" tabindex="-1" aria-live="polite" aria-relevant="additions text" aria-atomic="false" id="toasts"></section>
<script>
var cfg = ${cfg};
var draft = {};
var step = 1;
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function toast(text) {
  var host = document.getElementById("toasts");
  var ol = host.querySelector("ol");
  if (!ol) { ol = document.createElement("ol"); ol.setAttribute("data-sonner-toaster", "true"); host.appendChild(ol); }
  var li = document.createElement("li");
  li.setAttribute("data-sonner-toast", "");
  li.textContent = text;
  ol.appendChild(li);
}
function phone(v) {
  if (!cfg.formatPhone) return v;
  var d = String(v).replace(/\\D/g, "").replace(/^1(?=\\d{10}$)/, "");
  return d.length === 10 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : v;
}
async function gql(query, variables) {
  var res = await fetch("/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: query, variables: variables || {} }) });
  if (!res.ok) throw new Error("status " + res.status);
  return (await res.json()).data;
}
async function loadRecords() {
  if (cfg.graphql) return (await gql("query Records { records { id name email message phone } }")).records;
  return (await fetch("/api/records")).json();
}
async function saveRecord(values) {
  if (cfg.graphql) return gql("mutation AddRecord($input: RecordInput!) { addRecord(input: $input) { id } }", { input: values });
  var res = await fetch("/api/records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
  if (!res.ok) throw new Error("status " + res.status);
}
async function listHtml() {
  var items = await loadRecords();
  return '<ul id="records">' + items.map(function (r) {
    return "<li>" + cfg.fields.filter(function (f) { return f.type !== "password" && cfg.unlisted.indexOf(f.name) < 0; })
      .map(function (f) { return '<span class="' + f.name + '">' + esc(f.type === "tel" ? phone(r[f.name]) : r[f.name]) + "</span>"; }).join(" · ") + "</li>";
  }).join("") + "</ul>";
}
function fieldsForStep() {
  if (!cfg.wizard) return cfg.fields;
  return step === 1 ? cfg.fields.slice(0, 1) : cfg.fields.slice(1);
}
function fieldHtml(f) {
  var control = f.type === "textarea"
    ? '<textarea id="' + f.name + '" name="' + f.name + '"></textarea>'
    : '<input id="' + f.name + '" name="' + f.name + '" type="' + f.type + '">';
  return '<div class="field"><label for="' + f.name + '">' + esc(f.label) + "</label>" + control + '<p class="error" id="' + f.name + '-error"></p></div>';
}
function problem(f, v) {
  if (f.type === "email") return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v) ? null : "Enter a valid email";
  if (f.type === "password") return v.length >= 8 ? null : "Use 8 or more characters";
  return v.trim().length >= 2 ? null : "Enter your " + f.label.toLowerCase();
}
async function renderForm() {
  var fields = fieldsForStep();
  var last = !cfg.wizard || step === 2;
  var steps = cfg.wizard ? '<ol class="steps"><li' + (step === 1 ? ' aria-current="step"' : "") + '>1. Workspace</li><li' + (step === 2 ? ' aria-current="step"' : "") + ">2. Invite</li></ol>" : "";
  document.getElementById("app").innerHTML = "<h1>" + esc(cfg.heading) + "</h1>" + steps +
    '<form id="form" novalidate>' + fields.map(fieldHtml).join("") +
    // Step 2 has a Back button where step 1 had Continue, as shadcn wizards do: a double click on Continue goes back.
    (cfg.wizard && last ? '<button type="button" id="back">Back</button> ' : "") +
    '<button type="submit" id="submit">' + esc(last ? cfg.submitLabel : "Continue") + "</button></form>" +
    (cfg.after === "list" ? '<h2>Saved</h2><div id="list">' + (await listHtml()) + "</div>" : "");
  var back = document.getElementById("back");
  if (back) back.addEventListener("click", function () { step = 1; renderForm(); });
  document.getElementById("form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var ok = true;
    fields.forEach(function (f) {
      var v = document.getElementById(f.name).value;
      var p = problem(f, v);
      document.getElementById(f.name + "-error").textContent = p || "";
      if (p) ok = false;
      draft[f.name] = v;
    });
    if (!ok) return;
    if (!last) { step = 2; return renderForm(); }
    var button = document.getElementById("submit");
    if (cfg.guard) button.disabled = true;
    try {
      await saveRecord(draft);
      if (cfg.graphql) await loadRecords();
      ${o.afterSave ?? ""}
      var name = draft[cfg.fields[0].name];
      if (cfg.after === "toast") { toast("Thanks, " + name + "! We'll get back to you soon."); document.getElementById("form").reset(); }
      else if (cfg.after === "welcome") { history.pushState({ name: name }, "", "/welcome"); render(); }
      else if (cfg.after === "records-page") { history.pushState({}, "", "/records"); render(); }
      else { document.getElementById("list").innerHTML = await listHtml(); document.getElementById("form").reset(); }
    } catch (err) {
      toast("Something went wrong. Please try again.");
    } finally {
      button.disabled = false;
    }
  });
}
async function render() {
  var path = location.pathname;
  if (path === "/welcome") {
    var state = history.state || {};
    document.getElementById("app").innerHTML = "<h1>Welcome</h1><p>Welcome aboard" + (state.name ? ", " + esc(state.name) : "") + "! Let's set up your workspace.</p>";
  } else if (path === "/records") {
    document.getElementById("app").innerHTML = "<h1>Records</h1>" + (await listHtml());
  } else {
    await renderForm();
  }
}
window.addEventListener("popstate", render);
if (cfg.graphql) loadRecords();
${o.onLoad ?? ""}
render();
</script>
</body>
</html>`;
}

export async function startModernApp(options: ModernAppOptions): Promise<ModernApp> {
  const records: Record<string, unknown>[] = [];
  const html = page(options);
  const listed = () => records.map((r) => ({ ...r, password: undefined }));
  const save = async (body: Record<string, unknown>) => {
    await new Promise((r) => setTimeout(r, options.saveDelayMs ?? 0));
    const record = { id: records.length + 1, ...body };
    records.push(record);
    return record;
  };
  const server = await startFixtureServer({
    routes: {
      "GET /api/records": (_req, res) => json(res, 200, listed()),
      "POST /api/records": async (req, res) => {
        const record = await save(JSON.parse(req.body || "{}") as Record<string, unknown>);
        json(res, 201, { id: record.id });
      },
      "POST /graphql": async (req, res) => {
        const body = JSON.parse(req.body || "{}") as { query?: string; variables?: { input?: Record<string, unknown> } };
        if (/^\s*mutation/.test(body.query ?? "")) {
          const record = await save(body.variables?.input ?? {});
          return json(res, 200, { data: { addRecord: { id: record.id } } });
        }
        json(res, 200, { data: { records: listed() } });
      },
      ...options.routes,
    },
    fallback: (req, res) => {
      if (req.method !== "GET" || req.url.startsWith("/api/")) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    },
  });
  return { ...server, records, formUrl: `${server.url}${options.path}` };
}

/** The fields of a contact form (full name, work email, message), as a Lovable contact page has them. */
export const CONTACT_FIELDS: ModernField[] = [
  { name: "name", label: "Full name", type: "text" },
  { name: "email", label: "Work email", type: "email" },
  { name: "message", label: "Message", type: "textarea" },
];

/** The fields of a sign-up form (full name, work email, password). */
export const SIGNUP_FIELDS: ModernField[] = [
  { name: "name", label: "Full name", type: "text" },
  { name: "email", label: "Work email", type: "email" },
  { name: "password", label: "Password", type: "password" },
];
