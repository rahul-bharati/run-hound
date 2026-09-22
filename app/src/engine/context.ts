import { randomBytes } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright";
import type { CheckContext, DiscoveredForm, Evidence } from "../core/types.js";
import { attachCapture } from "./capture.js";
import { guardContext, type NavigationGuard } from "./guard.js";
import { redactSecrets } from "./redact.js";
import type { SafetyOptions } from "./safety.js";

export interface ContextOptions extends SafetyOptions {
  browser: Browser;
  form: DiscoveredForm;
  targetUrl: string;
  artifactsDir: string;
  allowDestructive?: boolean;
  runToken?: string;
  log?: (message: string) => void;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

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

export interface RunningCheckContext extends CheckContext {
  dispose(): Promise<void>;
  /** Navigations off the allowed targets that were refused before they were sent. */
  readonly blocked: string[];
  /** Refused hosts a redirect reached anyway; the browser context was closed when it happened. */
  readonly escaped: string[];
}

/**
 * Real CheckContext. openPage() creates a new BrowserContext (default viewport 1280x800), installs the
 * navigation guard (see guard.ts), attaches capture, navigates to targetUrl and waits for network idle.
 * screenshot() writes a PNG under artifactsDir and returns evidence with a path relative to artifactsDir.
 * Contexts opened through it are closed by the returned dispose(). Log lines are redacted.
 */
export function createCheckContext(options: ContextOptions): RunningCheckContext {
  const contexts: BrowserContext[] = [];
  const guards: NavigationGuard[] = [];
  let shots = 0;

  return {
    get blocked() {
      return guards.flatMap((g) => g.blocked);
    },
    get escaped() {
      return guards.flatMap((g) => g.escaped);
    },

    browser: options.browser,
    form: options.form,
    targetUrl: options.targetUrl,
    artifactsDir: options.artifactsDir,
    allowDestructive: options.allowDestructive ?? false,
    runToken: options.runToken ?? newRunToken(),

    async openPage(pageOptions = {}) {
      const context = await options.browser.newContext({ viewport: pageOptions.viewport ?? DEFAULT_VIEWPORT });
      contexts.push(context);
      guards.push(await guardContext(context, { allowedHosts: options.allowedHosts, lookup: options.lookup }));
      const page = await context.newPage();
      const capture = attachCapture(page);
      await page.goto(options.targetUrl, { waitUntil: "networkidle" });
      return { context, page, capture };
    },

    async screenshot(page, label): Promise<Evidence> {
      await mkdir(options.artifactsDir, { recursive: true });
      // Numbered names keep screenshots in the order they were taken; skip names another context already used.
      let file: string;
      do {
        shots += 1;
        file = `${String(shots).padStart(3, "0")}-${slug(label)}.png`;
      } while (await exists(join(options.artifactsDir, file)));
      await page.screenshot({ path: join(options.artifactsDir, file), fullPage: true });
      return { kind: "screenshot", label, path: file };
    },

    log(message) {
      options.log?.(redactSecrets(message));
    },

    async dispose() {
      const open = contexts.splice(0);
      await Promise.all(open.map((c) => c.close().catch(() => undefined)));
    },
  };
}
