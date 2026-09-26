/**
 * A react-hook-form + zod style "Quick add" form (LOV-6, RH-08, RH-10), as AI app builders make them: nothing in the
 * markup says which fields are required. The page's script does: "Task" and "Email" can't be empty, "Notes" is
 * optional. The form posts JSON to /api/tasks and lists the saved tasks under it (loaded from GET /api/tasks).
 *
 * Options change one thing each:
 * - errors: "accessible" (default) marks a refused field aria-invalid="true" with aria-describedby pointing at its
 *   message, like shadcn's FormControl/FormMessage; "text" shows red text next to the field only (W10-style).
 * - validate: false makes the page check nothing and send whatever is typed (no client-side rules at all).
 * - serverChecks: false makes the server save an empty task or email (201) instead of answering 400.
 * - taskMinLength: the page's rule for Task also needs that many characters, which Run Hound's test values break.
 * - response: "echo" (default) answers a save with the saved task ({ id, ...task }); "id" with { id } only.
 * - list: false never lists saved tasks after a reload (the list only shows what was added since the page loaded).
 * - listFields: what each listed task shows (default all three: title, email and notes), like a list of cards that
 *   shows a summary of each record.
 * - reactTextarea: the Notes text area mirrors its value into its text content (defaultValue), as React does for a
 *   controlled <textarea>, so the typed text is also a text node of the page.
 */
import { json, startFixtureServer, type FixtureServer, type RecordedRequest } from "../../../test-support/server.js";

export interface SchemaFormOptions {
  errors?: "accessible" | "text";
  validate?: boolean;
  serverChecks?: boolean;
  taskMinLength?: number;
  response?: "echo" | "id";
  list?: boolean;
  listFields?: ("title" | "email" | "notes")[];
  reactTextarea?: boolean;
}

export interface SchemaFormApp extends FixtureServer {
  /** The page with the form. */
  formUrl: string;
  /** Tasks the server saved. */
  tasks: Record<string, unknown>[];
  /** Parsed bodies of every POST /api/tasks that reached the server (saved or refused). */
  posts(): Record<string, unknown>[];
}

function page(o: Required<SchemaFormOptions>): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tasks</title><link rel="icon" href="data:,">
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; color: #111; background: #fff; line-height: 1.5; }
  main { max-width: 520px; }
  .item { margin: 0 0 16px; }
  label { display: block; font-weight: 600; }
  input, textarea { display: block; width: 100%; padding: 6px 8px; font-size: 16px; border: 1px solid #555; border-radius: 4px; color: #111; background: #fff; }
  button { min-height: 44px; padding: 8px 16px; font-size: 16px; color: #111; background: #e8e8e8; border: 1px solid #555; border-radius: 4px; }
  .msg { color: #b00020; font-size: 14px; margin: 4px 0 0; }
</style></head>
<body><main>
<h1>Tasks</h1>
<form id="quick-add" novalidate aria-labelledby="qa-title">
  <h2 id="qa-title">Quick add</h2>
  <div class="item"><label for="task">Task</label><input id="task" name="title"><p id="task-msg" class="msg"></p></div>
  <div class="item"><label for="email">Email</label><input id="email" name="email" type="email"><p id="email-msg" class="msg"></p></div>
  <div class="item"><label for="notes">Notes</label><textarea id="notes" name="notes"></textarea><p id="notes-msg" class="msg"></p></div>
  <button type="submit">Add task</button>
</form>
<p id="status" role="status"></p>
<h2>Your tasks</h2>
<ul id="tasks"></ul>
</main>
<script>
(function () {
  var cfg = ${JSON.stringify(o)};
  var $ = function (id) { return document.getElementById(id); };
  var form = $("quick-add");
  var fields = { title: "task", email: "email", notes: "notes" };
  function render(tasks) {
    var list = $("tasks");
    list.innerHTML = "";
    tasks.forEach(function (t) { var li = document.createElement("li"); li.textContent = cfg.listFields.map(function (k) { return t[k]; }).filter(Boolean).join(" · "); list.appendChild(li); });
  }
  var tasks = [];
  if (cfg.reactTextarea) $("notes").addEventListener("input", function (e) { e.target.defaultValue = e.target.value; });
  if (cfg.list) fetch("/api/tasks").then(function (r) { return r.json(); }).then(function (t) { tasks = t; render(tasks); });
  function clearErrors() {
    Object.keys(fields).forEach(function (k) {
      var el = $(fields[k]);
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
      $(fields[k] + "-msg").textContent = "";
    });
  }
  function showError(key, text) {
    var el = $(fields[key]);
    $(fields[key] + "-msg").textContent = text;
    if (cfg.errors === "accessible") {
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", fields[key] + "-msg");
    }
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearErrors();
    var values = { title: $("task").value.trim(), email: $("email").value.trim(), notes: $("notes").value.trim() };
    var bad = [];
    if (cfg.validate) {
      if (!values.title) bad.push(["title", "Task is required"]);
      else if (cfg.taskMinLength && values.title.length < cfg.taskMinLength) bad.push(["title", "Task must be at least " + cfg.taskMinLength + " characters"]);
      if (!values.email) bad.push(["email", "Email is required"]);
      else if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(values.email)) bad.push(["email", "Enter a valid email"]);
    }
    if (bad.length) {
      bad.forEach(function (b) { showError(b[0], b[1]); });
      if (cfg.errors === "accessible") $(fields[bad[0][0]]).focus();
      return;
    }
    fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function () { tasks = tasks.concat([values]); render(tasks); $("status").textContent = "Task added"; if (!cfg.reactTextarea) form.reset(); })
      .catch(function () { $("status").textContent = "Could not add the task. Please try again."; });
  });
})();
</script></body></html>`;
}

function parse(req: RecordedRequest): Record<string, unknown> {
  try {
    return JSON.parse(req.body || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function startSchemaFormApp(options: SchemaFormOptions = {}): Promise<SchemaFormApp> {
  const o: Required<SchemaFormOptions> = {
    errors: options.errors ?? "accessible",
    validate: options.validate ?? true,
    serverChecks: options.serverChecks ?? true,
    taskMinLength: options.taskMinLength ?? 0,
    response: options.response ?? "echo",
    list: options.list ?? true,
    listFields: options.listFields ?? ["title", "email", "notes"],
    reactTextarea: options.reactTextarea ?? false,
  };
  const tasks: Record<string, unknown>[] = [];
  const server = await startFixtureServer({
    pages: { "/tasks": page(o) },
    routes: {
      "GET /api/tasks": (_req, res) => json(res, 200, tasks),
      "POST /api/tasks": (req, res) => {
        const body = parse(req);
        const empty = ["title", "email"].filter((k) => typeof body[k] !== "string" || String(body[k]).trim() === "");
        if (o.serverChecks && empty.length > 0) return json(res, 400, { errors: Object.fromEntries(empty.map((k) => [k, "Required"])) });
        const task = { id: tasks.length + 1, ...body };
        tasks.push(task);
        json(res, 201, o.response === "echo" ? task : { id: task.id });
      },
    },
  });
  return {
    ...server,
    formUrl: `${server.url}/tasks`,
    tasks,
    posts: () => server.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/tasks")).map(parse),
  };
}
