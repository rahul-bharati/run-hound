/**
 * Shared fixture app for check tests: a small "Book a sitter" form that is CLEAN for every
 * accessibility and security check (the GOOD baseline). Each BAD fixture is the baseline plus one
 * explicit, named change, so a failing test points at exactly one defect.
 *
 * Served by test-support/server.ts: the form lives at /book, the API at POST /api/bookings.
 */
import type { ServerResponse } from "node:http";
import { json, type RecordedRequest, type RouteHandler } from "../../../test-support/server.js";

export interface BookingVariant {
  /** Extra CSS appended after the baseline styles (later rules win). */
  css?: string;
  /** Extra markup at the end of <head> (e.g. script tags). */
  head?: string;
  /** Extra script run after the baseline script. */
  script?: string;
  /** Exact [from, to] substitutions applied to the baseline HTML. Each `from` must exist. */
  replace?: [from: string, to: string][];
  /** Extra routes (e.g. scripts served at /assets/*.js). */
  routes?: Record<string, RouteHandler>;
}

export const BASELINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Book a sitter</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; color: #1a1a1a; background: #ffffff; line-height: 1.5; }
  main { max-width: 480px; }
  .field { margin: 0 0 16px; padding: 0; border: 0; }
  label.block, legend { display: block; font-weight: 600; margin-bottom: 4px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row input { flex: 1; min-width: 0; }
  input[type=text], input[type=email], input[type=tel], input[type=password] { width: 100%; padding: 8px; font-size: 16px; border: 1px solid #555555; border-radius: 4px; color: #1a1a1a; background: #ffffff; }
  input[type=radio] { width: 24px; height: 24px; margin: 0 8px 0 0; }
  .choice { display: flex; align-items: center; min-height: 44px; }
  button { min-width: 44px; min-height: 44px; padding: 8px 16px; font-size: 16px; color: #1a1a1a; background: #e8e8e8; border: 1px solid #555555; border-radius: 4px; }
  input:focus-visible, button:focus-visible { outline: 3px solid #1a4fd6; outline-offset: 2px; }
  .hint { color: #555555; font-size: 14px; margin: 4px 0 0; }
  .error { color: #b00020; font-size: 14px; margin: 4px 0 0; }
  .alert { color: #b00020; font-weight: 600; }
  .bookings { list-style: none; padding: 0; margin: 0; }
  .bookings li { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .remove { padding: 0; }
</style>
</head>
<body>
<main>
<h1>Book a sitter</h1>
<form id="booking" action="/api/bookings" method="post" novalidate>
  <div class="field">
    <label class="block" for="petName">Pet name</label>
    <div class="row">
      <input id="petName" name="petName" type="text" required maxlength="50" aria-describedby="petName-hint">
      <button type="button" id="clear" aria-label="Clear pet name"><svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2"/></svg></button>
    </div>
    <p class="hint" id="petName-hint">Up to 50 characters.</p>
    <p class="error" id="petName-error" hidden></p>
  </div>

  <fieldset class="field" id="petType-group">
    <legend>Pet type</legend>
    <label class="choice"><input type="radio" name="petType" value="dog" required> Dog</label>
    <label class="choice"><input type="radio" name="petType" value="cat" required> Cat</label>
    <label class="choice"><input type="radio" name="petType" value="other" required> Other</label>
    <p class="error" id="petType-error" hidden></p>
  </fieldset>

  <div class="field">
    <label class="block" for="ownerEmail">Owner email</label>
    <input id="ownerEmail" name="ownerEmail" type="email" required autocomplete="email">
    <p class="error" id="ownerEmail-error" hidden></p>
  </div>

  <div class="field">
    <label class="block" for="phone">Phone (optional)</label>
    <input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="Phone">
  </div>

  <fieldset class="field">
    <legend>Create an account (optional)</legend>
    <label class="block" for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="new-password">
    <label class="block" for="confirmPassword">Confirm password</label>
    <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password">
    <p class="error" id="confirmPassword-error" hidden></p>
  </fieldset>

  <div id="form-error" class="alert" role="alert"></div>
  <div id="status" role="status" aria-live="polite"></div>
  <button type="submit" id="submit">Book</button>
</form>

<section aria-labelledby="bookings-heading">
  <h2 id="bookings-heading">Your bookings</h2>
  <ul class="bookings" id="bookings">
    <li><span>Rex (dog)</span><button type="button" class="remove" aria-label="Remove booking for Rex"><svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2"/></svg></button></li>
    <li><span>Mittens (cat)</span><button type="button" class="remove" aria-label="Remove booking for Mittens"><svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2"/></svg></button></li>
  </ul>
</section>
</main>
<script>
  const ACCESSIBLE_ERRORS = true;
  const form = document.getElementById('booking');
  const statusEl = document.getElementById('status');
  const formError = document.getElementById('form-error');
  const submitButton = document.getElementById('submit');

  document.getElementById('clear').addEventListener('click', () => {
    const input = document.getElementById('petName');
    input.value = '';
    input.focus();
  });
  for (const button of document.querySelectorAll('.remove')) {
    button.addEventListener('click', () => button.closest('li').remove());
  }

  function clearErrors() {
    for (const el of form.querySelectorAll('.error')) { el.hidden = true; el.textContent = ''; }
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const el of form.querySelectorAll('[data-error-linked]')) {
      el.setAttribute('aria-describedby', el.dataset.errorLinked);
      if (!el.dataset.errorLinked) el.removeAttribute('aria-describedby');
      el.removeAttribute('data-error-linked');
    }
    formError.textContent = '';
  }

  function setError(key, message) {
    const errorEl = document.getElementById(key + '-error');
    errorEl.textContent = message;
    errorEl.hidden = false;
    if (!ACCESSIBLE_ERRORS) return;
    for (const control of form.querySelectorAll('[name="' + key + '"]')) {
      control.setAttribute('aria-invalid', 'true');
      const before = control.getAttribute('aria-describedby') || '';
      control.dataset.errorLinked = before;
      control.setAttribute('aria-describedby', (before + ' ' + key + '-error').trim());
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    statusEl.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    const errors = {};
    if (!String(data.petName || '').trim()) errors.petName = 'Enter your pet\\'s name.';
    if (!data.petType) errors.petType = 'Choose a pet type.';
    if (!/^[^@\\s]+@[^@\\s]+$/.test(String(data.ownerEmail || ''))) errors.ownerEmail = 'Enter an email address like name@example.com.';
    if (data.password && data.password !== data.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    const keys = Object.keys(errors);
    if (keys.length > 0) {
      for (const key of keys) setError(key, errors[key]);
      if (ACCESSIBLE_ERRORS) {
        statusEl.textContent = 'Please fix ' + keys.length + ' problem(s) in the form.';
        const first = form.querySelector('[name="' + keys[0] + '"]');
        if (first) first.focus();
      }
      return;
    }
    submitButton.disabled = true;
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        formError.textContent = 'Something went wrong and your booking was not saved. Please try again.';
        return;
      }
      statusEl.textContent = 'Booking confirmed for ' + data.petName + '.';
      if (typeof window.onBooked === 'function') window.onBooked(data);
    } catch {
      formError.textContent = 'Could not reach the server. Please try again.';
    } finally {
      submitButton.disabled = false;
    }
  });
</script>
</body>
</html>
`;

/** Returns the page HTML for a variant; throws if a `replace` target is missing (keeps fixtures honest). */
export function bookingHtml(variant: BookingVariant = {}): string {
  let html = BASELINE_HTML;
  for (const [from, to] of variant.replace ?? []) {
    if (!html.includes(from)) throw new Error(`booking fixture: replace target not found: ${from}`);
    html = html.replace(from, to);
  }
  if (variant.css) html = html.replace("</style>", `${variant.css}\n</style>`);
  if (variant.head) html = html.replace("</head>", `${variant.head}\n</head>`);
  if (variant.script) html = html.replace("</body>", `<script>\n${variant.script}\n</script>\n</body>`);
  return html;
}

/** In-memory bookings API: 201 with the booking for a valid body, 400 with field errors otherwise. */
export function bookingsApi() {
  const created: Record<string, unknown>[] = [];
  const create: RouteHandler = (req: RecordedRequest, res: ServerResponse) => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return json(res, 400, { errors: { body: "Expected JSON" } });
    }
    const errors: Record<string, string> = {};
    if (!body.petName) errors.petName = "Required";
    if (!body.petType) errors.petType = "Required";
    if (!body.ownerEmail) errors.ownerEmail = "Required";
    if (Object.keys(errors).length > 0) return json(res, 400, { errors });
    const booking = { id: created.length + 1, ...body };
    created.push(booking);
    return json(res, 201, booking);
  };
  const list: RouteHandler = (_req, res) => json(res, 200, created);
  return { created, routes: { "POST /api/bookings": create, "GET /api/bookings": list } as Record<string, RouteHandler> };
}

/** Options for startFixtureServer: the form at /book plus the bookings API and any variant routes. */
export function bookingApp(variant: BookingVariant = {}) {
  const api = bookingsApi();
  return {
    created: api.created,
    options: {
      pages: { "/book": bookingHtml(variant) },
      routes: { ...api.routes, ...variant.routes },
    },
  };
}

/** Serves a JavaScript file from a route. */
export function scriptRoute(source: string): RouteHandler {
  return (_req, res) => {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(source);
  };
}
