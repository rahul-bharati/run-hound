/**
 * The lab (`pnpm lab`): serves the built site the way the Docker image does (scripts/lab/serve.mjs), runs the lab's
 * Playwright specs against it with node:test, one file at a time, and stops the server by the pid on its port.
 *
 *   NEXT_DIST_DIR=.next-lab pnpm build && NEXT_DIST_DIR=.next-lab pnpm lab [spec ...] [--port 4871]
 *
 * With no spec named, every spec in scripts/lab/specs/ runs but the baseline (it re-measures every page and is run on
 * purpose: `pnpm lab baseline`, with LAB_RECORD_BASELINE=1 to rewrite scripts/lab/baseline.json) and the external
 * links (`pnpm lab external-links`, weekly in CI); a spec is named by
 * its file name ("home" or "home.spec.mjs") or path. The build folder is NEXT_DIST_DIR (or .next); the port is
 * --port, LAB_PORT or 4870. lab-helpers.spec.mjs checks the helpers below on pages it makes itself (it needs no build:
 * node --test scripts/lab/specs/lab-helpers.spec.mjs). Stopped with Ctrl+C or SIGTERM, the run stops its specs and the
 * server before it exits (130 or 143).
 *
 * `--shard <i>/<n>` (1-based) splits the default spec set (never a named one) across `n` CI shards, deterministically
 * (lib/shard.mjs: greedy longest-first bin packing over measured per-spec weights), so e.g. `--shard 2/3` runs only
 * shard 2's specs; every default spec lands in exactly one shard, across every `i`. `--list` prints the specs that
 * would run (after `--shard`, if given) and exits before starting the server, for CI to check the shards line up.
 * `--help`/`-h` prints this header comment and exits 0; an unrecognized `--flag` prints a one-line error and exits 2 --
 * neither ever falls through to running the default lab.
 *
 * What a spec gets (environment): LAB_ORIGIN (the server, e.g. http://127.0.0.1:4870), LAB_OUT (its output folder,
 * site/.lab-out/<lab id>/; see lib/out.mjs), NEXT_DIST_DIR. The helpers a spec uses are in scripts/lab/lib/:
 * - browser.mjs: launch(), newPage(browser, { profile: "desktop" | "phone", reducedMotion, saveData, throttle }),
 *   origin(), slowScroll(), cspViolations(), median();
 * - vitals.mjs: installVitals() / readVitals() (LCP element and time, CLS), readTiming();
 * - page-measures.mjs: measurePage() (visible words in <main>, screens, the site footer's height, headings, tablists,
 *   overflow),
 *   typeAudit() (distinct font sizes, mono share), firstViewport(), textLines();
 * - motion.mjs: installRafCounter() / rafAtStopPoints(), installTextAudit() / readTextAudit() (every element holding
 *   words; inline and computed transforms, GSAP's included), restState();
 * - audits.mjs: runAxe(), accentAudit() (link text exempt, a link's accent fill or border counted; mark the primary
 *   button and the other §2.3 exemptions data-accent-exempt; any colour syntax, oklab() included; an icon counts once),
 *   contrastSample();
 * - timeline.mjs: installFrameSampler() / readFrameSampler() (per selector, per frame: first visible, rest, flash; the
 *   loop stops after `ms`), filmstrip() (a screenshot every step, with frames.json);
 * - requests.mjs: recordRequests() (each request in the phase it was made in; failed ones too), prefetches(),
 *   scriptsIn() (count, failed, gzip, and gsap / scrollTrigger / drawSVG flags);
 * - keyboard.mjs: focusInfo() (ring = what focus adds, never a resting shadow; hidden under the sticky bars stacked
 *   from the top), tabUntil(), tabStops(), reflow(), hiddenTextAfterJump();
 * - screenshots.mjs: fullPage(), shotName(), compareImages() (threshold 0 by default, the one G2's 0.1% gate uses;
 *   it also returns the largest channel difference);
 * - routes.mjs: labRoutes() (the registry's routes, and a path for the 404); out.mjs: labOut(), writeJson().
 *
 * Chromium comes from the site's Playwright (1.63): install it once with `pnpm exec playwright install chromium`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { distName, siteDir } from "../lib/build-output.mjs";
import { labOut } from "./lib/out.mjs";
import { packShards } from "./lib/shard.mjs";
import { defaultPort, startServer } from "./serve.mjs";

const args = process.argv.slice(2);

/** The one-line synopsis an unrecognized flag's error is shown with; --help/-h show the full header comment below. */
const usage = "Usage: pnpm lab [spec ...] [--port <n>] [--shard <i>/<n>] [--list] [--help]";
const knownFlags = ["--port", "--shard", "--list", "--help"];

if (args.includes("--help") || args.includes("-h")) {
  // The file's own header comment (this doc block) is the one source of truth for usage, so --help can't drift from
  // it: read this file, take everything between the opening /** and the closing */, and strip the comment markers.
  const source = readFileSync(join(import.meta.dirname, "run.mjs"), "utf8");
  const header = /^\/\*\*\n([\s\S]*?)\n \*\//.exec(source)?.[1] ?? "";
  console.log(header.replace(/^ \* ?/gm, "").trimEnd());
  process.exit(0);
}

const unrecognized = args.find((arg) => arg.startsWith("--") && !knownFlags.includes(arg));
if (unrecognized) {
  console.error(`lab: unrecognized option ${JSON.stringify(unrecognized)}. ${usage}`);
  process.exit(2);
}

const at = args.indexOf("--port");
const port = at >= 0 ? Number(args[at + 1]) : defaultPort;
const shardAt = args.indexOf("--shard");
const shardOption = shardAt >= 0 ? args[shardAt + 1] : undefined;
const list = args.includes("--list");
const names = args.filter(
  (arg, i) => !arg.startsWith("--") && args[i - 1] !== "--port" && args[i - 1] !== "--shard",
);
const specsDir = join(import.meta.dirname, "specs");
/**
 * Specs that run only when named: the baseline (it re-measures every page) and the external links (the network, and
 * non-blocking: .github/workflows/site-links.yml runs it weekly).
 */
const namedOnly = ["baseline.spec.mjs", "external-links.spec.mjs"];

const all = existsSync(specsDir) ? readdirSync(specsDir).filter((name) => name.endsWith(".spec.mjs")).sort() : [];
const defaultSet = all.filter((spec) => !namedOnly.includes(spec));

let specNames = defaultSet;
if (shardOption !== undefined) {
  if (names.length) throw new Error("lab: --shard splits the default spec set; it can't be combined with a named spec");
  const match = /^(\d+)\/(\d+)$/.exec(shardOption);
  if (!match) throw new Error(`lab: --shard must be "<index>/<count>" (1-based), got ${JSON.stringify(shardOption)}`);
  const [index, count] = [Number(match[1]), Number(match[2])];
  if (index < 1 || index > count) throw new Error(`lab: --shard ${shardOption}: index must be between 1 and ${count}`);
  specNames = packShards(defaultSet, count)[index - 1];
}

const specs = names.length
  ? names.map((name) => {
      const direct = resolve(name);
      if (existsSync(direct)) return direct;
      const file = all.find((spec) => spec === name || spec === `${name}.spec.mjs` || basename(spec, ".spec.mjs") === name);
      if (!file) throw new Error(`lab: no spec "${name}" in ${relative(siteDir, specsDir)} (${all.join(", ")})`);
      return join(specsDir, file);
    })
  : specNames.map((spec) => join(specsDir, spec));
if (specs.length === 0) {
  console.error("lab: no specs to run");
  process.exit(1);
}

if (list) {
  for (const spec of specs) console.log(basename(spec));
  process.exit(0);
}

const server = await startServer({ port });
console.log(`lab: ${distName} served at ${server.origin} (pid ${server.pid}); output in ${relative(siteDir, labOut())}`);
let child;
// Stopped from outside (Ctrl+C, a CI cancellation, `timeout`, a kill of this pid): the specs get the signal, and once
// they have stopped (or 5 s later, killed), the server is stopped as at the end of a run, so nothing keeps listening
// on the port. The run then exits 130 or 143, as a shell reports a stopped command.
let stoppedBy;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stoppedBy) return;
    stoppedBy = signal;
    console.log(`lab: ${signal}: stopping the specs and the server`);
    child?.kill(signal);
    setTimeout(() => child?.kill("SIGKILL"), 5_000).unref();
  });
}
let code = 1;
try {
  code = await new Promise((resolveRun) => {
    child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...specs], {
      cwd: siteDir,
      stdio: "inherit",
      env: { ...process.env, LAB_ORIGIN: server.origin, LAB_OUT: labOut(), NEXT_DIST_DIR: distName },
    });
    child.on("exit", (exit) => resolveRun(exit ?? 1));
  });
} finally {
  const pid = await server.stop();
  console.log(`lab: stopped the server (pid ${pid ?? server.pid}) on port ${port}`);
}
process.exit(stoppedBy ? (stoppedBy === "SIGINT" ? 130 : 143) : code);
