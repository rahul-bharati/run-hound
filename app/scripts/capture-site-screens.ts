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
 *
 * AI mode (0.3.0) is opt-in and writes only the AI screens (settings-ai-connected, new-run-plan-ai,
 * new-run-plan-ai-suggested, report-ai-explanation), leaving the others untouched. It needs Ollama on 127.0.0.1:11434
 * with the model pulled:
 *
 *   cd app && pnpm exec tsx scripts/capture-site-screens.ts --ai                                  # ornith-1.5:9b
 *   cd app && RUNHOUND_CAPTURE_AI_MODEL=qwen3:8b pnpm exec tsx scripts/capture-site-screens.ts
 *
 * A 9B model takes about a minute to review the plan and a minute or so per explained finding, so the AI run approves
 * only a few scenarios (AI_SCENARIOS) plus the first suggested flow.
 *
 * Either way the UI gets an empty RUNHOUND_CONFIG_DIR and no RUNHOUND_AI_* variables, so your own AI settings never
 * leak into the captures.
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
const AI_MODEL = process.env.RUNHOUND_CAPTURE_AI_MODEL || (process.argv.includes("--ai") ? "ornith-1.5:9b" : "");
const AI_BASE_URL = process.env.RUNHOUND_CAPTURE_AI_BASE_URL || "http://127.0.0.1:11434/v1";
/** Scenarios approved for the AI report: each finds something on Kennel, and each finding gets an explanation. */
const AI_SCENARIOS = ["double-click-submit", "bundle-secrets:scan-scripts", "golden-path"];

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

/** The AI screens: Settings → AI after a successful test, the plan reviewed by the model, and a finding's explanation. */
async function captureAi(page: Page) {
  const put = await fetch(`${UI}/api/ai`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-run-hound": "1" },
    // A 9B model on a busy machine can take minutes for one answer: the longest per-call timeout allowed.
    body: JSON.stringify({ enabled: true, provider: "ollama", baseUrl: AI_BASE_URL, model: AI_MODEL, timeoutMs: 600_000 }),
  });
  if (!put.ok) throw new Error(`PUT /api/ai: ${put.status} ${await put.text()}`);

  // ---- Settings → AI ------------------------------------------------------------------------------------------
  await page.goto(`${UI}/#/settings`);
  await until(async () => (await page.locator("#ai-model").inputValue()) === AI_MODEL && /on this server/.test(await page.locator("#ai-models-msg").innerText()), "the AI model list");
  await page.click("#ai-test");
  await page.locator("#ai-test-result.ai-ok").waitFor({ timeout: 300_000 });
  await page.mouse.move(0, 0);
  await region(page, page.locator("#ai-card"), page.locator("#ai-test-result"), join(SCREENS, "settings-ai-connected.png"));

  // ---- New run: plan reviewed by the model --------------------------------------------------------------------
  await page.goto(`${UI}/#/new`);
  await page.fill("#target-url", KENNEL);
  await page.locator("#ai-review").check();
  await page.click("#plan-button");
  await page.locator("#plan-section:not([hidden])").waitFor({ timeout: 900_000 });
  const aiLine = (await page.locator("#plan-ai").innerText()).trim();
  if (!aiLine.startsWith("Reviewed by")) throw new Error(`The model did not review the plan: ${aiLine}\n${await page.locator("#plan-warnings").innerText()}`);
  const suggested = page.locator("#scenarios .scenario-row.suggested");
  if ((await suggested.count()) === 0) throw new Error("The model suggested no flows.");
  await page.mouse.move(0, 0);
  await page.locator("#plan-h").evaluate((el) => el.closest("section")!.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
  await page.screenshot({ path: join(SCREENS, "new-run-plan-ai.png") });
  // The first two suggested flows, each with its reason and steps.
  await region(page, suggested.first(), suggested.nth(Math.min(1, (await suggested.count()) - 1)), join(SCREENS, "new-run-plan-ai-suggested.png"), { pad: 1 });

  // ---- A short run: a few scenarios with findings and the first suggested flow ---------------------------------
  const boxes = page.locator('#scenarios input[name="scenario"]');
  const ids = await boxes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const missing = AI_SCENARIOS.filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`Not in the plan: ${missing.join(", ")} (the plan has ${ids.join(", ")})`);
  for (const box of await boxes.all()) await box.setChecked(false);
  for (const id of AI_SCENARIOS) await boxes.and(page.locator(`[value="${id}"]`)).check();
  await suggested.first().locator('input[name="scenario"]').check();
  await page.click("#run-button");
  await page.locator("#report").waitFor({ timeout: 3_600_000 });
  await page.locator('#results [data-scenario-id="double-click-submit"]').first().click();
  const panel = page.locator(".ai-panel");
  await panel.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.mouse.move(0, 0);
  // The built-in "What to ask your AI" at the top, the model's explanation below it.
  await page.locator("#ask-h").evaluate((el) => el.closest("section")!.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
  await page.screenshot({ path: join(SCREENS, "report-ai-explanation.png") });
  console.log(`Wrote the AI screens to ${SCREENS} (model ${AI_MODEL}, run ${page.url().split("#/runs/")[1]}).`);
}

for (const key of Object.keys(process.env)) if (key.startsWith("RUNHOUND_AI")) delete process.env[key];
const configDir = await mkdtemp(join(tmpdir(), "rh-site-config-"));
const runsDir = await mkdtemp(join(tmpdir(), "rh-site-screens-"));
const kennel = await start("node", ["server/index.mjs"], join(REPO, "fixtures/kennel"), { KENNEL_BUGS: "all", PORT: "3160", ANALYTICS_PORT: "3161" }, /kennel listening/);
let ui: { kill(): void };
if (AI_MODEL) {
  // In process rather than `serve`, to give the AI part of planning more than the server's 4-minute budget: a 9B model
  // on a busy machine can need longer to review the plan and suggest flows.
  process.env.RUNHOUND_CONFIG_DIR = configDir;
  const { createApp } = await import("../src/server/app.js");
  const { serve } = await import("@hono/node-server");
  const app = createApp({ runsDir, aiPlanBudgetMs: 1_200_000 });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 4160, hostname: "127.0.0.1" }, () => resolve(s));
  });
  ui = { kill: () => server.close() };
} else {
  ui = await start(process.execPath, ["--import", "tsx", "src/cli.ts", "serve", "--port", "4160", "--runs-dir", runsDir], join(REPO, "app"), { RUNHOUND_CONFIG_DIR: configDir }, /listening on/);
}
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  if (AI_MODEL) {
    await captureAi(page);
  } else {
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
  }
} finally {
  await browser.close();
  ui.kill();
  kennel.kill();
  await rm(runsDir, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
}
