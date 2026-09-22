/**
 * Small Kennel-like booking form used by the behaviour-check tests (console-network-errors, dead-control,
 * silent-failure, persistence, double-submit, verbose-errors, client-only-validation).
 *
 * Each test builds a GOOD and a BAD variant by flipping one client or server behaviour, so a check that
 * passes GOOD and fails BAD is reacting to exactly that behaviour.
 */
import { json, startFixtureServer, type FixtureServer, type RecordedRequest, type RouteHandler } from "../../../../test-support/server.js";
import type { DiscoveredForm } from "../../../../src/core/types.js";

/** How the page reacts when the create request does not succeed. */
export type ErrorMode =
  /** Message in a role="alert" element; inputs kept. */
  | "alert"
  /** Message in an aria-live="polite" region that exists from page load; inputs kept. */
  | "live-region"
  /** Message in a plain element that receives focus (tabindex=-1); inputs kept. */
  | "focus"
  /** Message visible in a plain element: not a live region, no alert role, focus not moved. */
  | "unannounced"
  /** Nothing: "Sending..." stays forever and the button stays disabled. */
  | "spinner"
  /** Announced message, but the form is reset so the user's input is lost. */
  | "reset-form";

export interface ClientOptions {
  /** URL fetched on load. Default "/api/availability". null skips it. */
  availabilityUrl?: string | null;
  /** Default "disable" (Book disabled while pending). */
  submitGuard?: "disable" | "in-flight-flag" | "none";
  /** Default "alert". */
  errorMode?: ErrorMode;
  /** Delay before the error message appears. */
  errorDelayMs?: number;
  /** Append `body.stack` from an error response to the visible message. */
  showStack?: boolean;
  /** Client-side "end date on or after start date" check. Default true. */
  dateOrderCheck?: boolean;
  /** Send an x-csrf-token header read from a meta tag. */
  csrfToken?: string;
  /** Extra HTML inside the form, before the Book button. */
  extraHtml?: string;
  /** Extra script run after the main script. */
  extraScript?: string;
  /** Exact [from, to] substitutions applied to the rendered HTML (each `from` must exist). */
  replaceHtml?: [from: string, to: string][];
}

export const REQUIRED_FIELDS = ["petName", "petType", "startDate", "endDate", "email"] as const;
/** Fields rendered in "Your bookings". Passwords are never rendered. */
export const RENDERED_FIELDS = ["petName", "petType", "startDate", "endDate", "email", "phone", "notes"] as const;

/** An obviously fake CSRF token used by the replay tests. */
export const FAKE_CSRF_TOKEN = "csrf-FAKE-t3st-0000";

export function bookingPage(options: ClientOptions = {}): string {
  const cfg = {
    availabilityUrl: options.availabilityUrl === undefined ? "/api/availability" : options.availabilityUrl,
    submitGuard: options.submitGuard ?? "disable",
    errorMode: options.errorMode ?? "alert",
    errorDelayMs: options.errorDelayMs ?? 0,
    showStack: options.showStack ?? false,
    dateOrderCheck: options.dateOrderCheck ?? true,
    csrf: options.csrfToken ? true : false,
    required: REQUIRED_FIELDS,
    rendered: RENDERED_FIELDS,
  };
  const errorAttrs: Record<ErrorMode, string> = {
    alert: 'role="alert"',
    "live-region": 'aria-live="polite"',
    focus: 'tabindex="-1"',
    unannounced: "",
    spinner: 'role="alert"',
    "reset-form": 'role="alert"',
  };
  const csrfMeta = options.csrfToken ? `<meta name="csrf-token" content="${options.csrfToken}">` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
${csrfMeta}
<title>Book a sitter</title>
<style>
  body { font-family: sans-serif; max-width: 40rem; margin: 1rem auto; }
  label, fieldset { display: block; margin-top: .75rem; }
  #error { color: #a00000; white-space: pre-wrap; }
  .tips[hidden] { display: none; }
</style>
</head>
<body>
<main>
<h1>Book a sitter</h1>
<form id="booking" novalidate>
  <label for="petName">Pet name</label>
  <input id="petName" name="petName" required>
  <fieldset>
    <legend>Pet type</legend>
    <label><input type="radio" name="petType" value="Dog" required> Dog</label>
    <label><input type="radio" name="petType" value="Cat"> Cat</label>
    <label><input type="radio" name="petType" value="Other"> Other</label>
  </fieldset>
  <label for="startDate">Start date</label>
  <input type="date" id="startDate" name="startDate" required>
  <label for="endDate">End date</label>
  <input type="date" id="endDate" name="endDate" required>
  <label for="email">Owner email</label>
  <input type="email" id="email" name="email" required autocomplete="email">
  <label for="phone">Phone</label>
  <input type="tel" id="phone" name="phone" autocomplete="tel">
  <label for="notes">Special instructions</label>
  <textarea id="notes" name="notes"></textarea>
  <fieldset>
    <legend>Create an account (optional)</legend>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="new-password">
    <label for="confirmPassword">Confirm password</label>
    <input type="password" id="confirmPassword" name="confirmPassword" autocomplete="new-password">
  </fieldset>
  <p class="help">Sitters arrive at 9 am. Questions? Email help@example.test.</p>
  ${options.extraHtml ?? ""}
  <button type="submit" id="book">Book</button>
  <p id="status"></p>
  <div id="error" ${errorAttrs[cfg.errorMode]}></div>
</form>
<section>
  <h2>Your bookings</h2>
  <ul id="bookings"></ul>
</section>
</main>
<script>
(function () {
  var cfg = ${JSON.stringify(cfg)};
  var form = document.getElementById("booking");
  var book = document.getElementById("book");
  var statusEl = document.getElementById("status");
  var errorBox = document.getElementById("error");
  var list = document.getElementById("bookings");
  var inFlight = false;

  function render(items) {
    list.innerHTML = "";
    items.forEach(function (b) {
      var li = document.createElement("li");
      li.textContent = cfg.rendered.map(function (k) { return b[k] || ""; }).filter(Boolean).join(" | ");
      list.appendChild(li);
    });
  }

  async function loadBookings() {
    var res = await fetch("/api/bookings");
    if (!res.ok) throw new Error("Could not load bookings (" + res.status + ")");
    render(await res.json());
  }

  function showError(message) {
    function apply() {
      errorBox.textContent = message;
      if (cfg.errorMode === "focus") errorBox.focus();
      if (cfg.errorMode === "reset-form") form.reset();
    }
    if (cfg.errorDelayMs) setTimeout(apply, cfg.errorDelayMs); else apply();
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (cfg.submitGuard === "in-flight-flag" && inFlight) return;
    var data = Object.fromEntries(new FormData(form).entries());
    errorBox.textContent = "";
    var missing = cfg.required.filter(function (k) { return !data[k]; });
    if (missing.length) { errorBox.textContent = "Please fill in: " + missing.join(", "); return; }
    if (cfg.dateOrderCheck && data.endDate < data.startDate) {
      errorBox.textContent = "End date must be on or after the start date.";
      return;
    }
    inFlight = true;
    if (cfg.submitGuard === "disable") book.disabled = true;
    statusEl.textContent = "Sending…";
    var headers = { "content-type": "application/json" };
    if (cfg.csrf) headers["x-csrf-token"] = document.querySelector('meta[name="csrf-token"]').content;
    var res = null;
    try {
      res = await fetch("/api/bookings", { method: "POST", headers: headers, body: JSON.stringify(data) });
    } catch (e) {
      res = null;
    }
    if (cfg.errorMode === "spinner" && (!res || !res.ok)) return;
    var body = null;
    try { body = res ? await res.json() : null; } catch (e) { body = null; }
    inFlight = false;
    book.disabled = false;
    if (res && res.ok) {
      statusEl.textContent = "Booking saved";
      form.reset();
      await loadBookings();
      return;
    }
    statusEl.textContent = "";
    var message = body && body.errors
      ? Object.values(body.errors).join(" ")
      : (body && body.error) || "Something went wrong. Please try again.";
    if (cfg.showStack && body && body.stack) message += "\\n" + body.stack;
    showError(message);
  });

  if (cfg.availabilityUrl) {
    fetch(cfg.availabilityUrl).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  loadBookings();
})();
</script>
${options.extraScript ? `<script>\n${options.extraScript}\n</script>` : ""}
</body>
</html>`;

  return (options.replaceHtml ?? []).reduce((text, [from, to]) => {
    if (!text.includes(from)) throw new Error(`booking page has no ${JSON.stringify(from)} to replace`);
    return text.replaceAll(from, to);
  }, html);
}

export interface ApiOptions {
  /** Delay before answering POST /api/bookings. */
  delayMs?: number;
  /** Fields the server silently drops before storing (still answers 201). */
  dropFields?: string[];
  /** Server-side "end on or after start" validation. Default true. */
  checkDateOrder?: boolean;
  /** Status for validation errors. Default 400. */
  invalidStatus?: number;
  /** Answer invalid or malformed input with a 500 carrying a Node stack trace (verbose-errors BAD). */
  stackOnBadInput?: boolean;
  /** Answer invalid or malformed input with a bare 500 { error: "Something went wrong" } (no internals). */
  genericErrorOnBadInput?: boolean;
  /** Require this x-csrf-token header on POST (403 otherwise). */
  requireCsrf?: string;
  /** GET /api/bookings answers 500 once at least one booking exists. */
  failListAfterCreate?: boolean;
}

export interface BookingApi {
  routes: Record<string, RouteHandler>;
  /** Bookings the server stored. */
  bookings: Record<string, string>[];
}

/** A fake stack trace with internal file paths, shaped like a Node server crash. */
export const FAKE_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'trim')",
  "    at validateBooking (/srv/kennel/server/bookings.js:42:17)",
  "    at handleCreate (/srv/kennel/server/routes.js:88:5)",
  "    at Server.<anonymous> (/srv/kennel/node_modules/router/index.js:120:12)",
].join("\n");

export function validateBooking(b: Record<string, unknown>, checkDateOrder = true): Record<string, string> {
  const errors: Record<string, string> = {};
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  for (const k of REQUIRED_FIELDS) if (!s(k)) errors[k] = "This field is required.";
  if (s("petName").length > 50) errors.petName = "Pet name must be 50 characters or fewer.";
  if (s("petType") && !["Dog", "Cat", "Other"].includes(s("petType"))) errors.petType = "Choose Dog, Cat or Other.";
  for (const k of ["startDate", "endDate"]) {
    if (s(k) && !/^\d{4}-\d{2}-\d{2}$/.test(s(k))) errors[k] = "Enter a valid date.";
  }
  if (s("email") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s("email"))) errors.email = "Enter a valid email address.";
  if (s("phone").length > 30) errors.phone = "Phone number is too long.";
  if (s("notes").length > 1000) errors.notes = "Special instructions must be 1000 characters or fewer.";
  if (checkDateOrder && s("startDate") && s("endDate") && s("endDate") < s("startDate")) {
    errors.endDate = "End date must be on or after the start date.";
  }
  return errors;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function bookingApi(options: ApiOptions = {}): BookingApi {
  const bookings: Record<string, string>[] = [];
  const routes: Record<string, RouteHandler> = {
    "GET /api/availability": (_req, res) => json(res, 200, { available: true }),
    "GET /api/bookings": (_req, res) => {
      if (options.failListAfterCreate && bookings.length > 0) return json(res, 500, { error: "Something went wrong" });
      json(res, 200, bookings);
    },
    "POST /api/bookings": async (req: RecordedRequest, res) => {
      if (options.delayMs) await sleep(options.delayMs);
      if (options.requireCsrf && req.headers["x-csrf-token"] !== options.requireCsrf) {
        return json(res, 403, { error: "Forbidden" });
      }
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(req.body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        body = parsed as Record<string, unknown>;
      } catch {
        if (options.stackOnBadInput) return json(res, 500, { error: "SyntaxError: Unexpected token in JSON", stack: FAKE_STACK });
        if (options.genericErrorOnBadInput) return json(res, 500, { error: "Something went wrong" });
        return json(res, 400, { error: "Request body must be a JSON object." });
      }
      const errors = validateBooking(body, options.checkDateOrder ?? true);
      if (Object.keys(errors).length > 0) {
        if (options.stackOnBadInput) {
          return json(res, 500, { error: "TypeError: Cannot read properties of undefined (reading 'trim')", stack: FAKE_STACK });
        }
        if (options.genericErrorOnBadInput) return json(res, 500, { error: "Something went wrong" });
        return json(res, options.invalidStatus ?? 400, { errors });
      }
      const stored: Record<string, string> = { id: String(bookings.length + 1) };
      for (const [k, v] of Object.entries(body)) {
        if (typeof v !== "string") continue;
        if (k === "password" || k === "confirmPassword") continue;
        if (options.dropFields?.includes(k)) continue;
        stored[k] = v;
      }
      bookings.push(stored);
      json(res, 201, stored);
    },
  };
  return { routes, bookings };
}

export interface BookingServer {
  server: FixtureServer;
  api: BookingApi;
  /** URL of the form page. */
  url: string;
  /** POST /api/bookings requests the server actually received. */
  createRequests(): RecordedRequest[];
}

/** Starts a booking app on an ephemeral port; the form lives at `${server.url}/book`. */
export async function startBookingApp(
  client: ClientOptions = {},
  api: ApiOptions = {},
  extra: { routes?: Record<string, RouteHandler>; pages?: Record<string, string> } = {},
): Promise<BookingServer> {
  const bookingApiInstance = bookingApi(api);
  const server = await startFixtureServer({
    pages: { "/book": bookingPage(client), ...extra.pages },
    routes: { ...bookingApiInstance.routes, ...extra.routes },
  });
  return {
    server,
    api: bookingApiInstance,
    url: `${server.url}/book`,
    createRequests: () =>
      server.requests.filter((r) => r.method === "POST" && new URL(r.url, "http://x").pathname === "/api/bookings"),
  };
}

/** A hand-written DiscoveredForm matching bookingPage(), for plan() unit tests that need no browser. */
export function sampleForm(url = "http://127.0.0.1:1/book"): DiscoveredForm {
  const text = (key: string, label: string, type: string, required: boolean, role = "textbox") => ({
    key,
    accessibleName: label,
    label,
    placeholder: null,
    type,
    role,
    required,
    selector: `#${key}`,
  });
  return {
    url,
    selector: "#booking",
    name: "Book a sitter",
    fields: [
      { ...text("petName", "Pet name", "text", true) },
      {
        key: "petType",
        accessibleName: "Pet type",
        label: null,
        placeholder: null,
        type: "radio",
        role: "radiogroup",
        required: true,
        selector: 'input[name="petType"]',
        options: ["Dog", "Cat", "Other"].map((v) => ({ label: v, selector: `input[name="petType"][value="${v}"]` })),
      },
      { ...text("startDate", "Start date", "date", true) },
      { ...text("endDate", "End date", "date", true) },
      { ...text("email", "Owner email", "email", true) },
      { ...text("phone", "Phone", "tel", false) },
      { ...text("notes", "Special instructions", "textarea", false) },
      { ...text("password", "Password", "password", false) },
      { ...text("confirmPassword", "Confirm password", "password", false) },
    ],
    controls: [
      { accessibleName: "Save draft", text: "Save draft", role: "button", tag: "button", selector: "#saveDraft", isSubmit: false },
      { accessibleName: "Book", text: "Book", role: "button", tag: "button", selector: "#book", isSubmit: true },
    ],
  };
}
