// A build in another folder than .next (NEXT_DIST_DIR, next.config.ts) must type-check what the default build checks,
// including that folder's route types: <folder>/types/validator.ts is where Next.js checks each page's and route
// handler's exports (a dynamic route whose params aren't a Promise fails there). `pnpm test`.
//
// The config is loaded the way `next build` loads it (next/dist/server/config), in a child process per environment.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";

const siteDir = join(import.meta.dirname, "..");
// Other nodes run `pnpm test` in this checkout at the same time: a folder name of this process's own.
const folder = `.next-dist-test-${process.pid}`;
const tsconfigName = `tsconfig.${folder.slice(1)}.json`;
after(() => {
  rmSync(join(siteDir, folder), { recursive: true, force: true });
  rmSync(join(siteDir, tsconfigName), { force: true });
});

/** next.config.ts as `next build` resolves it, with NEXT_DIST_DIR set to `distDir` ("" for unset). */
function loadConfig(distDir) {
  const code = `
    const { PHASE_PRODUCTION_BUILD } = require("next/constants");
    require("next/dist/server/config").default(PHASE_PRODUCTION_BUILD, ${JSON.stringify(siteDir)}).then(
      (config) => { process.stdout.write("\\n@@" + JSON.stringify({ distDir: config.distDir, typescript: config.typescript })); process.exit(0); },
      (error) => { console.error(error); process.exit(1); },
    );`;
  const run = spawnSync(process.execPath, ["-e", code], {
    cwd: siteDir,
    encoding: "utf8",
    env: { ...process.env, NEXT_DIST_DIR: distDir },
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.split("@@").at(-1));
}

describe("NEXT_DIST_DIR: a side build type-checks like the default one", () => {
  test("a build in .next uses tsconfig.json, as Docker and CI do", () => {
    const config = loadConfig("");
    assert.equal(config.distDir, ".next");
    // Unset is tsconfig.json: Next.js reads `tsconfigPath || "tsconfig.json"` (lib/verify-typescript-setup.js,
    // build/load-jsconfig.js), so the default build's config stays as it was.
    assert.equal(config.typescript.tsconfigPath ?? "tsconfig.json", "tsconfig.json");
  });

  test("a build in another folder gets its own tsconfig, which extends tsconfig.json and adds that folder's route types", () => {
    const config = loadConfig(folder);
    assert.equal(config.distDir, folder);
    assert.equal(config.typescript.tsconfigPath, tsconfigName);
    const written = JSON.parse(readFileSync(join(siteDir, tsconfigName), "utf8"));
    // Next.js leaves a tsconfig that extends another alone, so tsconfig.json never gains this folder's types.
    assert.equal(written.extends, "./tsconfig.json");
    assert.ok(written.include.includes(`${folder}/types/**/*.ts`), JSON.stringify(written.include));
    for (const pattern of ["next-env.d.ts", "**/*.ts", "**/*.tsx", "**/*.mts"]) assert.ok(written.include.includes(pattern), pattern);
    // No other build folder's types: "**/*.ts" skips folders whose names start with a dot.
    assert.ok(!written.include.some((pattern) => pattern.startsWith(".next/") || pattern.startsWith(".next-*")), JSON.stringify(written.include));
  });

  test("tsc, given that tsconfig, checks the folder's validator.ts (the file the side build used to skip)", () => {
    loadConfig(folder);
    mkdirSync(join(siteDir, folder, "types"), { recursive: true });
    writeFileSync(join(siteDir, folder, "types", "validator.ts"), "export const checked = true;\n");
    const run = spawnSync(process.execPath, [join(siteDir, "node_modules", "typescript", "bin", "tsc"), "--listFilesOnly", "-p", tsconfigName], {
      cwd: siteDir,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr || run.stdout.slice(-2000));
    const files = run.stdout.split("\n");
    assert.ok(files.some((file) => file.endsWith(`/${folder}/types/validator.ts`)), `validator.ts is not in the program (${files.length} files)`);
  });

  test("the generated tsconfigs are neither committed nor sent to the Docker build", () => {
    assert.match(readFileSync(join(siteDir, ".gitignore"), "utf8"), /^\/tsconfig\.next-\*\.json$/m);
    assert.match(readFileSync(join(siteDir, ".dockerignore"), "utf8"), /^tsconfig\.next-\*\.json$/m);
    assert.equal(existsSync(join(siteDir, "tsconfig.dist.json")), false, "tsconfig.dist.json is replaced by the per-folder tsconfig");
  });
});
