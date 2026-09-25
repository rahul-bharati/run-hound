/**
 * The "/" landing page and its API (CONTRACT.md "/ Landing", "API", W01, W02): the marketing endpoints, the sticky
 * header, the hero Waitlist form, the "Book a demo" dialog form, logo cloud, bento features, pricing with the
 * "Bill yearly" switch, the testimonials carousel, the FAQ accordion and the footer Newsletter form, in clean mode
 * and with W01 / W02 on.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Locator, Page, Request, Route } from "playwright";
import { images } from "../src/lib/images";
import { COMPANY_SIZES, MESSAGES, TEAM_SIZES } from "../server/routes/marketing.mjs";
import { api, axeViolations, closeBrowser, horizontalOverflow, openPage, STACK_RE, useFernway } from "./support.js";

afterAll(async () => {
  await closeBrowser();
});

const TITLE = "Fernway: Project planning for small studios";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Error wording Run Hound's silent-failure check looks for (app/src/checks/silent-failure.ts). */
const ERROR_WORDS = /error|wrong|fail|could not|couldn't|can't|cannot|unable|problem|try again|sorry|unavailable/i;

let counter = 0;
const uniqueEmail = (prefix = "lead") => `${prefix}-${Date.now().toString(36)}-${++counter}@studio.test`;

/** A date N days from today (local), as YYYY-MM-DD. */
function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const validDemo = (overrides: Record<string, unknown> = {}) => ({
  name: "Ada Lovelace",
  email: uniqueEmail("demo"),
  companySize: "11–50",
  date: isoInDays(7),
  message: "Timelines and client portals",
  consent: true,
  ...overrides,
});

// ---- page helpers --------------------------------------------------------------------------------

const waitlistForm = (page: Page) => page.getByRole("form", { name: "Join the waitlist" });
const newsletterForm = (page: Page) => page.getByRole("form", { name: "Get product updates" });
const demoDialog = (page: Page) => page.getByRole("dialog", { name: "Book a demo" });
const toasts = (page: Page) => page.locator("[data-sonner-toast]");

/** Picks an option in a Radix Select (the trigger is a role=combobox button). */
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect.poll(() => trigger.textContent()).toContain(option);
}

async function fillWaitlist(page: Page, email: string, size = "6–20") {
  const form = waitlistForm(page);
  await form.getByLabel("Work email").fill(email);
  await choose(page, form.getByRole("combobox", { name: "Team size" }), size);
}

async function openDemo(page: Page) {
  await page.getByRole("button", { name: "Book a demo" }).click();
  const dialog = demoDialog(page);
  await dialog.waitFor();
  return dialog;
}

async function fillDemo(page: Page, dialog: Locator, values: { name: string; email: string; size?: string; date?: string; message?: string; consent?: boolean }) {
  await dialog.getByLabel("Full name").fill(values.name);
  await dialog.getByLabel("Work email").fill(values.email);
  await choose(page, dialog.getByRole("combobox", { name: "Company size" }), values.size ?? "11–50");
  await dialog.getByLabel("Preferred date").fill(values.date ?? isoInDays(7));
  await dialog.getByLabel("What would you like to see?").fill(values.message ?? "Client portals");
  if (values.consent ?? true) await dialog.getByRole("checkbox", { name: "I agree to be contacted" }).check();
}

/** The element ids in aria-describedby, and the visible text of each (all must exist). */
async function describedByTexts(page: Page, control: Locator): Promise<string[]> {
  const ids = ((await control.getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
  const texts: string[] = [];
  for (const id of ids) {
    const el = page.locator(`[id="${id}"]`);
    expect(await el.count(), `aria-describedby target #${id}`).toBe(1);
    expect(await el.isVisible(), `#${id} is visible`).toBe(true);
    texts.push(((await el.textContent()) ?? "").trim());
  }
  return texts;
}

/**
 * Waits until an option (with this text, when given) has keyboard focus. Radix Select focuses its list once it is
 * positioned, and moves focus on ArrowDown/ArrowUp in a setTimeout, so a key pressed in the same instant still lands
 * on the previous option.
 */
const waitForOptionFocus = (page: Page, text?: string) =>
  expect
    .poll(() => page.evaluate(() => (document.activeElement?.getAttribute("role") === "option" ? (document.activeElement.textContent ?? "").trim() : null)))
    .toSatisfy((focused: string | null) => focused !== null && (text === undefined || focused === text));

/** Holds matching requests until release() (to observe the pending state), then lets them through. */
async function holdRequests(page: Page, pattern: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(pattern, async (route: Route) => {
    await gate;
    await route.continue();
  });
  return { release };
}

/** Answers matching POSTs with a 500 (by interception, like Run Hound's silent-failure check). */
async function failRequests(page: Page, pattern: string, how: "500" | "network" = "500") {
  await page.route(pattern, (route) =>
    how === "network"
      ? route.abort("connectionrefused")
      : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong" }) }),
  );
}

/** Every text a user can read on the page, plus every field value (the persistence check's view). */
const visibleText = (page: Page) =>
  page.evaluate(() =>
    [document.body.innerText, ...Array.from(document.querySelectorAll("input, textarea, select")).map((el) => (el as HTMLInputElement).value)].join("\n"),
  );

const posts = (requests: Request[], path: string) => requests.filter((r) => r.method() === "POST" && new URL(r.url()).pathname === path);

/**
 * Text that sits (partly) outside the viewport horizontally: content an `overflow: hidden/clip` ancestor would cut
 * off without making the page scroll. Decorative (aria-hidden) and inert parts, like the carousel's other slides, are
 * skipped.
 */
const textOutsideViewport = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll("header *, main *, footer *"))
      .filter((el) => !el.closest("[aria-hidden=true], [inert]") && el.children.length === 0 && (el.textContent ?? "").trim() !== "")
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && (r.right > width + 1 || r.left < -1);
      })
      .map((el) => `${(el.textContent ?? "").trim().slice(0, 40)} (${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)})`);
  });

async function expectFocusRing(page: Page, control: Locator, what: string) {
  const ring = await control.evaluate((el) => {
    const s = getComputedStyle(el);
    return { shadow: s.boxShadow, outline: s.outlineStyle === "none" ? "" : `${s.outlineWidth} ${s.outlineStyle}` };
  });
  expect(ring.shadow !== "none" || ring.outline !== "", `${what} shows a focus ring`).toBe(true);
}

// ---- API -----------------------------------------------------------------------------------------

describe("marketing API (clean mode)", () => {
  const ref = useFernway("none");
  const post = (path: string, body: unknown, headers?: Record<string, string>) => api(ref.fw, path, { method: "POST", body, headers });

  it("POST /api/waitlist answers 201 { id, email, teamSize, position } and counts up from #1284", async () => {
    const first = await post("/api/waitlist", { email: " Ada@Studio.test ", teamSize: "6–20", admin: true });
    expect(first.status).toBe(201);
    expect(Object.keys(first.body).sort()).toEqual(["email", "id", "position", "teamSize"]);
    expect(first.body).toMatchObject({ email: "ada@studio.test", teamSize: "6–20", position: 1284 });
    expect(first.body.id).toMatch(UUID_RE);
    const second = await post("/api/waitlist", { email: "grace@studio.test", teamSize: "51+" });
    expect(second.status).toBe(201);
    expect(second.body.position).toBe(1285);
  });

  it("the same email twice answers 409 on the email field (case-insensitive)", async () => {
    expect((await post("/api/waitlist", { email: "ada@studio.test", teamSize: "1–5" })).status).toBe(201);
    const again = await post("/api/waitlist", { email: "ADA@studio.test", teamSize: "21–50" });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ errors: { email: "This email is already on the list" } });
  });

  it("validates the waitlist body: 400 { errors } per field", async () => {
    const empty = await post("/api/waitlist", {});
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ errors: { email: MESSAGES.emailRequired, teamSize: MESSAGES.teamSizeRequired } });
    const bad = await post("/api/waitlist", { email: "not-an-email", teamSize: "1-5" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors).sort()).toEqual(["email", "teamSize"]);
    const wrongType = await post("/api/waitlist", { email: 42, teamSize: "1–5" });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.errors.email).toBeTruthy();
  });

  it("offers exactly the contract's team sizes", () => {
    expect(TEAM_SIZES).toEqual(["1–5", "6–20", "21–50", "51+"]);
    expect(COMPANY_SIZES).toHaveLength(4);
  });

  it("POST /api/demo-requests saves a request (201) and ignores unknown keys", async () => {
    const input = validDemo();
    const res = await post("/api/demo-requests", { ...input, role: "admin" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...input, email: input.email.toLowerCase() });
    expect(res.body.id).toMatch(UUID_RE);
    expect(res.body).not.toHaveProperty("role");
  });

  it("validates the demo request: required fields, consent, company size and a date that is not in the past", async () => {
    const empty = await post("/api/demo-requests", {});
    expect(empty.status).toBe(400);
    expect(empty.body.errors).toEqual({
      name: MESSAGES.nameRequired,
      email: MESSAGES.emailRequired,
      companySize: MESSAGES.companySizeRequired,
      date: MESSAGES.dateRequired,
      consent: MESSAGES.consentRequired,
    });
    const past = await post("/api/demo-requests", validDemo({ date: "2020-01-01" }));
    expect(past.status).toBe(400);
    expect(past.body.errors).toEqual({ date: MESSAGES.datePast });
    const noConsent = await post("/api/demo-requests", validDemo({ consent: false }));
    expect(noConsent.body.errors).toEqual({ consent: MESSAGES.consentRequired });
    const badSize = await post("/api/demo-requests", validDemo({ companySize: "huge" }));
    expect(Object.keys(badSize.body.errors)).toEqual(["companySize"]);
    const longMessage = await post("/api/demo-requests", validDemo({ message: "x".repeat(1001) }));
    expect(Object.keys(longMessage.body.errors)).toEqual(["message"]);
  });

  it('the name "Crash" (after trim) makes the demo request fail with a bare 500', async () => {
    const res = await post("/api/demo-requests", validDemo({ name: "  Crash " }));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong" });
    expect(JSON.stringify(res.body)).not.toMatch(STACK_RE);
  });

  it("POST /api/newsletter answers 201 without echoing the address; signing up twice keeps one subscription", async () => {
    const email = uniqueEmail("news");
    const first = await post("/api/newsletter", { email });
    expect(first.status).toBe(201);
    expect(first.body.id).toMatch(UUID_RE);
    expect(JSON.stringify(first.body)).not.toContain(email);
    const second = await post("/api/newsletter", { email: email.toUpperCase() });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    const bad = await post("/api/newsletter", { email: "nope" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors)).toEqual(["email"]);
    expect((await post("/api/newsletter", {})).body).toEqual({ errors: { email: MESSAGES.newsletterEmailRequired } });
  });

  it("a repeated Idempotency-Key replays the first answer and saves once", async () => {
    const headers = { "idempotency-key": "waitlist-double-click" };
    const body = { email: "once@studio.test", teamSize: "1–5" };
    const [a, b] = await Promise.all([post("/api/waitlist", body, headers), post("/api/waitlist", body, headers)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body).toEqual(a.body);
    const next = await post("/api/waitlist", { email: "next@studio.test", teamSize: "1–5" });
    expect(next.body.position).toBe(1285);

    const demoKey = { "idempotency-key": "demo-key" };
    const input = validDemo();
    const d1 = await post("/api/demo-requests", input, demoKey);
    const d2 = await post("/api/demo-requests", input, demoKey);
    expect(d2.body.id).toBe(d1.body.id);
    expect(d2.headers.get("idempotent-replayed")).toBe("true");
  });

  it("POST /api/__reset clears the waitlist, demo requests and newsletter", async () => {
    await post("/api/waitlist", { email: "reset@studio.test", teamSize: "1–5" });
    await ref.fw.reset();
    const again = await post("/api/waitlist", { email: "reset@studio.test", teamSize: "1–5" });
    expect(again.status).toBe(201);
    expect(again.body.position).toBe(1284);
  });

  it("GET on the marketing endpoints is an API 404", async () => {
    for (const path of ["/api/waitlist", "/api/demo-requests", "/api/newsletter"]) {
      const res = await api(ref.fw, path);
      expect(res.status, path).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    }
  });
});

// ---- the page in a browser (clean mode) ----------------------------------------------------------

describe("/ landing page (clean mode)", () => {
  const ref = useFernway("none");

  it("loads with one h1, landmarks, the title and no errors or failed requests", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      await page.getByRole("heading", { level: 1 }).waitFor();
      expect(await page.title()).toBe(TITLE);
      expect(await page.locator("h1").count()).toBe(1);
      expect(await page.locator("main#main").count()).toBe(1);
      expect(await page.getByRole("banner").count()).toBe(1);
      expect(await page.getByRole("contentinfo").count()).toBe(1);
      expect(await page.getByRole("navigation", { name: "Main" }).count()).toBe(1);
      for (const id of ["features", "pricing", "faq"]) expect(await page.locator(`section#${id}`).count(), id).toBe(1);
      expect(events.consoleErrors).toEqual([]);
      expect(events.pageErrors).toEqual([]);
      expect(events.failedRequests).toEqual([]);
      expect(events.badResponses).toEqual([]);
      expect(events.requests.every((r) => r.url().startsWith(ref.fw.url))).toBe(true);
      // Every image the page asked for loaded.
      const broken = await page.evaluate(() => Array.from(document.images).filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src));
      expect(broken).toEqual([]);
    } finally {
      await close();
    }
  });

  it("header: logo link, in-page nav anchors, theme toggle, Sign in and Get started", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const header = page.getByRole("banner");
      expect(await header.getByRole("link", { name: "Fernway" }).getAttribute("href")).toBe("/");
      const nav = page.getByRole("navigation", { name: "Main" });
      for (const [label, hash] of [
        ["Features", "#features"],
        ["Pricing", "#pricing"],
        ["FAQ", "#faq"],
      ] as const) {
        expect(await nav.getByRole("link", { name: label, exact: true }).getAttribute("href")).toBe(`/${hash}`);
      }
      expect(await header.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
      expect(await header.getByRole("link", { name: "Get started" }).getAttribute("href")).toBe("/signup");
      const css = await header.evaluate((el) => ({ position: getComputedStyle(el).position, blur: getComputedStyle(el).backdropFilter }));
      expect(css.position).toBe("sticky");
      expect(css.blur).toContain("blur");

      const toggle = header.getByRole("button", { name: "Switch to dark theme" });
      expect(await toggle.getAttribute("aria-pressed")).toBe("false");
      await toggle.click();
      const light = header.getByRole("button", { name: "Switch to light theme" });
      expect(await light.getAttribute("aria-pressed")).toBe("true");
      expect(await page.locator("html").getAttribute("class")).toContain("dark");

      await nav.getByRole("link", { name: "Pricing" }).click();
      await page.waitForURL(`${ref.fw.url}/#pricing`);
      await expect.poll(() => page.locator("#pricing").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
    } finally {
      await close();
    }
  });

  it("hero: headline, hero art with meaningful alt, the waitlist form labelled by its heading and Book a demo", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const h1 = page.getByRole("heading", { level: 1 });
      expect((await h1.textContent())?.trim()).toBe("Plan every project without the chaos");
      const hero = page.locator(`img[src="${images.heroArt.src}"]`);
      expect(await hero.count()).toBe(1);
      expect(await hero.getAttribute("alt")).toBe(images.heroArt.alt);

      const form = waitlistForm(page);
      expect(await form.count()).toBe(1);
      const headingId = await form.getAttribute("aria-labelledby");
      expect(headingId).toBeTruthy();
      expect((await page.locator(`[id="${headingId}"]`).textContent())?.trim()).toBe("Join the waitlist");
      expect(await page.getByRole("heading", { name: "Join the waitlist" }).isVisible()).toBe(true);

      const email = form.getByLabel("Work email");
      expect(await email.getAttribute("type")).toBe("email");
      expect(await email.getAttribute("autocomplete")).toBe("email");
      const size = form.getByRole("combobox", { name: "Team size" });
      expect(await size.count()).toBe(1);
      expect(await form.getByRole("button", { name: "Join waitlist" }).getAttribute("type")).toBe("submit");
      expect(await page.getByRole("button", { name: "Book a demo" }).isVisible()).toBe(true);
    } finally {
      await close();
    }
  });

  it("waitlist: the Team size select offers the four sizes and works with the keyboard", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const trigger = waitlistForm(page).getByRole("combobox", { name: "Team size" });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const listbox = page.getByRole("listbox");
      await listbox.waitFor();
      expect((await listbox.getByRole("option").allTextContents()).map((t) => t.trim())).toEqual([...TEAM_SIZES]);
      await waitForOptionFocus(page);
      await page.keyboard.press("ArrowDown");
      await waitForOptionFocus(page, "6–20");
      await page.keyboard.press("Enter");
      await listbox.waitFor({ state: "hidden" });
      expect((await trigger.textContent())?.trim()).toBe("6–20");
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await close();
    }
  });

  it("waitlist: an empty submit marks both fields invalid, links the messages, focuses the first and announces it", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      const form = waitlistForm(page);
      await form.getByRole("button", { name: "Join waitlist" }).click();
      const email = form.getByLabel("Work email");
      const size = form.getByRole("combobox", { name: "Team size" });
      await expect.poll(() => email.getAttribute("aria-invalid")).toBe("true");
      expect(await size.getAttribute("aria-invalid")).toBe("true");
      expect(await describedByTexts(page, email)).toContain(MESSAGES.emailRequired);
      expect(await describedByTexts(page, size)).toContain(MESSAGES.teamSizeRequired);
      expect(await email.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await form.getByRole("alert").filter({ hasText: /problems with this form/ }).count()).toBe(1);
      expect(posts(events.requests, "/api/waitlist")).toHaveLength(0);

      // Then validates on change: a bad address gets its own message, fixing it clears aria-invalid.
      await email.fill("nope");
      await expect.poll(() => describedByTexts(page, email)).toContain("Enter an email address like name@example.com.");
      await email.fill("ok@studio.test");
      await expect.poll(() => email.getAttribute("aria-invalid")).toBeNull();
    } finally {
      await close();
    }
  });

  it("waitlist: success disables the button while pending, sends an Idempotency-Key and shows the position", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      await fillWaitlist(page, uniqueEmail());
      const { release } = await holdRequests(page, "**/api/waitlist");
      const form = waitlistForm(page);
      const button = form.getByRole("button", { name: "Join waitlist" });
      const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/waitlist"));
      await button.click();
      const request = await sent;
      expect(request.headers()["idempotency-key"]).toMatch(UUID_RE);
      expect(JSON.parse(request.postData() ?? "{}")).toMatchObject({ teamSize: "6–20" });
      await expect.poll(() => button.isDisabled()).toBe(true);
      expect(await button.getAttribute("aria-busy")).toBe("true");
      release();

      const status = page.getByRole("status").filter({ hasText: "You're #1284 on the list" });
      await status.waitFor();
      await toasts(page).filter({ hasText: /on the list/i }).first().waitFor();
      await expect.poll(() => button.isDisabled()).toBe(false);
      // The form is cleared (the page never lists entries, so nothing typed stays on screen).
      expect(await form.getByLabel("Work email").inputValue()).toBe("");
      expect(events.consoleErrors).toEqual([]);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("waitlist: the same email twice shows the 409 on the email field and focuses it", async () => {
    const email = uniqueEmail("twice");
    expect((await api(ref.fw, "/api/waitlist", { body: { email, teamSize: "1–5" } })).status).toBe(201);
    const { page, close } = await openPage(ref.fw, "/");
    try {
      await fillWaitlist(page, email, "51+");
      const form = waitlistForm(page);
      await form.getByRole("button", { name: "Join waitlist" }).click();
      const field = form.getByLabel("Work email");
      await expect.poll(() => field.getAttribute("aria-invalid")).toBe("true");
      expect(await describedByTexts(page, field)).toContain("This email is already on the list");
      expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await field.inputValue()).toBe(email);
      expect(await form.getByRole("button", { name: "Join waitlist" }).isEnabled()).toBe(true);
    } finally {
      await close();
    }
  });

  it.each(["500", "network"] as const)("waitlist: a %s failure shows an announced error and a toast, and keeps the values", async (how) => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const email = uniqueEmail("fail");
      await fillWaitlist(page, email, "21–50");
      await failRequests(page, "**/api/waitlist", how);
      const form = waitlistForm(page);
      await form.getByRole("button", { name: "Join waitlist" }).click();
      const alert = form.getByRole("alert").filter({ hasText: ERROR_WORDS });
      await alert.waitFor();
      expect(await alert.isVisible()).toBe(true);
      await toasts(page).filter({ hasText: ERROR_WORDS }).first().waitFor();
      expect(await form.getByLabel("Work email").inputValue()).toBe(email);
      expect((await form.getByRole("combobox", { name: "Team size" }).textContent())?.trim()).toBe("21–50");
      expect(await form.getByRole("button", { name: "Join waitlist" }).isEnabled()).toBe(true);

      // A retry that succeeds clears the error.
      await page.unrouteAll();
      await form.getByRole("button", { name: "Join waitlist" }).click();
      await page.getByRole("status").filter({ hasText: /You're #\d+ on the list/ }).waitFor();
      expect(await form.getByRole("alert").filter({ hasText: ERROR_WORDS }).count()).toBe(0);
    } finally {
      await close();
    }
  });

  it("waitlist: a double click sends one request", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      await fillWaitlist(page, uniqueEmail("dbl"));
      await waitlistForm(page).getByRole("button", { name: "Join waitlist" }).dblclick();
      await page.getByRole("status").filter({ hasText: /on the list/ }).waitFor();
      await page.waitForTimeout(500);
      expect(posts(events.requests, "/api/waitlist")).toHaveLength(1);
      expect(events.badResponses).toEqual([]);
    } finally {
      await close();
    }
  });

  it("waitlist: pressing Enter in the email field submits (keyboard only)", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const form = waitlistForm(page);
      const trigger = form.getByRole("combobox", { name: "Team size" });
      await trigger.focus();
      await page.keyboard.press("Space");
      await page.getByRole("listbox").waitFor();
      await waitForOptionFocus(page);
      await page.keyboard.press("ArrowDown");
      await waitForOptionFocus(page, "6–20");
      await page.keyboard.press("ArrowDown");
      await waitForOptionFocus(page, "21–50");
      await page.keyboard.press("Enter");
      await form.getByLabel("Work email").focus();
      expect((await trigger.textContent())?.trim()).toBe("21–50");
      await page.keyboard.type(uniqueEmail("kbd"));
      const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/waitlist"));
      await page.keyboard.press("Enter");
      expect(JSON.parse((await sent).postData() ?? "{}")).toMatchObject({ teamSize: "21–50" });
      await page.getByRole("status").filter({ hasText: /on the list/ }).waitFor();
    } finally {
      await close();
    }
  });

  it("Book a demo: the dialog form has every labelled field; Esc and Close return focus to the trigger", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const trigger = page.getByRole("button", { name: "Book a demo" });
      const dialog = await openDemo(page);
      expect(await dialog.getByRole("form").count()).toBe(1);
      expect(await dialog.getByLabel("Full name").getAttribute("autocomplete")).toBe("name");
      expect(await dialog.getByLabel("Work email").getAttribute("autocomplete")).toBe("email");
      const size = dialog.getByRole("combobox", { name: "Company size" });
      expect(await size.count()).toBe(1);
      const date = dialog.getByLabel("Preferred date");
      expect(await date.getAttribute("type")).toBe("date");
      expect(await date.getAttribute("min")).toBe(isoInDays(0));
      expect(await dialog.getByLabel("What would you like to see?").evaluate((el) => el.tagName)).toBe("TEXTAREA");
      expect(await dialog.getByRole("checkbox", { name: "I agree to be contacted" }).count()).toBe(1);
      expect(await dialog.getByRole("button", { name: "Request demo" }).getAttribute("type")).toBe("submit");

      await size.click();
      expect((await page.getByRole("listbox").getByRole("option").allTextContents()).map((t) => t.trim())).toEqual([...COMPANY_SIZES]);
      await page.keyboard.press("Escape");
      await page.getByRole("listbox").waitFor({ state: "hidden" });
      expect(await dialog.isVisible()).toBe(true);

      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);

      await openDemo(page);
      await demoDialog(page).getByRole("button", { name: "Close" }).click();
      await demoDialog(page).waitFor({ state: "hidden" });
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await close();
    }
  });

  it("Book a demo: an empty submit marks the required fields invalid and focuses Full name", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const dialog = await openDemo(page);
      await dialog.getByRole("button", { name: "Request demo" }).click();
      const name = dialog.getByLabel("Full name");
      await expect.poll(() => name.getAttribute("aria-invalid")).toBe("true");
      expect(await describedByTexts(page, name)).toContain(MESSAGES.nameRequired);
      expect(await describedByTexts(page, dialog.getByLabel("Work email"))).toContain(MESSAGES.emailRequired);
      expect(await describedByTexts(page, dialog.getByRole("combobox", { name: "Company size" }))).toContain(MESSAGES.companySizeRequired);
      expect(await describedByTexts(page, dialog.getByLabel("Preferred date"))).toContain(MESSAGES.dateRequired);
      const consent = dialog.getByRole("checkbox", { name: "I agree to be contacted" });
      expect(await consent.getAttribute("aria-invalid")).toBe("true");
      expect(await describedByTexts(page, consent)).toContain(MESSAGES.consentRequired);
      expect(await dialog.getByLabel("What would you like to see?").getAttribute("aria-invalid")).toBeNull();
      expect(await name.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await dialog.getByRole("alert").filter({ hasText: /problems with this form/ }).count()).toBe(1);
    } finally {
      await close();
    }
  });

  it('Book a demo: "Crash" shows an announced error and a toast, keeps the values and the dialog open', async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const dialog = await openDemo(page);
      const email = uniqueEmail("crash");
      await fillDemo(page, dialog, { name: "Crash", email });
      const button = dialog.getByRole("button", { name: "Request demo" });
      const response = page.waitForResponse((r) => r.url().endsWith("/api/demo-requests"));
      await button.click();
      expect((await response).status()).toBe(500);
      const alert = dialog.getByRole("alert").filter({ hasText: ERROR_WORDS });
      await alert.waitFor();
      await toasts(page).filter({ hasText: ERROR_WORDS }).first().waitFor();
      expect(await dialog.getByLabel("Full name").inputValue()).toBe("Crash");
      expect(await dialog.getByLabel("Work email").inputValue()).toBe(email);
      expect(await dialog.getByRole("checkbox", { name: "I agree to be contacted" }).isChecked()).toBe(true);
      expect(await button.isEnabled()).toBe(true);
      expect(await dialog.isVisible()).toBe(true);
    } finally {
      await close();
    }
  });

  it("Book a demo: success disables the button while pending, closes the dialog, toasts and confirms inline", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      const dialog = await openDemo(page);
      await fillDemo(page, dialog, { name: "Grace Hopper", email: uniqueEmail("ok"), message: "Workload planning" });
      const { release } = await holdRequests(page, "**/api/demo-requests");
      const button = dialog.getByRole("button", { name: "Request demo" });
      const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/demo-requests"));
      await button.click();
      const request = await sent;
      expect(request.headers()["idempotency-key"]).toMatch(UUID_RE);
      expect(JSON.parse(request.postData() ?? "{}")).toMatchObject({ name: "Grace Hopper", companySize: "11–50", consent: true, message: "Workload planning" });
      await expect.poll(() => button.isDisabled()).toBe(true);
      expect(await button.getAttribute("aria-busy")).toBe("true");
      release();

      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("status").filter({ hasText: /demo/i }).first().waitFor();
      await toasts(page).filter({ hasText: /demo/i }).first().waitFor();
      expect(await page.getByRole("button", { name: "Book a demo" }).evaluate((el) => el === document.activeElement)).toBe(true);
      // Nothing typed stays on screen (the page does not list demo requests).
      expect(await visibleText(page)).not.toContain("Grace Hopper");
      expect(events.badResponses).toEqual([]);
      expect(events.consoleErrors).toEqual([]);

      // Reopening starts from an empty form.
      const again = await openDemo(page);
      expect(await again.getByLabel("Full name").inputValue()).toBe("");
    } finally {
      await close();
    }
  });

  it("Book a demo: a double click sends one request", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      const dialog = await openDemo(page);
      await fillDemo(page, dialog, { name: "Double Click", email: uniqueEmail("dbl-demo") });
      await dialog.getByRole("button", { name: "Request demo" }).dblclick();
      await dialog.waitFor({ state: "hidden" });
      await page.waitForTimeout(500);
      expect(posts(events.requests, "/api/demo-requests")).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("logo cloud: decorative logos with a visible caption", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const cloud = page.locator("[data-section=logo-cloud]");
      expect(await cloud.getByText(/Trusted by/).isVisible()).toBe(true);
      const svgs = cloud.locator("svg");
      expect(await svgs.count()).toBeGreaterThanOrEqual(5);
      for (const svg of await svgs.all()) expect(await svg.getAttribute("aria-hidden")).toBe("true");
    } finally {
      await close();
    }
  });

  it("features: a bento grid with the three feature images and their alt text", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const features = page.locator("section#features");
      expect(await features.getByRole("heading", { level: 2 }).count()).toBe(1);
      for (const img of images.features) {
        const el = features.locator(`img[src="${img.src}"]`);
        expect(await el.count(), img.src).toBe(1);
        expect(await el.getAttribute("alt")).toBe(img.alt);
      }
      expect(await features.getByRole("heading", { level: 3 }).count()).toBeGreaterThanOrEqual(5);
    } finally {
      await close();
    }
  });

  it('pricing: three plans; the "Bill yearly" switch changes the prices (mouse and keyboard)', async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const pricing = page.locator("section#pricing");
      expect(await pricing.getByRole("heading", { level: 3 }).allTextContents()).toEqual(["Starter", "Studio", "Agency"]);
      const toggle = pricing.getByRole("switch", { name: "Bill yearly" });
      expect(await toggle.getAttribute("aria-checked")).toBe("false");
      const prices = () => pricing.locator("[data-price]").allTextContents();
      const monthly = await prices();
      expect(monthly).toEqual(["$0", "$24", "$59"]);
      await toggle.click();
      expect(await toggle.getAttribute("aria-checked")).toBe("true");
      expect(await prices()).toEqual(["$0", "$19", "$47"]);
      expect(await pricing.getByText("billed yearly").first().isVisible()).toBe(true);
      await toggle.focus();
      await page.keyboard.press("Space");
      expect(await toggle.getAttribute("aria-checked")).toBe("false");
      expect(await prices()).toEqual(monthly);
      for (const link of await pricing.getByRole("link").all()) expect(await link.getAttribute("href")).toBe("/signup");
    } finally {
      await close();
    }
  });

  it("testimonials: a carousel with avatars, Previous/Next buttons and no auto-advance", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const carousel = page.getByRole("region", { name: "Testimonials" });
      expect(await carousel.getAttribute("aria-roledescription")).toBe("carousel");
      const current = () => carousel.locator("[aria-roledescription=slide]:not([aria-hidden=true])");
      expect(await current().count()).toBe(1);
      const total = await carousel.locator("[aria-roledescription=slide]").count();
      expect(total).toBeGreaterThanOrEqual(4);
      expect(await current().getAttribute("aria-label")).toBe(`1 of ${total}`);
      expect(await carousel.locator('img[src^="/images/avatar-"]').count()).toBe(total);

      const firstQuote = await current().textContent();
      await page.waitForTimeout(3000);
      expect(await current().textContent(), "no auto-advance").toBe(firstQuote);

      await carousel.getByRole("button", { name: "Next testimonial" }).click();
      expect(await current().getAttribute("aria-label")).toBe(`2 of ${total}`);
      expect(await current().textContent()).not.toBe(firstQuote);
      await carousel.getByRole("button", { name: "Previous testimonial" }).click();
      expect(await current().getAttribute("aria-label")).toBe(`1 of ${total}`);
      // Wraps around, so neither button ever does nothing.
      await carousel.getByRole("button", { name: "Previous testimonial" }).press("Enter");
      expect(await current().getAttribute("aria-label")).toBe(`${total} of ${total}`);
      await carousel.getByRole("button", { name: "Next testimonial" }).press("Space");
      expect(await current().getAttribute("aria-label")).toBe(`1 of ${total}`);
    } finally {
      await close();
    }
  });

  it("FAQ: a five-item accordion that opens with the keyboard", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const faq = page.locator("section#faq");
      const triggers = faq.locator("button[aria-expanded]");
      expect(await triggers.count()).toBe(5);
      const first = triggers.first();
      expect(await first.getAttribute("aria-expanded")).toBe("false");
      await first.focus();
      await page.keyboard.press("Enter");
      expect(await first.getAttribute("aria-expanded")).toBe("true");
      const panelId = await first.getAttribute("aria-controls");
      await expect.poll(() => page.locator(`[id="${panelId}"]`).isVisible()).toBe(true);
      await page.keyboard.press("ArrowDown");
      expect(await triggers.nth(1).evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await close();
    }
  });

  it("newsletter: labelled by its heading; success confirms without ever showing the address again", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      const form = newsletterForm(page);
      expect(await form.count()).toBe(1);
      expect(await page.getByRole("contentinfo").getByRole("form", { name: "Get product updates" }).count()).toBe(1);
      const field = form.getByLabel("Email address");
      expect(await field.getAttribute("type")).toBe("email");
      expect(await field.getAttribute("autocomplete")).toBe("email");
      const email = uniqueEmail("news");
      await field.fill(email);
      const { release } = await holdRequests(page, "**/api/newsletter");
      const button = form.getByRole("button", { name: "Subscribe" });
      const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/newsletter"));
      await button.click();
      expect((await sent).headers()["idempotency-key"]).toMatch(UUID_RE);
      await expect.poll(() => button.isDisabled()).toBe(true);
      expect(await button.getAttribute("aria-busy")).toBe("true");
      release();
      await form.getByRole("status").filter({ hasText: "Thanks! Check your inbox to confirm." }).waitFor();
      await toasts(page).first().waitFor();
      expect(await visibleText(page)).not.toContain(email);
      expect(events.badResponses).toEqual([]);
      expect(events.consoleErrors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("newsletter: an invalid address is marked, described and focused", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const form = newsletterForm(page);
      await form.getByRole("button", { name: "Subscribe" }).click();
      const field = form.getByLabel("Email address");
      await expect.poll(() => field.getAttribute("aria-invalid")).toBe("true");
      expect(await describedByTexts(page, field)).toContain(MESSAGES.newsletterEmailRequired);
      expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await form.getByRole("alert").filter({ hasText: /problem with this form/ }).count()).toBe(1);
    } finally {
      await close();
    }
  });

  it("newsletter: a failed save shows an announced error and a toast and keeps the address", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const form = newsletterForm(page);
      const email = uniqueEmail("news-fail");
      await form.getByLabel("Email address").fill(email);
      await failRequests(page, "**/api/newsletter");
      await form.getByRole("button", { name: "Subscribe" }).click();
      await form.getByRole("alert").filter({ hasText: ERROR_WORDS }).waitFor();
      await toasts(page).filter({ hasText: ERROR_WORDS }).first().waitFor();
      expect(await form.getByLabel("Email address").inputValue()).toBe(email);
      expect(await form.getByRole("button", { name: "Subscribe" }).isEnabled()).toBe(true);
    } finally {
      await close();
    }
  });

  it.each(["light", "dark"] as const)("passes axe in %s mode: on load, after invalid submits, errors, success and with the dialog open", async (colorScheme) => {
    const { page, close } = await openPage(ref.fw, "/", { colorScheme });
    try {
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.waitForTimeout(600); // let the entrance animations finish, as a real run would
      expect(await axeViolations(page), "initial").toEqual([]);

      await waitlistForm(page).getByRole("button", { name: "Join waitlist" }).click();
      await newsletterForm(page).getByRole("button", { name: "Subscribe" }).click();
      await expect.poll(() => waitlistForm(page).getByLabel("Work email").getAttribute("aria-invalid")).toBe("true");
      expect(await axeViolations(page), "invalid submit").toEqual([]);

      await failRequests(page, "**/api/waitlist");
      await failRequests(page, "**/api/newsletter");
      await fillWaitlist(page, uniqueEmail("axe"));
      await waitlistForm(page).getByRole("button", { name: "Join waitlist" }).click();
      await newsletterForm(page).getByLabel("Email address").fill(uniqueEmail("axe-news"));
      await newsletterForm(page).getByRole("button", { name: "Subscribe" }).click();
      await waitlistForm(page).getByRole("alert").filter({ hasText: ERROR_WORDS }).waitFor();
      await newsletterForm(page).getByRole("alert").filter({ hasText: ERROR_WORDS }).waitFor();
      await page.waitForTimeout(400);
      expect(await axeViolations(page), "server error").toEqual([]);

      await page.unrouteAll();
      await waitlistForm(page).getByRole("button", { name: "Join waitlist" }).click();
      await newsletterForm(page).getByRole("button", { name: "Subscribe" }).click();
      await page.getByRole("status").filter({ hasText: /on the list/ }).waitFor();
      await newsletterForm(page).getByRole("status").filter({ hasText: "Thanks!" }).waitFor();
      await page.waitForTimeout(400);
      expect(await axeViolations(page), "success").toEqual([]);

      await page.locator("section#pricing").getByRole("switch", { name: "Bill yearly" }).click();
      await page.locator("section#faq button[aria-expanded]").first().click();
      await page.getByRole("region", { name: "Testimonials" }).getByRole("button", { name: "Next testimonial" }).click();
      await page.waitForTimeout(600);
      expect(await axeViolations(page), "yearly prices, open FAQ, second testimonial").toEqual([]);

      const dialog = await openDemo(page);
      await page.waitForTimeout(300);
      expect(await axeViolations(page), "demo dialog").toEqual([]);
      await dialog.getByRole("button", { name: "Request demo" }).click();
      await expect.poll(() => dialog.getByLabel("Full name").getAttribute("aria-invalid")).toBe("true");
      expect(await axeViolations(page), "demo dialog invalid").toEqual([]);
      await fillDemo(page, dialog, { name: "Crash", email: uniqueEmail("axe-demo") });
      await dialog.getByRole("button", { name: "Request demo" }).click();
      await dialog.getByRole("alert").filter({ hasText: ERROR_WORDS }).waitFor();
      await page.waitForTimeout(300);
      expect(await axeViolations(page), "demo dialog error").toEqual([]);
    } finally {
      await close();
    }
  });

  it.each([320, 390])("at %ipx wide nothing scrolls horizontally, with or without the dialog", async (width) => {
    const { page, close } = await openPage(ref.fw, "/", { viewport: { width, height: 800 } });
    try {
      await page.getByRole("heading", { level: 1 }).waitFor();
      expect(await horizontalOverflow(page)).toBe(false);
      expect(await textOutsideViewport(page), "text cut off at the right or left edge").toEqual([]);
      await page.locator("section#pricing").getByRole("switch", { name: "Bill yearly" }).click();
      await waitlistForm(page).getByRole("button", { name: "Join waitlist" }).click();
      await expect.poll(() => waitlistForm(page).getByLabel("Work email").getAttribute("aria-invalid")).toBe("true");
      expect(await horizontalOverflow(page)).toBe(false);
      const dialog = await openDemo(page);
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    } finally {
      await close();
    }
  });

  it("every button in the page is at least 24x24 and shows a focus ring on keyboard focus", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll("main button, main [role=switch], main [role=combobox], footer button"))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => ({ name: (el.getAttribute("aria-label") || el.textContent || "").trim(), rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width < 24 || rect.height < 24)
          .map(({ name, rect }) => `${name}: ${rect.width}x${rect.height}`),
      );
      expect(small).toEqual([]);

      // Keyboard focus (Tab from the element before) so :focus-visible applies.
      const controls: [string, Locator][] = [
        ["Work email", waitlistForm(page).getByLabel("Work email")],
        ["Team size", waitlistForm(page).getByRole("combobox", { name: "Team size" })],
        ["Join waitlist", waitlistForm(page).getByRole("button", { name: "Join waitlist" })],
        ["Book a demo", page.getByRole("button", { name: "Book a demo" })],
        ["Bill yearly", page.getByRole("switch", { name: "Bill yearly" })],
        ["Next testimonial", page.getByRole("button", { name: "Next testimonial" })],
        ["FAQ", page.locator("section#faq button[aria-expanded]").first()],
        ["Email address", newsletterForm(page).getByLabel("Email address")],
        ["Subscribe", newsletterForm(page).getByRole("button", { name: "Subscribe" })],
      ];
      for (const [what, control] of controls) {
        await control.evaluate((el) => {
          const all = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input, textarea, [tabindex]:not([tabindex='-1'])")).filter(
            (e) => !e.hasAttribute("disabled") && e.offsetParent !== null,
          );
          const i = all.indexOf(el as HTMLElement);
          (all[i - 1] ?? document.body).focus();
        });
        await page.keyboard.press("Tab");
        expect(await control.evaluate((el) => el === document.activeElement), `${what} got focus by Tab`).toBe(true);
        await expectFocusRing(page, control, what);
      }
    } finally {
      await close();
    }
  });

  it("paste is never blocked in the fields", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const blocked = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input:not([type=hidden]), textarea")).filter((el) => {
          const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
          return !el.dispatchEvent(event);
        }).length,
      );
      expect(blocked).toBe(0);
    } finally {
      await close();
    }
  });

  it("prefers-reduced-motion turns the page's animations off", async () => {
    const { page, close } = await openPage(ref.fw, "/", { reducedMotion: "reduce" });
    try {
      await page.getByRole("heading", { level: 1 }).waitFor();
      const long = await page.evaluate(() =>
        document
          .getAnimations()
          .map((a) => (a.effect?.getComputedTiming().duration as number) ?? 0)
          .filter((d) => d > 1),
      );
      expect(long).toEqual([]);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
    } finally {
      await close();
    }
  });
});

// ---- planted bugs ------------------------------------------------------------------------------

async function teamSizeTriggerHasNoName(page: Page) {
  const form = waitlistForm(page);
  const trigger = form.locator("button[role=combobox]").first();
  expect(await trigger.count()).toBe(1);
  expect(await form.getByRole("combobox", { name: "Team size" }).count()).toBe(0);
  // The label is still on screen, just not associated with the trigger.
  expect(await form.getByText("Team size", { exact: true }).isVisible()).toBe(true);
  return trigger;
}

describe("W01: the waitlist Team size select has no accessible name", () => {
  const ref = useFernway("W01");

  it("the trigger is unnamed and axe reports it; everything else on the page still works", async () => {
    const { page, events, close } = await openPage(ref.fw, "/", { reducedMotion: "reduce" });
    try {
      await teamSizeTriggerHasNoName(page);
      // axe reports the unnamed trigger, and nothing else on the page.
      const onTrigger = await axeViolations(page, { include: '[aria-labelledby="waitlist-heading"] button[role=combobox]' });
      expect(onTrigger.length, "violations on the Team size trigger").toBeGreaterThan(0);
      expect(await axeViolations(page)).toEqual(onTrigger);

      // The select still works (by position), and the waitlist still saves.
      const form = waitlistForm(page);
      await form.getByLabel("Work email").fill(uniqueEmail("w01"));
      await choose(page, form.locator("button[role=combobox]").first(), "1–5");
      await form.getByRole("button", { name: "Join waitlist" }).click();
      await page.getByRole("status").filter({ hasText: "You're #1284 on the list" }).waitFor();

      // Only this select: the demo form's Company size keeps its name.
      const dialog = await openDemo(page);
      expect(await dialog.getByRole("combobox", { name: "Company size" }).count()).toBe(1);
      expect(events.consoleErrors).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("W02: a failed newsletter save is swallowed", () => {
  const ref = useFernway("W02");

  it("a 500 shows nothing (no alert, no toast, no error text) and re-enables the button", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const form = newsletterForm(page);
      await form.getByLabel("Email address").fill(uniqueEmail("w02"));
      await failRequests(page, "**/api/newsletter");
      const response = page.waitForResponse((r) => r.url().endsWith("/api/newsletter"));
      await form.getByRole("button", { name: "Subscribe" }).click();
      expect((await response).status()).toBe(500);
      await page.waitForTimeout(1500);
      expect(await form.getByRole("button", { name: "Subscribe" }).isEnabled()).toBe(true);
      expect(await toasts(page).count()).toBe(0);
      const errorText = await page.evaluate(
        (source) =>
          Array.from(document.querySelectorAll("[role=alert], [role=status], [aria-live]"))
            .map((el) => (el as HTMLElement).innerText.trim())
            .filter((t) => new RegExp(source, "i").test(t)),
        ERROR_WORDS.source,
      );
      expect(errorText).toEqual([]);
      expect(await page.locator("footer").innerText()).not.toMatch(ERROR_WORDS);
    } finally {
      await close();
    }
  });

  it("success and validation still work, and the waitlist error path is unaffected", async () => {
    const { page, close } = await openPage(ref.fw, "/");
    try {
      const form = newsletterForm(page);
      await form.getByRole("button", { name: "Subscribe" }).click();
      await expect.poll(() => form.getByLabel("Email address").getAttribute("aria-invalid")).toBe("true");
      await form.getByLabel("Email address").fill(uniqueEmail("w02-ok"));
      await form.getByRole("button", { name: "Subscribe" }).click();
      await form.getByRole("status").filter({ hasText: "Thanks! Check your inbox to confirm." }).waitFor();

      await fillWaitlist(page, uniqueEmail("w02-wait"));
      await failRequests(page, "**/api/waitlist");
      await waitlistForm(page).getByRole("button", { name: "Join waitlist" }).click();
      await waitlistForm(page).getByRole("alert").filter({ hasText: ERROR_WORDS }).waitFor();
      // W01 is off: the Team size select keeps its name.
      expect(await waitlistForm(page).getByRole("combobox", { name: "Team size" }).count()).toBe(1);
    } finally {
      await close();
    }
  });
});

describe("FERNWAY_BUGS=all on the landing page", () => {
  const ref = useFernway("all");

  it("plants W01 and W02 together and the page still loads cleanly otherwise", async () => {
    const { page, events, close } = await openPage(ref.fw, "/");
    try {
      await teamSizeTriggerHasNoName(page);
      const form = newsletterForm(page);
      await form.getByLabel("Email address").fill(uniqueEmail("all"));
      await failRequests(page, "**/api/newsletter");
      await form.getByRole("button", { name: "Subscribe" }).click();
      await page.waitForTimeout(1000);
      expect(await toasts(page).count()).toBe(0);
      expect(await form.getByRole("alert").filter({ hasText: ERROR_WORDS }).count()).toBe(0);
      expect(events.pageErrors).toEqual([]);
    } finally {
      await close();
    }
  });
});

