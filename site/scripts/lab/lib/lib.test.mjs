// Unit tests for the lab's helpers that need no browser or build (`pnpm test`): output folders, screenshot names,
// the request log's summaries, stopping a server by the pid listening on its port, and a stopped lab run leaving
// nothing running.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { median } from "./browser.mjs";
import { librariesOf, prefetches, scriptsIn } from "./requests.mjs";
import { shotName } from "./screenshots.mjs";
import { pidOnPort, stopPort } from "../serve.mjs";

const here = import.meta.dirname;

describe("lab helpers", () => {
  test("the output folder follows the build folder: .next-G1 writes to .lab-out/G1/, .next to .lab-out/lab/", () => {
    const labOutFor = (env) =>
      spawnSync(process.execPath, ["--input-type=module", "-e", `import { labOut } from ${JSON.stringify(join(here, "out.mjs"))}; console.log(labOut());`], {
        encoding: "utf8",
        env: { ...process.env, LAB_ID: "", LAB_OUT: "", ...env },
      }).stdout.trim();
    assert.match(labOutFor({ NEXT_DIST_DIR: ".next-G1" }), /\/site\/\.lab-out\/G1$/);
    assert.match(labOutFor({ NEXT_DIST_DIR: "" }), /\/site\/\.lab-out\/lab$/);
    assert.match(labOutFor({ NEXT_DIST_DIR: ".next-G1", LAB_ID: "baseline" }), /\/site\/\.lab-out\/baseline$/);
  });

  test("screenshot names", () => {
    assert.equal(shotName("/", "1440"), "home-1440.png");
    assert.equal(shotName("/docs/quick-start/", "390"), "docs-quick-start-390.png");
    assert.equal(shotName("/404/", "390"), "404-390.png");
  });

  test("the request log's summaries: GSAP's core, ScrollTrigger and DrawSVG told apart", () => {
    const script = (phase, path, gzip, libraries = {}) => ({
      phase,
      type: "script",
      path,
      gzip,
      gsap: false,
      scrollTrigger: false,
      drawSVG: false,
      rsc: false,
      prefetch: false,
      bytes: gzip * 2,
      failed: null,
      ...libraries,
    });
    const requests = [
      script("load", "/a.js", 100),
      script("after-load", "/m.js", 900, { gsap: true }),
      script("after-load", "/aborted.js", 0, { failed: "net::ERR_ABORTED" }),
      script("approach", "/st.js", 700, { scrollTrigger: true }),
      script("approach", "/draw.js", 200, { drawSVG: true }),
      { phase: "load", type: "fetch", path: "/docs/?_rsc=1", gzip: 0, gsap: false, rsc: true, prefetch: true, bytes: 4000 },
    ];
    assert.deepEqual(scriptsIn(requests, "after-load"), {
      count: 2,
      failed: 1,
      gzip: 900,
      gsap: true,
      scrollTrigger: false,
      drawSVG: false,
      paths: ["/m.js", "/aborted.js"],
    });
    assert.deepEqual(scriptsIn(requests, "approach"), { count: 2, failed: 0, gzip: 900, gsap: false, scrollTrigger: true, drawSVG: true, paths: ["/st.js", "/draw.js"] });
    assert.deepEqual(scriptsIn(requests, "load"), { count: 1, failed: 0, gzip: 100, gsap: false, scrollTrigger: false, drawSVG: false, paths: ["/a.js"] });
    assert.deepEqual(prefetches(requests), { count: 1, bytes: 4000, paths: ["/docs/?_rsc=1"] });
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });

  test("a downloaded script is flagged by what survives minification (scripts/lib/chunk-patterns.mjs)", () => {
    assert.deepEqual(librariesOf('var t=window.gsapVersions||(window.gsapVersions=[]);'), { gsap: true, scrollTrigger: false, drawSVG: false });
    assert.deepEqual(librariesOf("l.scrollerProxy=function(e,r){};"), { gsap: false, scrollTrigger: true, drawSVG: false });
    assert.deepEqual(librariesOf('var D={version:"3.15.0",name:"drawSVG"};'), { gsap: false, scrollTrigger: false, drawSVG: true });
    // GSAP's core calls ScrollTrigger.create: not a ScrollTrigger download.
    assert.deepEqual(librariesOf("e.ScrollTrigger.create(t,n);window.gsapVersions=[];"), { gsap: true, scrollTrigger: false, drawSVG: false });
  });
});

describe("serve: a server is stopped by the pid listening on its port", () => {
  test("pidOnPort finds this process's own listener", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    assert.equal(pidOnPort(port), process.pid);
    await new Promise((resolve) => server.close(resolve));
    assert.equal(pidOnPort(port), undefined);
  });

  test("stopPort stops another process's server and frees the port", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "const s = require('node:net').createServer(); s.listen(0, '127.0.0.1', () => console.log(s.address().port));",
    ]);
    const port = await new Promise((resolve) => child.stdout.once("data", (data) => resolve(Number(String(data).trim()))));
    const exited = new Promise((resolve) => child.once("exit", resolve));
    assert.equal(await stopPort(port), child.pid);
    await exited;
    assert.equal(pidOnPort(port), undefined);
  });
});

describe("run: a lab run that is stopped leaves nothing running", () => {
  /** A free port, from the system (as the stopPort test gets one). */
  const freePort = () =>
    new Promise((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    });
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitFor = async (condition, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (!condition()) {
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return true;
  };

  for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`${signal} to run.mjs stops the server on its port and the specs it started`, async () => {
      // A stand-in build: a standalone server.js that answers on PORT, and a spec that waits a minute.
      const dir = mkdtempSync(join(tmpdir(), "lab-run-"));
      const dist = join(dir, "dist");
      mkdirSync(join(dist, "static"), { recursive: true });
      mkdirSync(join(dist, "standalone"), { recursive: true });
      writeFileSync(
        join(dist, "standalone", "server.js"),
        'require("node:http").createServer((q, s) => s.end("ok")).listen(Number(process.env.PORT), process.env.HOSTNAME);\n',
      );
      const specPid = join(dir, "spec.pid");
      const spec = join(dir, "wait.spec.mjs");
      writeFileSync(
        spec,
        'import { writeFileSync } from "node:fs";\nimport { test } from "node:test";\n' +
          'test("waits", async () => { writeFileSync(process.env.SPEC_PID_FILE, String(process.pid)); await new Promise((r) => setTimeout(r, 60_000)); });\n',
      );
      const port = await freePort();
      // Without this test's own NODE_TEST_CONTEXT, which would make run.mjs's node --test report to this runner.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const run = spawn(process.execPath, [join(here, "..", "run.mjs"), spec, "--port", String(port)], {
        env: { ...env, NEXT_DIST_DIR: dist, LAB_OUT: join(dir, "out"), SPEC_PID_FILE: specPid },
        stdio: "ignore",
      });
      const exited = new Promise((resolve) => run.once("exit", (code, killed) => resolve({ code, killed })));
      let specProcess;
      try {
        assert.ok(await waitFor(() => existsSync(specPid)), "the spec started");
        specProcess = Number(readFileSync(specPid, "utf8"));
        assert.ok(pidOnPort(port), "the server listens");
        run.kill(signal);
        const { code } = await exited;
        assert.equal(code, signal === "SIGINT" ? 130 : 143, "the exit code of a stopped run");
        assert.equal(pidOnPort(port), undefined, "the server is stopped");
        assert.ok(await waitFor(() => !alive(specProcess), 5_000), "the spec is stopped");
      } finally {
        run.kill("SIGKILL");
        await stopPort(port);
        if (specProcess && alive(specProcess)) process.kill(specProcess, "SIGKILL");
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
