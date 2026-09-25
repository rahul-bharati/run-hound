/**
 * Captures the marketing site's product screenshots and evidence from a real run of the web UI on Kennel with every
 * planted bug on, and writes them into site/src/assets. Run it after a UI change or a release:
 *
 *   pnpm --filter kennel build
 *   cd app && pnpm exec tsx scripts/capture-site-screens.ts
 *
 * Screens are 3840x2160 (a 1920x1080 window at 2x); the How it works steps are crops of the same pages. Evidence
 * files are copied from the run's artifacts. The GIFs' still images (site/src/assets/evidence/*-still.png) are the
 * GIF's last frame; the script writes them with a tiny in-browser GIF decode.
 *
 * Kennel runs on 3160/3161 and Run Hound on 4160, like the earlier captures; both must be free.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "playwright";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCREENS = join(REPO, "site/src/assets/screens");
const EVIDENCE = join(REPO, "site/src/assets/evidence");
const KENNEL = "http://localhost:3160/book";
const UI = "http://127.0.0.1:4160";

function start(cmd: string, args: string[], cwd: string, env: Record<string, string>, ready: RegExp): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      if (ready.test(out)) resolve(child);
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => reject(new Error(`${cmd} ${args.join(" ")} exited ${code}:\n${out}`)));
  });
}

/** Screenshot of the region spanning `from` (top) to `to` (bottom), across the page column, capped at `maxHeight`. */
async function region(page: Page, from: Locator, to: Locator, path: string, options: { maxHeight?: number; pad?: number } = {}) {
  const pad = options.pad ?? 16;
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const col = (await page.locator("#view .page, #view > *").first().boundingBox())!;
  const top = Math.max(0, a.y - pad);
  const bottom = Math.min(b.y + b.height + pad, top + (options.maxHeight ?? 10_000));
  await page.screenshot({ path, clip: { x: col.x - pad, y: top, width: col.width + 2 * pad, height: bottom - top } });
}

async function until(test: () => Promise<boolean>, what: string, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await test().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const runsDir = await mkdtemp(join(tmpdir(), "rh-site-screens-"));
const kennel = await start("node", ["server/index.mjs"], join(REPO, "fixtures/kennel"), { KENNEL_BUGS: "all", PORT: "3160", ANALYTICS_PORT: "3161" }, /kennel listening/);
const ui = await start(process.execPath, ["--import", "tsx", "src/cli.ts", "serve", "--port", "4160", "--runs-dir", runsDir], join(REPO, "app"), {}, /listening on/);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  // ---- New run: plan ----------------------------------------------------------------------------------------
  await page.goto(`${UI}/#/new`);
  await page.fill("#target-url", KENNEL);
  await page.click("#plan-button");
  await page.locator("#plan-section:not([hidden])").waitFor({ timeout: 60_000 });
  await page.mouse.move(0, 0);
  await region(page, page.locator(".page-head"), page.locator("#page-inventory"), join(SCREENS, "steps/explore.png"));
  const groups = page.locator("#scenarios .group");
  await region(page, groups.nth(0), groups.nth(1), join(SCREENS, "steps/plan.png"), { maxHeight: 1045 });
  await region(page, groups.last(), page.locator(".plan-actions"), join(SCREENS, "steps/approve.png"));
  await page.locator("#plan-h").evaluate((el) => el.closest("section")!.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
  await page.screenshot({ path: join(SCREENS, "new-run-plan-groups.png") });

  // ---- Running view -------------------------------------------------------------------------------------------
  await page.click("#run-button");
  await page.locator("#running").waitFor({ timeout: 30_000 });
  const row = (id: string) => page.locator(`#scenario-list [data-scenario-id="${id}"]`);
  // Scenario 2: the keyboard walk, with several Tab steps expanded.
  // Late enough that the date fields are typed in full.
  await until(async () => (await row("keyboard-completion:keyboard-only").getAttribute("data-status")) === "running" && (await row("keyboard-completion:keyboard-only").locator("li").count()) >= 10, "the keyboard scenario's Tab steps");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SCREENS, "live-view-mid-run-2.png") });
  // Scenario 8: clicking every button (long enough to catch), with the filled form in the live preview. The golden
  // path before it is over in under 2 s.
  await until(async () => (await row("activate-controls").getAttribute("data-status")) === "running" && (await row("activate-controls").locator("li").count()) >= 2, "the button scenario");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SCREENS, "live-view-mid-run.png") });
  await page.screenshot({ path: join(SCREENS, "steps/run.png"), clip: { x: 240, y: 0, width: 1512, height: 631 } });

  // ---- Report -------------------------------------------------------------------------------------------------
  await page.locator("#report").waitFor({ timeout: 600_000 });
  await page.locator('#results [data-scenario-id="double-click-submit"]').first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SCREENS, "report-inline-evidence.png") });
  await page.screenshot({ path: join(SCREENS, "steps/report.png"), clip: { x: 240, y: 0, width: 1512, height: 820 } });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SCREENS, "report-playwright-test.png") });

  // ---- Evidence from the run's report -------------------------------------------------------------------------
  const runId = page.url().split("#/runs/")[1]!;
  const report = JSON.parse(await readFile(join(runsDir, runId, "report.json"), "utf8")) as {
    findings: { checkId: string; evidence: { kind: string; path?: string }[] }[];
  };
  const pick = (checkId: string, kind: string) => {
    const e = report.findings.find((f) => f.checkId === checkId)?.evidence.find((x) => x.kind === kind && x.path);
    if (!e) throw new Error(`No ${kind} evidence for ${checkId}`);
    return join(runsDir, runId, "artifacts", e.path!);
  };
  const files: [string, string, string][] = [
    ["double-submit", "gif", "double-submit-recording.gif"],
    ["double-submit", "card", "double-submit-two-requests.png"],
    ["silent-failure", "gif", "silent-failure-recording.gif"],
    ["focus-visible", "frame", "no-visible-focus.png"],
    ["bundle-secrets", "card", "secret-key-in-bundle.png"],
    ["pii-leak", "card", "email-to-third-party.png"],
    ["cors", "card", "cors-readable-by-any-site.png"],
    ["security-headers", "card", "missing-security-headers.png"],
  ];
  for (const [checkId, kind, name] of files) await copyFile(pick(checkId, kind), join(EVIDENCE, name));

  // Stills: the last frame of each GIF, decoded by the browser (an <img> shows only the first frame, so the GIF is
  // decoded with ImageDecoder).
  const still = await browser.newPage();
  // ImageDecoder needs a secure context: the local UI (127.0.0.1) is one, about:blank is not.
  await still.goto(UI);
  for (const name of ["double-submit-recording", "silent-failure-recording"]) {
    const gif = (await readFile(join(EVIDENCE, `${name}.gif`))).toString("base64");
    const png = (await still.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decoder = new ImageDecoder({ data: bytes, type: "image/gif" });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack!.frameCount;
      const { image } = await decoder.decode({ frameIndex: count - 1 });
      const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const byte of buf) s += String.fromCharCode(byte);
      return btoa(s);
    }, gif)) as string;
    await writeFile(join(EVIDENCE, `${name}-still.png`), Buffer.from(png, "base64"));
  }
  console.log(`Wrote screens to ${SCREENS} and evidence to ${EVIDENCE} (run ${runId}).`);
} finally {
  await browser.close();
  ui.kill();
  kennel.kill();
  await rm(runsDir, { recursive: true, force: true });
}
