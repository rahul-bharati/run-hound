/**
 * Captures the marketing site's product screenshots and evidence from real runs of the web UI, and writes them into
 * site/src/assets. Run it after a UI change or a release, in three modes:
 *
 *   pnpm --filter kennel build && pnpm --filter fernway build
 *   cd app && pnpm exec tsx scripts/capture-site-screens.ts          # Kennel: the V0/V1 screens and evidence
 *   cd app && pnpm exec tsx scripts/capture-site-screens.ts --ai     # Kennel with a local model: the AI screens
 *   cd app && pnpm exec tsx scripts/capture-site-screens.ts --v2     # Fernway: test accounts, signed-in runs, AI-built UIs
 *
 * Screens are 3840x2160 (a 1920x1080 window at 2x); the How it works steps and a few narrower screens are crops of the
 * same pages. Evidence files are copied from the run's artifacts. The GIFs' still images
 * (site/src/assets/evidence/*-still.png) are the GIF's last frame; the script writes them with a tiny in-browser GIF
 * decode.
 *
 * Default mode: Kennel with every planted bug on (3160/3161), Run Hound on 4160. Writes the plan, live view, report,
 * How it works steps and the evidence files.
 *
 * AI mode (0.3.0) writes only the AI screens (settings-ai-connected, new-run-plan-ai, new-run-plan-ai-suggested,
 * report-ai-explanation), leaving the others untouched. It needs Ollama on 127.0.0.1:11434 with the model pulled:
 *
 *   cd app && pnpm exec tsx scripts/capture-site-screens.ts --ai                                  # ornith-1.5:9b
 *   cd app && RUNHOUND_CAPTURE_AI_MODEL=qwen3:8b pnpm exec tsx scripts/capture-site-screens.ts
 *
 * A 9B model takes about a minute to review the plan and a minute or so per explained finding, so the AI run approves
 * only a few scenarios (AI_SCENARIOS) plus the first suggested flow.
 *
 * V2 mode (0.4.0) writes only the V2 and Fernway screens (fernway-*, settings-test-accounts, new-run-signed-in,
 * report-access-control, report-mass-assignment). It starts Fernway twice, clean on 4170 and with every planted bug on
 * 4171, and Run Hound on 4165; it sets up Fernway's two seeded accounts (Alex as account A, Sam as B) through Settings →
 * Test accounts, plans and runs /app/settings signed in as account A with every scenario ticked (mass assignment
 * included), and plans and runs Fernway's landing page signed out. The live view of a signed-in run isn't masked, so
 * it is never captured; every signed-in screen is checked for the accounts' usernames and passwords before it is kept.
 *
 * Every mode gives the UI an empty RUNHOUND_CONFIG_DIR and no RUNHOUND_AI_* or RUNHOUND_ACCOUNT* variables, so your own
 * AI settings and test accounts never leak into the captures. `--keep` keeps the runs folder (for reading the reports
 * the captions describe) and prints where it is.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "playwright";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCREENS = join(REPO, "site/src/assets/screens");
const EVIDENCE = join(REPO, "site/src/assets/evidence");
const KENNEL = "http://localhost:3160/book";
const AI_MODEL = process.env.RUNHOUND_CAPTURE_AI_MODEL || (process.argv.includes("--ai") ? "ornith-1.5:9b" : "");
const AI_BASE_URL = process.env.RUNHOUND_CAPTURE_AI_BASE_URL || "http://127.0.0.1:11434/v1";
const MODE: "kennel" | "ai" | "v2" = AI_MODEL ? "ai" : process.argv.includes("--v2") ? "v2" : "kennel";
const KEEP = process.argv.includes("--keep");
const UI_PORT = MODE === "v2" ? 4165 : 4160;
const UI = `http://127.0.0.1:${UI_PORT}`;
/** Scenarios approved for the AI report: each finds something on Kennel, and each finding gets an explanation. */
const AI_SCENARIOS = ["double-click-submit", "bundle-secrets:scan-scripts", "golden-path"];

/** Fernway clean (the AI-built UI screens) and with every planted bug on (the signed-in run). */
const FERNWAY = "http://localhost:4170";
const FERNWAY_BUGS = "http://localhost:4171";
/**
 * Fernway's seeded accounts (fixtures/fernway/server/seed.mjs ACCOUNTS, fixtures/fernway/README.md "Accounts"): Alex is
 * Run Hound's account A, Sam account B. The usernames may be seen only on the Settings screen; the passwords nowhere.
 */
const FERNWAY_ACCOUNTS = [
  { id: "a", username: "alex@fernway.test", password: "correct-horse-battery" },
  { id: "b", username: "sam@fernway.test", password: "staple-lemon-orbit" },
] as const;

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

/**
 * Screenshot of the region spanning `from` (top) to `to` (bottom), across the page column, capped at `maxHeight`. The
 * window is scrolled so the region starts at its top edge, so a region lower on the page isn't cut off at the bottom.
 */
async function region(
  page: Page,
  from: Locator,
  to: Locator,
  path: string,
  options: { maxHeight?: number; pad?: number; padTop?: number } = {},
) {
  const pad = options.pad ?? 16;
  const padTop = options.padTop ?? pad;
  await from.scrollIntoViewIfNeeded();
  const first = (await from.boundingBox())!;
  await page.evaluate((dy) => window.scrollBy(0, dy), first.y - padTop);
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const col = (await page.locator("#view .page, #view > *").first().boundingBox())!;
  const top = Math.max(0, a.y - padTop);
  const bottom = Math.min(b.y + b.height + pad, top + (options.maxHeight ?? 10_000));
  const height = page.viewportSize()!.height;
  if (bottom > height) throw new Error(`${path}: the region is ${Math.round(bottom - top)} px tall, more than the ${height} px window`);
  await page.screenshot({ path, clip: { x: col.x - pad, y: top, width: col.width + 2 * pad, height: bottom - top } });
}

/** The main column of the running view (.run-grid) or the report (.report), from the sidebar's edge, `height` px tall. */
async function column(page: Page, selector: string, path: string, height: number) {
  const box = (await page.locator(selector).boundingBox())!;
  const side = (await page.locator("#sidebar").boundingBox())!;
  const x = side.x + side.width;
  const gutter = box.x - x;
  await page.screenshot({ path, clip: { x, y: 0, width: box.width + 2 * gutter, height } });
}

async function until(test: () => Promise<boolean>, what: string, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await test().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** The window scrolled so `el`'s section starts 24 px from the top. */
async function scrollToSection(page: Page, selector: string) {
  await page.locator(selector).evaluate((el) => (el.closest("section") ?? el).scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
}

/**
 * Refuses a screen that shows a test account's password (in text or in a field) or, outside Settings, its username. It
 * reads the page's text only: the images inside it (evidence cards and frames) still need a look before they ship.
 */
async function assertNoAccountSecrets(page: Page, what: string, usernamesAllowed = false) {
  const text = await page.evaluate(() => {
    const values = [...document.querySelectorAll("input, textarea")].map((el) => (el as HTMLInputElement).value);
    return `${document.body.innerText}\n${values.join("\n")}`.toLowerCase();
  });
  for (const account of FERNWAY_ACCOUNTS) {
    if (text.includes(account.password)) throw new Error(`${what}: account ${account.id}'s password is on the page`);
    if (!usernamesAllowed && text.includes(account.username)) throw new Error(`${what}: account ${account.id}'s username is on the page`);
  }
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
  await scrollToSection(page, "#plan-h");
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
  await scrollToSection(page, "#ask-h");
  await page.screenshot({ path: join(SCREENS, "report-ai-explanation.png") });
  console.log(`Wrote the AI screens to ${SCREENS} (model ${AI_MODEL}, run ${page.url().split("#/runs/")[1]}).`);
}

/** The V0/V1 screens and evidence: a plan, the live view, the report and the evidence files of a run on Kennel. */
async function captureKennel(page: Page, browser: Browser, runsDir: string) {
  // ---- New run: plan ----------------------------------------------------------------------------------------
  await page.goto(`${UI}/#/new`);
  await page.fill("#target-url", KENNEL);
  await page.click("#plan-button");
  await page.locator("#plan-section:not([hidden])").waitFor({ timeout: 60_000 });
  await page.mouse.move(0, 0);
  await region(page, page.locator(".page-head"), page.locator("#page-inventory"), join(SCREENS, "steps/explore.png"));
  const groups = page.locator("#scenarios .group");
  // The Accessibility group; a smaller top margin keeps the sign-in notice above it out of the crop.
  await region(page, groups.nth(0), groups.nth(0), join(SCREENS, "steps/plan.png"), { padTop: 8 });
  await region(page, groups.last(), page.locator(".plan-actions"), join(SCREENS, "steps/approve.png"), { padTop: 8 });
  await scrollToSection(page, "#plan-h");
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
  await column(page, "#running", join(SCREENS, "steps/run.png"), 631);

  // ---- Report -------------------------------------------------------------------------------------------------
  await page.locator("#report").waitFor({ timeout: 600_000 });
  await page.locator('#results [data-scenario-id="double-click-submit"]').first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SCREENS, "report-inline-evidence.png") });
  await column(page, "#report", join(SCREENS, "steps/report.png"), 820);
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

/** Waits for the run started from the plan on screen to finish, and returns its id. */
async function finishRun(page: Page, timeoutMs: number): Promise<string> {
  await page.locator("#report").waitFor({ timeout: timeoutMs });
  await page.waitForTimeout(1000);
  return page.url().split("#/runs/")[1]!;
}

/** Plans `url` in New Run, signed in as `account` ("" for signed out), and waits for the plan. */
async function planPage(page: Page, url: string, account: "" | "a" | "b") {
  // A fresh load: New Run keeps the last plan in memory and shows it again.
  await page.goto(`${UI}/#/new`);
  await page.reload();
  await page.fill("#target-url", url);
  if (account) await until(async () => (await page.locator(`#sign-in-as option[value="${account}"]`).isEnabled()), `account ${account} in Sign in as`);
  await page.selectOption("#sign-in-as", account);
  const planned = page.waitForResponse((r) => r.url().endsWith("/api/plan") && r.request().method() === "POST", { timeout: 300_000 });
  await page.click("#plan-button");
  if (!(await planned).ok()) throw new Error(`Planning ${url} failed: ${await page.locator("#target-error").innerText()}`);
  await page.locator("#plan-section:not([hidden])").waitFor({ timeout: 30_000 });
  await until(async () => (await page.locator("#plan-button").innerText()) === "Plan checks", "the plan on screen");
  await page.mouse.move(0, 0);
}

/**
 * One result of the report on screen, selected, with its evidence images loaded; the window scrolled to the top.
 * `issues` shows the Issues tab first, so a finding low in a long list stays in view with the list scrolled to its top;
 * `evidence` picks that card of the finding's evidence strip.
 */
async function selectResult(page: Page, scenarioId: string, options: { issues?: boolean; evidence?: number } = {}) {
  if (options.issues) await page.locator('#report [role="tab"]', { hasText: /^Issues/ }).click();
  const row = page.locator(`#results [data-scenario-id="${scenarioId}"]`).first();
  await row.click();
  if (options.evidence) await page.locator("#detail .strip button").nth(options.evidence).click();
  await page.waitForTimeout(800);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  // The click scrolled the results list to the row; back to its top, so no row is cut in half there.
  await row.evaluate((el) => {
    el.closest(".results-panel")?.scrollTo(0, 0);
  });
  const visible = await row.evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight);
  if (!visible) throw new Error(`${scenarioId}: the row is below the window with the results list at its top`);
  await until(async () => page.locator("#detail img").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)), `the evidence of ${scenarioId}`, 30_000);
}

/** The V2 preview and AI-built UI screens, on Fernway: see the header comment. */
async function captureV2(page: Page, runsDir: string) {
  // ---- Fernway itself, the app under test: its landing page at desktop size ----------------------------------
  await page.goto(`${FERNWAY}/`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true })))));
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SCREENS, "fernway-landing.png") });

  // ---- Settings → Test accounts: Fernway's two accounts, saved and tested --------------------------------------
  await page.goto(`${UI}/#/settings`);
  await page.locator("#acct-a-save").waitFor({ timeout: 30_000 });
  for (const account of FERNWAY_ACCOUNTS) {
    const pre = `#acct-${account.id}-`;
    await page.fill(`${pre}loginUrl`, `${FERNWAY_BUGS}/login`);
    await page.fill(`${pre}username`, account.username);
    await page.fill(`${pre}password`, account.password);
    await page.click(`${pre}save`);
    await until(async () => /^Saved at/.test(await page.locator(`${pre}saved`).innerText()), `account ${account.id} saved`);
    await page.click(`${pre}test`);
    await page.locator(`${pre}test-result.acct-ok`).waitFor({ timeout: 90_000 });
  }
  await page.mouse.move(0, 0);
  await assertNoAccountSecrets(page, "Settings → Test accounts", true);
  // Down to the "must not see each other's data" setting; the line under it names this run's temporary folder.
  await region(page, page.locator("#accounts-card"), page.locator("#accounts-card .acct-isolated"), join(SCREENS, "settings-test-accounts.png"));

  // ---- Fernway's landing page, signed out: widgets, a form in a dialog, and a run on the clean app ---------------
  await planPage(page, `${FERNWAY}/`, "");
  await scrollToSection(page, "#plan-h");
  await page.screenshot({ path: join(SCREENS, "fernway-plan-landing.png") });
  await page.click("#run-button");
  await page.locator("#running").waitFor({ timeout: 30_000 });
  const row = (id: string) => page.locator(`#scenario-list [data-scenario-id="${id}"]`);
  // Each form's golden path as it starts to submit (the preview is about half a second behind the steps): the waitlist
  // with its Radix Team size select just set, then the "Book a demo" dialog, opened and filled, its Radix select and
  // checkbox included. Earlier or later frames show the page before the fill or after the dialog closed.
  for (const [id, name] of [["golden-path", "fernway-live-waitlist.png"], ["golden-path@form-3", "fernway-live-dialog.png"]] as const) {
    await until(async () => (await row(id).getAttribute("data-status")) === "running" && /Submitting the form/.test(await row(id).innerText()), `${id} submitting`, 600_000);
    await page.screenshot({ path: join(SCREENS, name) });
  }
  const cleanRun = await finishRun(page, 1_800_000);
  // The keyboard walk through the dialog's form: Tab reached every field, the Radix select and checkbox included.
  await selectResult(page, "keyboard-completion:keyboard-only@form-3");
  await page.screenshot({ path: join(SCREENS, "fernway-report-clean.png") });

  // ---- New run signed in as account A: Fernway's settings page with every planted bug on ----------------------
  await fetch(`${FERNWAY_BUGS}/api/__reset`, { method: "POST" });
  await planPage(page, `${FERNWAY_BUGS}/app/settings`, "a");
  await page.evaluate(() => window.scrollTo(0, 0));
  await assertNoAccountSecrets(page, "New Run signed in");
  await page.screenshot({ path: join(SCREENS, "new-run-signed-in.png") });
  // Every scenario, mass assignment (unticked by default) included. The live view isn't masked: never captured.
  for (const box of await page.locator('#scenarios input[name="scenario"]').all()) await box.setChecked(true);
  await page.click("#run-button");
  const signedInRun = await finishRun(page, 1_800_000);
  await selectResult(page, "access-control:other-account", { issues: true });
  await assertNoAccountSecrets(page, "access-control finding");
  await page.screenshot({ path: join(SCREENS, "report-access-control.png") });
  // Its third card: the record read back after the replay, with every injected field the server stored.
  await selectResult(page, "mass-assignment:privilege-fields", { issues: true, evidence: 2 });
  await assertNoAccountSecrets(page, "mass-assignment finding");
  await page.screenshot({ path: join(SCREENS, "report-mass-assignment.png") });

  // What the captions describe, from the reports.
  for (const runId of [cleanRun, signedInRun]) {
    const report = JSON.parse(await readFile(join(runsDir, runId, "report.json"), "utf8")) as {
      target: string;
      durationMs?: number;
      results: { scenarioId: string; status: string }[];
      findings: { checkId: string; title: string; severity: string; advisory?: boolean }[];
    };
    const statuses: Record<string, number> = {};
    for (const r of report.results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    console.log(`Run ${runId} (${report.target}): ${JSON.stringify(statuses)}, ${report.findings.length} findings, ${report.durationMs} ms`);
    for (const f of report.findings) console.log(`  ${f.severity} ${f.checkId}: ${f.title}${f.advisory ? " [advisory]" : ""}`);
  }
  console.log(`Wrote the V2 screens to ${SCREENS}.`);
}

for (const key of Object.keys(process.env)) if (key.startsWith("RUNHOUND_AI") || key.startsWith("RUNHOUND_ACCOUNT")) delete process.env[key];
const configDir = await mkdtemp(join(tmpdir(), "rh-site-config-"));
const runsDir = await mkdtemp(join(tmpdir(), "rh-site-screens-"));
const apps: ChildProcess[] = [];
let ui: { kill(): void } | null = null;
const browser = await chromium.launch();
try {
  if (MODE === "v2") {
    const fernway = join(REPO, "fixtures/fernway");
    apps.push(await start("node", ["server/index.mjs"], fernway, { FERNWAY_BUGS: "none", PORT: "4170" }, /fernway listening/));
    apps.push(await start("node", ["server/index.mjs"], fernway, { FERNWAY_BUGS: "all", PORT: "4171" }, /fernway listening/));
  } else {
    apps.push(await start("node", ["server/index.mjs"], join(REPO, "fixtures/kennel"), { KENNEL_BUGS: "all", PORT: "3160", ANALYTICS_PORT: "3161" }, /kennel listening/));
  }
  if (MODE === "ai") {
    // In process rather than `serve`, to give the AI part of planning more than the server's 4-minute budget: a 9B model
    // on a busy machine can need longer to review the plan and suggest flows.
    process.env.RUNHOUND_CONFIG_DIR = configDir;
    const { createApp } = await import("../src/server/app.js");
    const { serve } = await import("@hono/node-server");
    const app = createApp({ runsDir, aiPlanBudgetMs: 1_200_000 });
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, port: UI_PORT, hostname: "127.0.0.1" }, () => resolve(s));
    });
    ui = { kill: () => server.close() };
  } else {
    ui = await start(process.execPath, ["--import", "tsx", "src/cli.ts", "serve", "--port", String(UI_PORT), "--runs-dir", runsDir], join(REPO, "app"), { RUNHOUND_CONFIG_DIR: configDir }, /listening on/);
  }
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  if (MODE === "ai") await captureAi(page);
  else if (MODE === "v2") await captureV2(page, runsDir);
  else await captureKennel(page, browser, runsDir);
} finally {
  await browser.close();
  ui?.kill();
  for (const app of apps) app.kill();
  if (KEEP) console.log(`Kept the runs in ${runsDir}.`);
  else await rm(runsDir, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
}
