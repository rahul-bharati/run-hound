import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { notImplemented } from "../ai/not-implemented.js";
import type { SessionState } from "./auth.js";
import { openForm } from "./open-form.js";
import { SIMULATED_RESPONSE_HEADER, type AccountRef, type Box, type CheckContext, type DiscoveredForm, type DiscoveredPage, type Evidence, type Fact, type FrameOptions, type Highlight, type Recording } from "../core/types.js";
import { carriesTestValues, isAcceptedStatus, isPagePost, isSaveRequest } from "../core/saves.js";
import { attachCapture } from "./capture.js";
import { composeFrame, encodeGif, gifScale, renderCard, resolveHighlights, type FrameHeader } from "./evidence.js";
import { explainNavigationError } from "./errors.js";
import { guardContext, type NavigationGuard } from "./guard.js";
import { redactSecrets } from "./redact.js";
import type { SafetyOptions } from "./safety.js";

export interface ContextOptions extends SafetyOptions {
  browser: Browser;
  form: DiscoveredForm;
  /**
   * Whether openPage opens `form` when it is in a dialog (form.opener) after every load. Default true. The runner
   * passes false for page-wide scenarios: they test the page as it loads, not with the first form's dialog open.
   */
  openForm?: boolean;
  discoveredPage?: DiscoveredPage;
  targetUrl: string;
  artifactsDir: string;
  allowDestructive?: boolean;
  runToken?: string;
  log?: (message: string) => void;
  /** Check id and scenario title, printed in the header of every evidence frame. */
  checkId?: string;
  scenarioTitle?: string;
  /** Live view hooks (see runner.ts ProgressEvent). Called for every step() and every page load (main frame). */
  onStep?: (step: { label: string; url: string; at: string }) => void;
  onPageLoad?: (page: { url: string; at: string }) => void;
  /**
   * Called with JPEG frames (max 960 px wide) of every page opened through openPage while it runs, via a CDP
   * screencast. Omit to disable the screencast (it costs CPU).
   */
  onFrame?: (frame: { jpeg: Buffer; url: string; at: string }) => void;
  /**
   * Evidence file counter shared by every context of a run, so file numbers follow the order evidence was taken
   * across scenarios ("001-…", "002-…"). Each context counts on its own when omitted.
   */
  fileCounter?: { value: number };
  /**
   * Signed-in runs (0.4.0, docs/v2-spec.md): the sessions openPage({ as }) and request() use. `self` is the run's
   * account (absent = the run is signed out), `other` the second account (absent = none; openPage/request as "other"
   * then throw).
   */
  sessions?: { self?: SessionState; other?: SessionState };
  /** Labels of those accounts, exposed as CheckContext.accounts. */
  accounts?: { self: AccountRef | null; other: AccountRef | null };
  /** CheckContext.accountMarkers(): strings identifying the run account's data (its username). Never printed. */
  markers?: string[];
}

/** How long openPage waits for the network to go quiet after "load"; apps that poll or stream never go idle. */
const NETWORK_IDLE_TIMEOUT_MS = 5_000;

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

/**
 * The browser's locale: the machine's, as Node resolves it (always a valid BCP 47 tag). Without it, Chromium takes
 * the locale from LANG, and with LANG unset (common in containers) it reports "en-US@posix", which the page's own
 * Intl APIs reject ("Invalid language tag"), breaking apps and checks that format dates.
 */
export const BROWSER_LOCALE: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
})();

/**
 * Chromium answers Page.captureScreenshot with "Unable to capture screenshot" when the compositor does not
 * produce a frame in time, which happens on a busy machine. It is transient: the same capture moments later
 * works. Any other screenshot error (page closed, crashed) is real and is not retried.
 */
const TRANSIENT_SCREENSHOT_ERROR = /Unable to capture screenshot/;
const SCREENSHOT_RETRY_DELAYS_MS = [250, 750];

async function takeScreenshot(page: Page, options: Parameters<Page["screenshot"]>[0]): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.screenshot(options);
    } catch (err) {
      const delay = SCREENSHOT_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !TRANSIENT_SCREENSHOT_ERROR.test(String((err as Error)?.message ?? err))) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** Short lowercase token; lowercase so canary emails hash the same before and after normalisation. */
function newRunToken(): string {
  return randomBytes(4).toString("hex");
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "screenshot"
  );
}

/** Screencast settings for the live view: JPEG, at most 960 px wide, at most ~6 frames a second. */
const SCREENCAST = { format: "jpeg", quality: 60, maxWidth: 960, maxHeight: 960 } as const;
const SCREENCAST_MIN_INTERVAL_MS = 160;

function redactFacts(facts: Fact[] | undefined): Fact[] {
  return (facts ?? []).map((f) => ({ label: redactSecrets(f.label), value: redactSecrets(f.value) }));
}

function redactHighlight<T extends Highlight>(h: T): T {
  return { ...h, label: redactSecrets(h.label) };
}

/** Facts for highlights that could not be drawn, so they are never silently dropped. */
function describeUnmarked(missing: Highlight[], outside: Highlight[]): Fact[] {
  // Run Hound's own marker attributes mean nothing to a reader; only a selector from the page itself is shown.
  const where = (h: Highlight) => (h.selector && !/data-rh-/.test(h.selector) ? `${h.label} (${h.selector})` : h.label);
  return [
    ...missing.map((h) => ({ label: "Not found on page", value: redactSecrets(where(h)) })),
    ...outside.map((h) => ({ label: "Outside the captured area", value: redactSecrets(where(h)) })),
  ];
}

/** An annotated frame, composed but not yet written anywhere. */
interface ComposedFrame {
  png: Buffer;
  url: string;
  capturedAt: string;
  step?: string;
  viewport: { width: number; height: number };
  highlights: (Highlight & { box: Box })[];
  facts: Fact[];
}

export interface RunningCheckContext extends CheckContext {
  dispose(): Promise<void>;
  /** Navigations off the allowed targets that were refused before they were sent. */
  readonly blocked: string[];
  /** Refused hosts a redirect reached anyway; the browser context was closed when it happened. */
  readonly escaped: string[];
  /** Save requests the app accepted on pages opened through openPage so far (see isAcceptedSave). */
  testRecordsCreated(): number;
}

/**
 * A GraphQL read sent as a POST (Apollo Client's default): a JSON body, or a batch of them, whose "query" holds no
 * mutation. It reads records, even when its variables carry a test value (a search for what was just saved).
 */
function isGraphQlRead(postData: string | null): boolean {
  if (!postData || !/^\s*[[{]/.test(postData)) return false;
  let body: unknown;
  try {
    body = JSON.parse(postData);
  } catch {
    return false;
  }
  const operations = Array.isArray(body) ? body : [body];
  return (
    operations.length > 0 &&
    operations.every((op) => {
      const query = op && typeof op === "object" ? (op as { query?: unknown }).query : undefined;
      return typeof query === "string" && !/\bmutation\b/.test(query);
    })
  );
}

/**
 * Whether a response may mean the app created a test record: a save request (core/saves.ts: a non-GET fetch, XHR or
 * form post to the target's origin, or to another origin with the run's test values in its body) that the app
 * answered with a 2xx or 3xx status, and that is a page post, has no body, or carries the run's test values (CHK-5).
 * So a same-origin analytics proxy, an RPC read sent as a POST or a GraphQL query never counts; nor does a preflight
 * (OPTIONS) or a response a check simulated. An upper bound: an app may turn a repeated post into one record.
 */
export function isAcceptedSave(
  r: { method: string; resourceType: string; url: string; status: number | null; postData: string | null; simulated?: boolean },
  targetUrl: string,
  runToken: string,
): boolean {
  if (r.simulated) return false;
  if (!isSaveRequest(r, targetUrl, runToken) || !isAcceptedStatus(r.status)) return false;
  if (isGraphQlRead(r.postData)) return false;
  return isPagePost(r) || !r.postData || carriesTestValues(r.postData, runToken);
}

/**
 * Real CheckContext. openPage() creates a new BrowserContext (default viewport 1280x800), installs the
 * navigation guard (see guard.ts), attaches capture, navigates to targetUrl and waits for "load" plus up to 5 s of network idle.
 * screenshot() writes a PNG under artifactsDir and returns evidence with a path relative to artifactsDir.
 * Contexts opened through it are closed by the returned dispose(). Log lines are redacted.
 */
export function createCheckContext(options: ContextOptions): RunningCheckContext {
  const contexts: BrowserContext[] = [];
  const guards: NavigationGuard[] = [];
  const screencasts: { cdp: CDPSession; stopped: boolean }[] = [];
  const counter = options.fileCounter ?? { value: 0 };
  let acceptedSaves = 0;
  // Set by dispose(): a check abandoned at a stop or its time limit may still try to open a page; it gets none.
  let disposed = false;
  const ENDED = "The scenario has ended, so no new page is opened.";
  const runToken = options.runToken ?? newRunToken();
  /** URL of the page the check touched last; cards carry it in their header. */
  let lastUrl = options.targetUrl;
  const headerTitle = redactSecrets([options.checkId, options.scenarioTitle].filter(Boolean).join(" · ") || "Run Hound");

  /** A new numbered file name under artifactsDir, in the order evidence was taken; skips names already used. */
  async function nextFile(label: string, extension: string): Promise<string> {
    await mkdir(options.artifactsDir, { recursive: true });
    let file: string;
    do {
      counter.value += 1;
      file = `${String(counter.value).padStart(3, "0")}-${slug(label)}.${extension}`;
    } while (await exists(join(options.artifactsDir, file)));
    return file;
  }

  /** Screenshots `page`, resolves and draws the highlights, and composes the annotated frame. All text is redacted. */
  async function composePage(page: Page, frame: FrameOptions): Promise<ComposedFrame> {
    const fullPage = frame.fullPage ?? false;
    const { resolved, missing } = await resolveHighlights(page, frame.highlights ?? [], { fullPage });
    const obstacles = resolved.length > 0 ? await controlBoxes(page, fullPage) : [];
    const viewport = page.viewportSize() ?? DEFAULT_VIEWPORT;
    const capturedAt = new Date().toISOString();
    const screenshot = await takeScreenshot(page, { fullPage });
    const url = redactSecrets(page.url());
    lastUrl = page.url();

    // A viewport frame can only show what is in the viewport; anything scrolled away is reported instead.
    const size = fullPage ? await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })) : viewport;
    const inside = (b: Box) => b.x < size.width && b.y < size.height && b.x + b.width > 0 && b.y + b.height > 0;
    const drawable = resolved.filter((h) => inside(h.box));
    const outside = resolved.filter((h) => !inside(h.box));

    const facts = [...redactFacts(frame.facts), ...describeUnmarked(missing, outside)];
    const step = frame.step === undefined ? undefined : redactSecrets(frame.step);
    const header: FrameHeader = { url, capturedAt, title: headerTitle, step, caption: frame.caption === undefined ? undefined : redactSecrets(frame.caption), facts };
    const composed = await composeFrame(options.browser, screenshot, header, drawable.map(redactHighlight), { obstacles });
    return { png: composed.png, url, capturedAt, step, viewport, highlights: composed.highlights, facts };
  }

  /** Streams JPEG frames of `page` to onFrame through a CDP screencast until dispose(). */
  async function startScreencast(context: BrowserContext, page: Page, onFrame: NonNullable<ContextOptions["onFrame"]>) {
    const cdp = await context.newCDPSession(page);
    const cast = { cdp, stopped: false };
    screencasts.push(cast);
    let lastSent = 0;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      // The URL when the frame arrived, not after the rate-limit delay: by then the page may have navigated.
      const url = page.url();
      const ack = () => cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
      // The screencast starts before the first goto, and a busy machine paints the empty about:blank page
      // first. That frame shows nothing of the page under test, so it is skipped (but acknowledged, or
      // Chromium sends no more frames).
      if (url === "about:blank") return void ack();
      const deliver = () => {
        if (cast.stopped) return;
        lastSent = Date.now();
        try {
          onFrame({ jpeg: Buffer.from(data, "base64"), url: redactSecrets(url), at: new Date().toISOString() });
        } catch {
          // A failing live view must never break the check.
        }
        // Chromium sends the next frame only after this one is acknowledged; the delay caps the frame rate.
        ack();
      };
      const wait = SCREENCAST_MIN_INTERVAL_MS - (Date.now() - lastSent);
      if (wait > 0) setTimeout(deliver, wait);
      else deliver();
    });
    await cdp.send("Page.startScreencast", { ...SCREENCAST });
  }

  return {
    get blocked() {
      return guards.flatMap((g) => g.blocked);
    },
    get escaped() {
      return guards.flatMap((g) => g.escaped);
    },

    browser: options.browser,
    form: options.form,
    ...(options.discoveredPage ? { discoveredPage: options.discoveredPage } : {}),
    targetUrl: options.targetUrl,
    artifactsDir: options.artifactsDir,
    allowDestructive: options.allowDestructive ?? false,
    runToken,

    testRecordsCreated() {
      return acceptedSaves;
    },

    ...(options.accounts ? { accounts: options.accounts } : {}),

    accountMarkers() {
      return [...(options.markers ?? [])];
    },

    async request(as, request) {
      void as;
      void request;
      return notImplemented("CheckContext.request");
    },

    async openPage(pageOptions = {}) {
      if (disposed) throw new Error(ENDED);
      const context = await options.browser.newContext({ viewport: pageOptions.viewport ?? DEFAULT_VIEWPORT, locale: BROWSER_LOCALE });
      if (disposed) {
        await context.close().catch(() => undefined);
        throw new Error(ENDED);
      }
      contexts.push(context);
      guards.push(await guardContext(context, { allowedHosts: options.allowedHosts, lookup: options.lookup }));
      const page = await context.newPage();
      const capture = attachCapture(page);
      page.on("response", (response) => {
        const request = response.request();
        const save = {
          method: request.method(),
          resourceType: request.resourceType(),
          url: request.url(),
          status: response.status(),
          postData: request.postData(),
          simulated: response.headers()[SIMULATED_RESPONSE_HEADER] !== undefined,
        };
        if (isAcceptedSave(save, options.targetUrl, runToken)) acceptedSaves += 1;
      });
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame() || frame.url() === "about:blank") return;
        lastUrl = frame.url();
        options.onPageLoad?.({ url: redactSecrets(frame.url()), at: new Date().toISOString() });
      });
      if (options.onFrame) await startScreencast(context, page, options.onFrame).catch(() => undefined);
      try {
        await page.goto(options.targetUrl, { waitUntil: "load" });
      } catch (err) {
        throw explainNavigationError(err, options.targetUrl);
      }
      // Bounded: a page that polls or keeps a stream open never reaches network idle.
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
      // A form in a dialog or sheet (0.4.0): open it, so every check finds its form on screen.
      if (options.form.opener && options.openForm !== false) await openForm(page, options.form);
      return { context, page, capture };
    },

    async screenshot(page, label): Promise<Evidence> {
      const file = await nextFile(label, "png");
      await takeScreenshot(page, { path: join(options.artifactsDir, file), fullPage: true });
      return { kind: "screenshot", label, path: file };
    },

    async capture(page, label, frameOptions = {}): Promise<Evidence> {
      const frame = await composePage(page, frameOptions);
      const file = await nextFile(label, "png");
      await writeFile(join(options.artifactsDir, file), frame.png);
      return {
        kind: "frame",
        label: redactSecrets(label),
        path: file,
        url: frame.url,
        capturedAt: frame.capturedAt,
        ...(frame.step === undefined ? {} : { step: frame.step }),
        viewport: frame.viewport,
        highlights: frame.highlights,
        facts: frame.facts,
      };
    },

    async captureCard(label, card): Promise<Evidence> {
      const capturedAt = new Date().toISOString();
      const url = redactSecrets(lastUrl);
      const lines = card.lines.map((l) => ({ ...l, text: redactSecrets(l.text) }));
      const redacted = {
        title: redactSecrets(card.title),
        subtitle: card.subtitle === undefined ? undefined : redactSecrets(card.subtitle),
        lines,
        ...(card.firstLineNumber === undefined ? {} : { firstLineNumber: card.firstLineNumber }),
        facts: redactFacts(card.facts),
      };
      const png = await renderCard(options.browser, { url, capturedAt, title: headerTitle }, redacted);
      const file = await nextFile(label, "png");
      await writeFile(join(options.artifactsDir, file), png);
      return {
        kind: "card",
        label: redactSecrets(label),
        path: file,
        url,
        capturedAt,
        facts: redacted.facts,
        // The card's text, so it stays searchable and readable without the image.
        data: {
          title: redacted.title,
          subtitle: redacted.subtitle,
          ...(card.firstLineNumber === undefined ? {} : { firstLineNumber: card.firstLineNumber }),
          lines: lines.map((l) => (l.mark ? `> ${l.text}` : `  ${l.text}`)),
        },
      };
    },

    record(page, label): Recording {
      const frames: ComposedFrame[] = [];
      return {
        async step(stepLabel, stepOptions = {}) {
          frames.push(await composePage(page, { ...stepOptions, step: stepLabel, fullPage: false }));
        },
        async finish(finishOptions = {}) {
          if (frames.length === 0) throw new Error(`Recording "${redactSecrets(label)}" has no frames: call step() before finish()`);
          const gif = encodeGif(frames.map((f) => ({ png: f.png })));
          const finalLabel = redactSecrets(finishOptions.label ?? label);
          const file = await nextFile(finalLabel, "gif");
          await writeFile(join(options.artifactsDir, file), gif.gif);

          // Marks of every step, in GIF pixels; facts of every step, without repeats.
          const scale = gifScale(frames.map((f) => pngWidth(f.png)));
          const highlights = frames.flatMap((f) =>
            f.highlights.map((h) => ({
              ...h,
              box: { x: Math.round(h.box.x * scale), y: Math.round(h.box.y * scale), width: Math.max(1, Math.round(h.box.width * scale)), height: Math.max(1, Math.round(h.box.height * scale)) },
            })),
          );
          const seen = new Set<string>();
          const facts = frames.flatMap((f) => f.facts).filter((f) => {
            const key = `${f.label}\u0000${f.value}`;
            return seen.has(key) ? false : (seen.add(key), true);
          });
          const first = frames[0]!;
          const steps = frames.map((f) => f.step).filter((s): s is string => Boolean(s));
          return {
            kind: "gif",
            label: finalLabel,
            path: file,
            url: first.url,
            capturedAt: first.capturedAt,
            ...(steps.length > 0 ? { step: steps.join(" → ") } : {}),
            viewport: first.viewport,
            highlights,
            facts,
            frames: gif.frames,
            durationMs: gif.durationMs,
          };
        },
      };
    },

    step(label, page) {
      if (page) lastUrl = page.url();
      try {
        options.onStep?.({ label: redactSecrets(label), url: redactSecrets(page?.url() ?? lastUrl), at: new Date().toISOString() });
      } catch {
        // A failing live view must never break the check.
      }
    },

    log(message) {
      options.log?.(redactSecrets(message));
    },

    async dispose() {
      disposed = true;
      const casts = screencasts.splice(0);
      for (const cast of casts) cast.stopped = true;
      await Promise.all(casts.map(({ cdp }) => cdp.send("Page.stopScreencast").then(() => cdp.detach()).catch(() => undefined)));
      const open = contexts.splice(0);
      await Promise.all(open.map((c) => c.close().catch(() => undefined)));
    },
  };
}

/**
 * Boxes of the page's visible controls (fields, buttons, media), in the coordinates of the screenshot about to be
 * taken. Callouts are kept off them: an empty field looks like plain background, but a callout on it reads as if it
 * described that field. Never throws; at most 400 boxes.
 */
async function controlBoxes(page: Page, fullPage: boolean): Promise<Box[]> {
  const script = `(fullPage) => {
    const out = [];
    const sx = fullPage ? window.scrollX : 0, sy = fullPage ? window.scrollY : 0;
    const sel = "input:not([type=hidden]), textarea, select, button, [role=button], [role=checkbox], [role=radio], [contenteditable=''], [contenteditable=true], img, video, canvas, iframe";
    for (const el of document.querySelectorAll(sel)) {
      if (out.length >= 400) break;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (!fullPage && (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)) continue;
      out.push({ x: r.left + sx, y: r.top + sy, width: r.width, height: r.height });
    }
    return out;
  }`;
  return page.evaluate(`(${script})(${JSON.stringify(fullPage)})`).then((b) => (Array.isArray(b) ? (b as Box[]) : []), () => []);
}

/** Width of a PNG, read from its IHDR chunk. */
function pngWidth(png: Buffer): number {
  return png.readUInt32BE(16);
}
