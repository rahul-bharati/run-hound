import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page, type Request } from "playwright";
import type { Kennel } from "./kennel.js";

let browser: Browser | undefined;

/** One headless Chromium per test file; call closeBrowser() in afterAll. */
export async function getBrowser(): Promise<Browser> {
  browser ??= await chromium.launch();
  return browser;
}

export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

/** Matches Node/V8 stack frames, internal paths and framework dumps. */
export const STACK_RE = /\n\s*at\s+\S|\bat\s+[^\s]+\s+\([^)]*:\d+:\d+\)|node:internal|node_modules\/|file:\/\/\/|\/server\/[\w.-]+\.m?js/;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export interface BookingInput {
  petName: string;
  petType: "dog" | "cat" | "other";
  startDate: string;
  endDate: string;
  ownerEmail: string;
  phone: string;
  instructions: string;
}

let counter = 0;
/** A valid booking with unique canary values. */
export function validBooking(overrides: Partial<BookingInput> = {}): BookingInput {
  const n = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  return {
    petName: `Rex${n}`,
    petType: "cat",
    startDate: "2030-05-01",
    endDate: "2030-05-03",
    ownerEmail: `owner.${n}@example.test`,
    phone: `+1555${String(1000000 + counter).slice(-7)}`,
    instructions: `Feed twice daily ${n}`,
    ...overrides,
  };
}

export async function postBooking(kennel: Kennel, body: unknown) {
  const res = await fetch(`${kennel.url}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json };
}

export async function listBookings(kennel: Kennel): Promise<(BookingInput & { id: string })[]> {
  const res = await fetch(`${kennel.url}/api/bookings`);
  if (!res.ok) throw new Error(`GET /api/bookings ${res.status}`);
  return (await res.json()) as (BookingInput & { id: string })[];
}

export interface PageEvents {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Responses with status >= 400, as "STATUS URL". */
  badResponses: string[];
  requests: Request[];
}

export interface OpenedPage {
  context: BrowserContext;
  page: Page;
  events: PageEvents;
  close(): Promise<void>;
}

/** Opens `${kennel.url}/book` in a fresh context and records console/network problems. */
export async function openBook(
  kennel: Kennel,
  options: { viewport?: { width: number; height: number }; waitUntil?: "load" | "networkidle" } = {},
): Promise<OpenedPage> {
  const b = await getBrowser();
  const context = await b.newContext({ viewport: options.viewport ?? { width: 1280, height: 900 } });
  const page = await context.newPage();
  const events: PageEvents = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], requests: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") events.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => events.pageErrors.push(String(err)));
  page.on("requestfailed", (req) => events.failedRequests.push(`${req.method()} ${req.url()} ${req.failure()?.errorText ?? ""}`));
  page.on("response", (res) => {
    if (res.status() >= 400) events.badResponses.push(`${res.status()} ${res.url()}`);
  });
  page.on("request", (req) => events.requests.push(req));
  await page.goto(`${kennel.url}/book`, { waitUntil: options.waitUntil ?? "networkidle" });
  await page.getByRole("heading", { name: "Book a sitter", level: 1 }).waitFor();
  return { context, page, events, close: () => context.close() };
}

// ---- locators ---------------------------------------------------------------------------------

export const loc = {
  petName: (p: Page) => p.getByLabel("Pet name", { exact: true }),
  petTypeRadio: (p: Page, name: "Dog" | "Cat" | "Other") => p.getByRole("radio", { name, exact: true }),
  startDate: (p: Page) => p.getByLabel("Start date", { exact: true }),
  endDate: (p: Page) => p.getByLabel("End date", { exact: true }),
  email: (p: Page) => p.getByLabel("Owner email", { exact: true }),
  /** Works with or without a label (A01 leaves only a placeholder). */
  phone: (p: Page) => p.getByLabel("Phone", { exact: true }).or(p.getByPlaceholder("Phone", { exact: true })).first(),
  instructions: (p: Page) => p.getByLabel("Special instructions", { exact: true }),
  password: (p: Page) => p.getByLabel("Password", { exact: true }),
  confirmPassword: (p: Page) => p.getByLabel("Confirm password", { exact: true }),
  book: (p: Page) => p.getByRole("button", { name: "Book", exact: true }),
  saveDraft: (p: Page) => p.getByRole("button", { name: "Save draft", exact: true }),
  clearButton: (p: Page) => p.locator('[data-kennel="clear-pet-name"]'),
  removeButtons: (p: Page) => p.locator('[data-kennel="remove-booking"]'),
  emailHint: (p: Page) => p.locator('[data-kennel="email-hint"]'),
  bookings: (p: Page) => p.locator("section", { has: p.getByRole("heading", { name: "Your bookings", level: 2 }) }),
};

const TYPE_LABEL = { dog: "Dog", cat: "Cat", other: "Other" } as const;

/** Fills the form through the UI. With `petTypeAsDiv` (A03) the pet type is picked by clicking its text. */
export async function fillForm(page: Page, data: BookingInput, options: { petTypeAsDiv?: boolean } = {}) {
  await loc.petName(page).fill(data.petName);
  if (options.petTypeAsDiv) {
    await page.locator('[data-kennel="pet-type"]').getByText(TYPE_LABEL[data.petType], { exact: true }).click();
  } else {
    await loc.petTypeRadio(page, TYPE_LABEL[data.petType]).check();
  }
  await loc.startDate(page).fill(data.startDate);
  await loc.endDate(page).fill(data.endDate);
  await loc.email(page).fill(data.ownerEmail);
  await loc.phone(page).fill(data.phone);
  await loc.instructions(page).fill(data.instructions);
}

/** Resolves when a POST /api/bookings response arrives. */
export function waitForCreate(page: Page, timeout = 10_000) {
  return page.waitForResponse(
    (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/bookings",
    { timeout },
  );
}

/** Fills, clicks Book and waits for the create response and the "Booking saved" status. */
export async function bookThroughUi(page: Page, data: BookingInput, options: { petTypeAsDiv?: boolean } = {}) {
  await fillForm(page, data, options);
  const created = waitForCreate(page);
  await loc.book(page).click();
  const res = await created;
  await page.getByRole("status").filter({ hasText: "Booking saved" }).waitFor({ timeout: 5_000 });
  return res;
}

/** Holds every POST /api/bookings for `ms` before letting it through; returns a counter of create requests. */
export async function delayCreates(page: Page, ms: number) {
  const seen = { count: 0 };
  await page.route("**/api/bookings", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    seen.count++;
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
  return seen;
}

/** Dispatches a cancelable synthetic paste event; true if the page did not prevent it. */
export async function pasteAllowed(page: Page, locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "pasted-Secret-123");
    const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    return el.dispatchEvent(event);
  });
}

/** WCAG contrast ratio of an element's text color against its effective (ancestor) background. */
export async function textContrast(locator: ReturnType<Page["locator"]>): Promise<number> {
  return locator.evaluate((el) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let node: Element | null = el; node; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        bg = c;
        break;
      }
    }
    const fgRaw = parse(getComputedStyle(el).color)!;
    const fg = {
      r: fgRaw.r * fgRaw.a + bg.r * (1 - fgRaw.a),
      g: fgRaw.g * fgRaw.a + bg.g * (1 - fgRaw.a),
      b: fgRaw.b * fgRaw.a + bg.b * (1 - fgRaw.a),
    };
    const opacity = Number(getComputedStyle(el).opacity);
    const f2 = opacity < 1
      ? { r: fg.r * opacity + bg.r * (1 - opacity), g: fg.g * opacity + bg.g * (1 - opacity), b: fg.b * opacity + bg.b * (1 - opacity) }
      : fg;
    const [hi, lo] = [lum(f2), lum(bg)].sort((a, b) => b - a) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  });
}

export interface FocusProbe {
  tag: string;
  type: string | null;
  name: string;
  visible: boolean;
}

/**
 * Tabs through the page from the top (up to `max` stops) and reports, for each focused control,
 * whether its keyboard focus is visible (outline present, or outline/box-shadow differs from unfocused).
 */
export async function probeFocus(page: Page, max = 60): Promise<FocusProbe[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.locator("body").focus().catch(() => {});
  const focused: { idx: number; outline: string; outlineWidth: string; shadow: string }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((i) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      if (el.dataset.focusProbe) return { repeat: Number(el.dataset.focusProbe), outline: "", outlineWidth: "", shadow: "" };
      el.dataset.focusProbe = String(i);
      const s = getComputedStyle(el);
      return { repeat: -1, outline: s.outlineStyle, outlineWidth: s.outlineWidth, shadow: s.boxShadow };
    }, i);
    if (!info) break;
    // Date inputs have several Tab stops (month/day/year) on one element: skip those; any other repeat is a cycle.
    if (info.repeat >= 0) {
      if (info.repeat === focused.at(-1)?.idx) continue;
      break;
    }
    focused.push({ idx: i, outline: info.outline, outlineWidth: info.outlineWidth, shadow: info.shadow });
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const probes: FocusProbe[] = [];
  for (const f of focused) {
    const rest = await page.evaluate((idx) => {
      const el = document.querySelector<HTMLElement>(`[data-focus-probe="${idx}"]`)!;
      const s = getComputedStyle(el);
      const name = el.getAttribute("aria-label") ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? el.textContent ?? "";
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type"),
        name: name.trim(),
        outline: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        shadow: s.boxShadow,
      };
    }, f.idx);
    const hasOutline = f.outline !== "none" && parseFloat(f.outlineWidth) > 0;
    const changed = f.shadow !== rest.shadow || (f.outline !== rest.outline && f.outline !== "none");
    probes.push({ tag: rest.tag, type: rest.type, name: rest.name, visible: hasOutline || changed });
  }
  return probes;
}

/** Page-level horizontal overflow at the current viewport. */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
}

/** Text of every script the page loads (inline and external), fetched from the server. */
export async function loadedScripts(kennel: Kennel): Promise<{ src: string; text: string }[]> {
  const html = await (await fetch(`${kennel.url}/book`)).text();
  const out: { src: string; text: string }[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) {
      const url = new URL(src, `${kennel.url}/book`).toString();
      out.push({ src: url, text: await (await fetch(url)).text() });
    } else {
      out.push({ src: "(inline)", text: m[2] ?? "" });
    }
  }
  return out;
}

export const LLM_KEY_RE = /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/;
export const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

/** Decoded payloads of every JWT-looking string in `text`. */
export function jwtPayloads(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of text.matchAll(JWT_RE)) {
    const payload = m[0].split(".")[1]!;
    try {
      out.push(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    } catch {
      // not a JWT after all
    }
  }
  return out;
}
