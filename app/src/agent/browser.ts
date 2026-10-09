/**
 * The agent's page (A3a, docs/agent-spec.md "The agent's page"): one page opened through the run's own
 * RunningCheckContext, so the safety gate, the navigation guard, isolation, the run's account, capture and the
 * test-record count all apply as they do for a check. Holds the latest observation and the refs it issued.
 */

import type { Locator, Page, Response } from "playwright";
import { oneLine } from "../ai/schema.js";
import { AGENT_NAVIGATION_TIMEOUT_MS } from "../config/agent.js";
import { NETWORK_IDLE_TIMEOUT_MS } from "../config/runner.js";
import type { RunningCheckContext } from "../engine/context.js";
import type { Capture } from "../core/types.js";
import type { PageObservation } from "../interfaces/agent.js";
import type { AgentToolErrorCode } from "../types/agent.js";
import { toObservation } from "./observe.js";

export interface AgentBrowserOptions {
  /** The run's context for the agent; openPage() opens its start page as the run's account. */
  context: Pick<RunningCheckContext, "openPage" | "escaped" | "blocked">;
  /** The target's origin (the brief's). */
  origin: string;
  /** Redacts secrets and the run accounts' usernames from anything the model is shown. */
  hide: (text: string) => string;
}

type Moved = { status: number | null } | { error: AgentToolErrorCode; message: string };

/** How long a snapshot may take before the observation fails. */
const SNAPSHOT_TIMEOUT_MS = 10_000;
/** How long stopping a stuck load may take before the agent goes on anyway. */
const STOP_TIMEOUT_MS = 2_000;
const ESCAPED = "A redirect left the target, so that page was closed; the start page is open again.";
const BLOCKED = "The navigation guard refused to leave the target.";

/** Whether a response is a failure the page reports as a problem. */
const failed = (request: Capture["requests"][number]): boolean => request.failure !== null || (request.status !== null && request.status >= 400);

export class AgentBrowser {
  readonly #options: AgentBrowserOptions;
  #page!: Page;
  #capture!: Capture;
  /** Capture entries already counted in an observation. */
  #seen = { console: 0, pageErrors: 0, requests: 0 };
  #dialog: PageObservation["dialog"] = null;
  #observations = 0;
  #refs = new Map<string, string>();
  #latest: PageObservation | null = null;

  private constructor(options: AgentBrowserOptions) {
    this.#options = options;
  }

  /** Opens the start page (the context's target URL) and records nothing yet; call observe() for the first observation. */
  static async open(options: AgentBrowserOptions): Promise<AgentBrowser> {
    const browser = new AgentBrowser(options);
    await browser.#openStart();
    return browser;
  }

  async #openStart(): Promise<void> {
    const { page, capture } = await this.#options.context.openPage();
    this.#page = page;
    this.#capture = capture;
    this.#seen = { console: 0, pageErrors: 0, requests: 0 };
    // Dismissed at once, so a page can't stall the agent behind an alert, a confirm or a beforeunload prompt.
    page.on("dialog", (dialog) => {
      this.#dialog = { type: dialog.type(), message: dialog.message() };
      void dialog.dismiss().catch(() => undefined);
    });
  }

  /** The page the agent is on now. */
  get page(): Page {
    return this.#page;
  }

  /** The page's path on the target (no query or hash). */
  get path(): string {
    try {
      const url = new URL(this.#page.url());
      return url.origin === this.#options.origin ? url.pathname : "/";
    } catch {
      return "/";
    }
  }

  /** The latest observation, or null before the first. */
  get latest(): PageObservation | null {
    return this.#latest;
  }

  /**
   * A fresh observation: snapshots the page, counts the problems since the last one, reports a dismissed dialog, and
   * replaces the refs the model may use. `status` is the last navigation's HTTP status (null when there was none).
   */
  async observe(status: number | null = null): Promise<PageObservation> {
    const page = this.#page;
    const snapshot: unknown = await page.ariaSnapshotJSON({ mode: "ai", timeout: SNAPSHOT_TIMEOUT_MS });
    const title = await page.title().catch(() => "");
    const { console: logged, pageErrors, requests } = this.#capture;
    const problems = {
      consoleErrors: logged.slice(this.#seen.console).filter((m) => m.type === "error").length,
      pageErrors: pageErrors.length - this.#seen.pageErrors,
      failedRequests: requests.slice(this.#seen.requests).filter(failed).length,
    };
    this.#seen = { console: logged.length, pageErrors: pageErrors.length, requests: requests.length };
    this.#observations += 1;
    const { observation, refs } = toObservation(
      snapshot,
      { number: this.#observations, origin: this.#options.origin, path: this.path, title: title === "" ? null : title, status, problems, dialog: this.#dialog },
      this.#options.hide,
    );
    this.#dialog = null;
    this.#refs = refs;
    this.#latest = observation;
    return observation;
  }

  /** The element a model ref names, if it is from the latest observation; else `stale-ref`. */
  resolve(ref: string): { locator: Locator } | { error: AgentToolErrorCode } {
    const playwrightRef = typeof ref === "string" ? this.#refs.get(ref) : undefined;
    if (playwrightRef === undefined) return { error: "stale-ref" };
    return { locator: this.#page.locator(`aria-ref=${playwrightRef}`) };
  }

  /**
   * Opens `path` on the target's origin. Returns the response's status, or the failure: `off-target` when the guard
   * refused it or a redirect escaped (then a fresh start page is open), `page-error` for a network error or timeout.
   */
  async goto(path: string): Promise<Moved> {
    return this.#move(() => this.#page.goto(`${this.#options.origin}${path}`, { waitUntil: "load", timeout: AGENT_NAVIGATION_TIMEOUT_MS }));
  }

  /** Goes back one page; `invalid-input` when there is no earlier page. */
  async back(): Promise<Moved> {
    const from = this.#page.url();
    let went = true;
    const moved = await this.#move(async () => {
      const response = await this.#page.goBack({ waitUntil: "load", timeout: AGENT_NAVIGATION_TIMEOUT_MS });
      went = response !== null || this.#page.url() !== from;
      return response;
    });
    if ("error" in moved) return moved;
    if (!went) return { error: "invalid-input", message: "There is no earlier page to go back to." };
    // The history starts at the blank page a context opens with; going back there leaves the target.
    if (this.#page.url() === "about:blank") {
      await this.#page.goForward({ waitUntil: "load", timeout: AGENT_NAVIGATION_TIMEOUT_MS }).catch(() => null);
      return { error: "invalid-input", message: "There is no earlier page to go back to." };
    }
    return moved;
  }

  /** Stops whatever the page is still loading (Chromium's Page.stopLoading, which, unlike a script, doesn't wait for it). */
  async #stopLoading(): Promise<void> {
    const stop = (async () => {
      const cdp = await this.#page.context().newCDPSession(this.#page);
      try {
        await cdp.send("Page.stopLoading");
      } finally {
        await cdp.detach().catch(() => undefined);
      }
    })().catch(() => undefined);
    await Promise.race([stop, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))]);
  }

  /** Runs a navigation and sorts out how it ended. */
  async #move(navigate: () => Promise<Response | null>): Promise<Moved> {
    // The context's escaped and blocked lists are rebuilt on every read, so each is read again after the navigation.
    const context = this.#options.context;
    const before = { escaped: context.escaped.length, blocked: context.blocked.length };
    let response: Response | null = null;
    let failure: unknown = null;
    try {
      response = await navigate();
      // Bounded: a page that polls or keeps a stream open never reaches network idle.
      await this.#page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
    } catch (error) {
      failure = error;
    }
    if (this.#page.isClosed() || context.escaped.length > before.escaped) {
      await this.#openStart();
      return { error: "off-target", message: ESCAPED };
    }
    if (context.blocked.length > before.blocked) return { error: "off-target", message: BLOCKED };
    if (failure !== null) {
      // A navigation that timed out is still loading; stop it, so the observation after it doesn't wait on it.
      await this.#stopLoading();
      const why = failure instanceof Error ? failure.message.split("\n")[0] ?? "" : String(failure);
      return { error: "page-error", message: oneLine(this.#options.hide(`The page didn't load: ${why}`), 200) };
    }
    return { status: response?.status() ?? null };
  }
}
