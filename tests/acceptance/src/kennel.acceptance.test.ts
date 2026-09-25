/**
 * End-to-end acceptance: Run Hound against Kennel in clean mode and with each V0 and V1 bug on.
 * For every mode: start Kennel (KENNEL_BUGS=<mode>), reset, discoverAndPlan(<kennel>/book),
 * approve every scenario (allowDestructive false), runPlan, compare with fixtures/kennel/expected/<mode>.json.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { checks } from "../../../app/src/checks/index.js";
import { CHECK_IDS } from "../../../app/src/core/types.js";
import { discoverAndPlan, runPlan } from "../../../app/src/engine/runner.js";
import { compareToGolden, lineDiff, loadGolden, loadBuiltBugs, observedGolden } from "./golden.js";
import { buildKennel, filesUnder, kennelFakeSecrets, startKennel } from "./kennel.js";

const bugs = await loadBuiltBugs();
const fakeSecrets = await kennelFakeSecrets();
const allModes = ["clean", ...bugs.map((b) => b.id)];
const only = process.env.ACCEPTANCE_MODES?.split(",").map((s) => s.trim()).filter(Boolean);
const modes = only ? allModes.filter((m) => only.includes(m)) : allModes;
const updateGolden = process.env.UPDATE_GOLDEN === "1";
const keepRuns = process.env.KEEP_RUNS === "1";

let runsRoot: string;

beforeAll(async () => {
  await buildKennel();
  runsRoot = await mkdtemp(join(tmpdir(), "rh-acceptance-"));
});

afterAll(async () => {
  if (!runsRoot) return;
  if (keepRuns) console.log(`[acceptance] runs kept in ${runsRoot}`);
  else await rm(runsRoot, { recursive: true, force: true });
});

describe.concurrent("Run Hound against Kennel", () => {
  it.for(modes)("mode %s matches its accepted response", async (mode, { expect }) => {
    const golden = await loadGolden(mode);
    const kennel = await startKennel(mode === "clean" ? "none" : mode);
    try {
      await kennel.reset();

      const plan = await discoverAndPlan(kennel.bookUrl, { checks });
      expect(plan.form.name, "discovered form name").toMatch(/book a sitter/i);
      const planned = new Set(plan.scenarios.map((s) => s.checkId));
      expect(CHECK_IDS.filter((id) => !planned.has(id)), "checks with no planned scenario").toEqual([]);

      const approved = plan.scenarios.map((s) => s.id);
      const { report, dir } = await runPlan(plan, {
        checks,
        approved,
        allowDestructive: false,
        runsDir: join(runsRoot, mode),
      });
      expect([...report.approved].sort(), "every scenario approved").toEqual([...approved].sort());

      // Nothing Run Hound writes may carry a secret it found in Kennel's bundle, in any mode.
      const written = await filesUnder(dir);
      expect(written.some((f) => f.endsWith("report.json")), `files written for ${mode}`).toBe(true);
      for (const file of written.filter((f) => /\.(json|md|html|ts|txt)$/.test(f))) {
        const text = await readFile(file, "utf8");
        for (const secret of fakeSecrets) {
          expect(text.includes(secret), `${file} contains a raw secret from Kennel's bundle`).toBe(false);
        }
      }

      const mismatches = compareToGolden(report, golden);

      if (updateGolden) {
        const observed = observedGolden(report, golden, mode);
        const diff = lineDiff(JSON.stringify(golden, null, 2), JSON.stringify(observed, null, 2));
        console.log(
          `\n[UPDATE_GOLDEN] ${mode}.json: review, then edit fixtures/kennel/expected/${mode}.json by hand ` +
            `(this suite never writes golden files)\n${diff}\n`,
        );
      }

      expect(mismatches, `mode ${mode} (KENNEL_BUGS=${kennel.bugs}) differs from expected/${mode}.json`).toEqual([]);
    } finally {
      await kennel.stop();
    }
  });
});
