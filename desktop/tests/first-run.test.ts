import { describe, expect, it } from "vitest";
import {
  STOPPED_NOTE,
  StepRecorder,
  buildEvidence,
  confirmedFindings,
  describeFuses,
  diagnosticsMarkdown,
  exitCodeHex,
  cleanMachinePaths,
  expectedDataDirs,
  findPlainText,
  inheritedEnv,
  isolatedEnv,
  leftoverFiles,
  nameProblems,
  parseArgs,
  parseDiagnoseArgs,
  poll,
  redact,
  reportDigest,
  stoppedRunProblems,
  summaryMarkdown,
} from "../scripts/first-run-lib.mjs";

describe("D5 first-run check: arguments", () => {
  it("takes the installed app, the evidence folder and the installer's name", () => {
    expect(parseArgs(["--app", "/opt/Run Hound/run-hound", "--evidence", "ev", "--artifact", "Run-Hound-0.6.1-linux-x64.deb"])).toMatchObject({
      app: "/opt/Run Hound/run-hound",
      evidence: "ev",
      artifact: "Run-Hound-0.6.1-linux-x64.deb",
      afterUninstall: false,
    });
  });

  it("collects each --installed-path, and needs the first run's --home after an uninstall", () => {
    const after = parseArgs(["--app", "a", "--evidence", "e", "--home", "h", "--after-uninstall", "--installed-path", "p1", "--installed-path", "p2", "--wait-seconds", "90"]);
    expect(after).toMatchObject({ afterUninstall: true, installedPaths: ["p1", "p2"], waitSeconds: 90 });
    expect(() => parseArgs(["--app", "a", "--evidence", "e", "--after-uninstall"])).toThrow(/--home/);
    expect(parseArgs(["--app", "a", "--evidence", "e", "--package-files", "list.txt"]).packageFiles).toBe("list.txt");
  });

  it("takes the machine's own home with --real-home, instead of a --home, before and after an uninstall", () => {
    expect(parseArgs(["--app", "a", "--evidence", "e"]).realHome).toBe(false);
    expect(parseArgs(["--app", "a", "--evidence", "e", "--real-home"]).realHome).toBe(true);
    expect(parseArgs(["--app", "a", "--evidence", "e", "--real-home", "--after-uninstall"])).toMatchObject({ realHome: true, afterUninstall: true });
    expect(() => parseArgs(["--app", "a", "--evidence", "e", "--real-home", "--home", "h"])).toThrow(/alternatives/);
  });

  it("refuses what it does not know or can't use", () => {
    expect(() => parseArgs(["--evidence", "e"])).toThrow(/--app/);
    expect(() => parseArgs(["--app", "a"])).toThrow(/--evidence/);
    expect(() => parseArgs(["--app", "a", "--evidence", "e", "--nope"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--app", "a", "--evidence"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--app", "--evidence", "e"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--app", "a", "--evidence", "e", "--wait-seconds", "soon"])).toThrow(/seconds/);
  });
});

describe("D5 first-run check: the documented data folders", () => {
  // docs/desktop-install.md, "Where your data lives".
  it("macOS keeps both under Application Support", () => {
    expect(expectedDataDirs("darwin", "/Users/u")).toEqual({
      settings: "/Users/u/Library/Application Support/run-hound",
      runs: "/Users/u/Library/Application Support/run-hound/runs",
    });
  });

  it("Windows keeps settings in %APPDATA% and reports in %LOCALAPPDATA%", () => {
    expect(expectedDataDirs("win32", "C:\\Users\\u", { APPDATA: "C:\\Users\\u\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" })).toEqual({
      settings: "C:\\Users\\u\\AppData\\Roaming\\run-hound",
      runs: "C:\\Users\\u\\AppData\\Local\\run-hound\\runs",
    });
    expect(expectedDataDirs("win32", "C:\\Users\\u").settings).toBe("C:\\Users\\u\\AppData\\Roaming\\run-hound");
  });

  it("Linux uses ~/.config and ~/.local/share, or the XDG folders when set", () => {
    expect(expectedDataDirs("linux", "/home/u")).toEqual({ settings: "/home/u/.config/run-hound-desktop", runs: "/home/u/.local/share/run-hound/runs" });
    expect(expectedDataDirs("linux", "/home/u", { XDG_CONFIG_HOME: "/x/c", XDG_DATA_HOME: "/x/d" })).toEqual({ settings: "/x/c/run-hound-desktop", runs: "/x/d/run-hound/runs" });
  });
});

describe("D5 first-run check: the app's environment", () => {
  it("is a fresh home with the update check off, and nothing that moves the app's folders or supplies a key", () => {
    const env = isolatedEnv(
      {
        PATH: "/bin",
        HOME: "/home/real",
        RUNHOUND_CONFIG_DIR: "/elsewhere",
        RUNHOUND_RUNS_DIR: "/elsewhere/runs",
        RUNHOUND_AI_API_KEY: "sk-real",
        PLAYWRIGHT_BROWSERS_PATH: "/pw",
        XDG_CONFIG_HOME: "/real/config",
        XDG_DATA_HOME: "/real/data",
        ANTHROPIC_API_KEY: "sk-real",
        CI: "1",
      },
      "linux",
      "/tmp/home",
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/tmp/home", CI: "1", RUNHOUND_NO_UPDATE_CHECK: "1", XDG_CACHE_HOME: "/tmp/home/.cache" });
  });

  it("points Windows' profile variables into the fresh home", () => {
    const env = isolatedEnv({ APPDATA: "C:\\real", LOCALAPPDATA: "C:\\real" }, "win32", "C:\\h");
    expect(env).toMatchObject({ HOME: "C:\\h", USERPROFILE: "C:\\h", APPDATA: "C:\\h\\AppData\\Roaming", LOCALAPPDATA: "C:\\h\\AppData\\Local", RUNHOUND_NO_UPDATE_CHECK: "1" });
  });

  it("keeps the machine's own profile on --real-home (a fresh macOS HOME has no login keychain) and still drops what moves the folders or hands over a key", () => {
    const env = inheritedEnv({ PATH: "/bin", HOME: "/Users/runner", APPDATA: "C:\\real", RUNHOUND_RUNS_DIR: "/x", PLAYWRIGHT_BROWSERS_PATH: "/pw", OPENAI_API_KEY: "sk-real", RUNHOUND_NO_UPDATE_CHECK: "0" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/Users/runner", APPDATA: "C:\\real", RUNHOUND_NO_UPDATE_CHECK: "1" });
  });

  it("lists where Run Hound data would be on a machine that has used it, per platform", () => {
    expect(cleanMachinePaths("darwin", "/Users/u")).toEqual(["/Users/u/Library/Application Support/run-hound", "/Users/u/Library/Application Support/Run Hound"]);
    expect(cleanMachinePaths("win32", "C:\\Users\\u", { APPDATA: "C:\\Users\\u\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" })).toEqual([
      "C:\\Users\\u\\AppData\\Roaming\\run-hound",
      "C:\\Users\\u\\AppData\\Local\\run-hound\\runs",
      "C:\\Users\\u\\AppData\\Roaming\\Run Hound",
    ]);
    expect(cleanMachinePaths("linux", "/home/u")).toEqual(["/home/u/.config/run-hound-desktop", "/home/u/.local/share/run-hound/runs", "/home/u/.config/Run Hound"]);
  });

  it("matches the folders the check later expects", () => {
    const env = isolatedEnv({ XDG_CONFIG_HOME: "/real" }, "linux", "/tmp/h");
    expect(expectedDataDirs("linux", "/tmp/h", env).settings).toBe("/tmp/h/.config/run-hound-desktop");
  });
});

describe("D5 first-run check: the app is named Run Hound", () => {
  const ok = { appName: "Run Hound", userData: "/home/u/.config/Run Hound" };

  it("accepts each platform's installed names", () => {
    expect(nameProblems({ platform: "linux", executable: "/opt/Run Hound/run-hound", ...ok })).toEqual([]);
    expect(nameProblems({ platform: "darwin", executable: "/Applications/Run Hound.app/Contents/MacOS/Run Hound", appName: "Run Hound", userData: "/Users/u/Library/Application Support/Run Hound" })).toEqual([]);
    expect(
      nameProblems({ platform: "win32", executable: "C:\\Users\\u\\AppData\\Local\\Programs\\run-hound-desktop\\Run Hound.exe", appName: "Run Hound", userData: "C:\\Users\\u\\AppData\\Roaming\\Run Hound" }),
    ).toEqual([]);
  });

  it("names what is off: the executable, Electron's app name (the package's, not the product's) and the profile folder", () => {
    const problems = nameProblems({ platform: "darwin", executable: "/Applications/run-hound.app/Contents/MacOS/run-hound", appName: "@run-hound/desktop", userData: "/Users/u/Library/Application Support/@run-hound/desktop" });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("Run Hound.app/Contents/MacOS/Run Hound");
    expect(problems[1]).toContain('"@run-hound/desktop"');
    expect(problems[2]).toContain("should be named Run Hound");
    expect(nameProblems({ platform: "win32", executable: "C:\\x\\run-hound.exe", ...ok })).toHaveLength(1);
    expect(nameProblems({ platform: "linux", executable: "/opt/Run Hound/Run Hound", ...ok })).toHaveLength(1);
  });
});

describe("D5 first-run check: steps", () => {
  it("records each step's result and duration in order, and goes on after a failure", async () => {
    let t = 0;
    const rec = new StepRecorder({ now: () => (t += 250) });
    expect(await rec.run("one", () => "all good")).toBe(true);
    expect(await rec.run("two", () => { throw new Error("it broke"); })).toBe(false);
    expect(await rec.run("three", async () => undefined)).toBe(true);
    expect(rec.steps).toEqual([
      { name: "one", ok: true, ms: 250, detail: "all good" },
      { name: "two", ok: false, ms: 250, error: "it broke" },
      { name: "three", ok: true, ms: 250 },
    ]);
    expect(rec.ok).toBe(false);
  });

  it("is not ok before it has run anything, and ok when every step passed", async () => {
    const rec = new StepRecorder();
    expect(rec.ok).toBe(false);
    await rec.run("only", () => "x");
    expect(rec.ok).toBe(true);
  });

  it("never records a key, in a failure or in a detail", async () => {
    const key = "sk-ant-FAKE-0123456789";
    const rec = new StepRecorder({ secrets: [key] });
    await rec.run("leaky failure", () => { throw new Error(`PUT answered ${key} ${key}`); });
    await rec.run("leaky detail", () => `saved ${key}`);
    expect(JSON.stringify(rec.steps)).not.toContain(key);
    expect(rec.steps[0]?.error).toBe("PUT answered [key] [key]");
    expect(redact("nothing here", [key, ""])).toBe("nothing here");
  });

  it("polls until a value comes, and times out saying what it waited for", async () => {
    let calls = 0;
    let clock = 0;
    const sleeps: number[] = [];
    const got = await poll(() => (++calls === 3 ? "ready" : undefined), { timeoutMs: 10_000, intervalMs: 500, what: "x", now: () => clock, sleep: async (ms: number) => void sleeps.push(ms) });
    expect(got).toBe("ready");
    expect(sleeps).toEqual([500, 500]);
    await expect(
      poll(() => undefined, { timeoutMs: 2000, intervalMs: 1000, what: "the run to finish", now: () => clock, sleep: async (ms: number) => void (clock += ms) }),
    ).rejects.toThrow("Timed out after 2 s waiting for the run to finish.");
  });
});

describe("D5 first-run check: what the files and reports must show", () => {
  const key = "sk-ant-first-run-FAKE-0123456789";

  it("finds a key stored as plain text, or as UTF-16, and not an encrypted blob", () => {
    const files = [
      { path: "ai.json", bytes: Buffer.from(JSON.stringify({ provider: "anthropic" })) },
      { path: "secrets.json", bytes: Buffer.from(JSON.stringify({ version: 1, values: { anthropic: "enc:Zm9vYmFy" } })) },
      { path: "plain.json", bytes: Buffer.from(`{"apiKey":"${key}"}`) },
      { path: "wide.txt", bytes: Buffer.from(`k=${key}`, "utf16le") },
    ];
    expect(findPlainText(files, key)).toEqual(["plain.json", "wide.txt"]);
  });

  it("lists the package's files that an uninstall left behind, and ignores directories and blank lines", () => {
    const listing = "/.\n/opt\n/opt/Run Hound\n/opt/Run Hound/run-hound\n/usr/bin/run-hound\n\n/usr/share/applications/run-hound.desktop\n";
    const kinds: Record<string, "file" | "dir"> = { "/opt/Run Hound": "dir", "/opt/Run Hound/run-hound": "file", "/usr/bin/run-hound": "file" };
    expect(leftoverFiles(listing, (path) => kinds[path] ?? null)).toEqual(["/opt/Run Hound/run-hound", "/usr/bin/run-hound"]);
    expect(leftoverFiles(listing, () => null)).toEqual([]);
  });

  it("counts only confirmed findings: advisory ones are judgement", () => {
    const report = { findings: [{ confidence: "advisory" }, { confidence: "confirmed", title: "x" }, { confidence: "confirmed" }] };
    expect(confirmedFindings(report)).toHaveLength(2);
    expect(confirmedFindings({})).toEqual([]);
  });

  const stopped = {
    stopped: true,
    approved: ["a", "b", "c"],
    results: [
      { scenarioId: "a", status: "pass" },
      { scenarioId: "b", status: "skipped", notes: `${STOPPED_NOTE} before it finished.` },
      { scenarioId: "c", status: "skipped", notes: STOPPED_NOTE },
    ],
  };

  it("accepts a stopped run with its finished and skipped scenarios", () => {
    expect(stoppedRunProblems(stopped)).toEqual({ problems: [], stopped: ["b", "c"] });
  });

  it("names what is wrong with a run that was not stopped properly", () => {
    expect(stoppedRunProblems({ ...stopped, stopped: false }).problems).toEqual(["the report is not marked stopped"]);
    expect(stoppedRunProblems({ ...stopped, results: [stopped.results[0]] }).problems.join(";")).toMatch(/no scenario is recorded as skipped.*approved scenarios with no result: b, c/);
    const wrong = { ...stopped, results: [...stopped.results.slice(0, 2), { scenarioId: "c", status: "pass", notes: STOPPED_NOTE }] };
    expect(stoppedRunProblems(wrong).problems).toEqual(["scenarios with the stopped note that are not skipped: c"]);
  });

  it("digests a report into counts, never page content", () => {
    const digest = reportDigest({
      runId: "r1",
      runHoundVersion: "0.6.1",
      browser: "Chromium 1",
      summary: { passed: 2 },
      approved: ["a", "b"],
      findings: [{ confidence: "advisory", title: "secret page text" }],
      pagesVisited: [{ url: "http://127.0.0.1/", scenarioIds: ["a"] }],
      durationMs: 5,
    });
    expect(digest).toEqual({
      runId: "r1",
      runHoundVersion: "0.6.1",
      browser: "Chromium 1",
      stopped: false,
      summary: { passed: 2 },
      confirmedFindings: 0,
      advisoryFindings: 1,
      scenariosApproved: 2,
      pagesVisited: 1,
      durationMs: 5,
    });
  });
});

describe("D5 first-run check: the evidence", () => {
  const steps = [
    { name: "First launch", ok: true, ms: 640, detail: "Run Hound 0.6.1" },
    { name: "Cancellation", ok: false, ms: 12_345, error: "bad | pipe\nand a newline" },
  ];
  const facts = { artifact: "Run-Hound-0.6.1-linux-x64.deb", installer: { bytes: 123, sha256: "abc" }, executable: "/opt/Run Hound/run-hound", platform: "linux", arch: "x64", appVersion: "0.6.1", runs: { completed: "r1", stopped: "r2" } };

  it("is ok only when every step passed", () => {
    expect(buildEvidence(facts, steps).ok).toBe(false);
    expect(buildEvidence(facts, [steps[0]!]).ok).toBe(true);
    expect(buildEvidence(facts, []).ok).toBe(false);
    expect(buildEvidence(facts, steps)).toMatchObject({ schema: 1, appVersion: "0.6.1", artifact: "Run-Hound-0.6.1-linux-x64.deb", steps });
  });

  it("summarises each step's result for the job summary, escaping what would break the table", () => {
    const text = summaryMarkdown(buildEvidence(facts, steps));
    expect(text).toContain("### First run: Run-Hound-0.6.1-linux-x64.deb (linux x64)");
    expect(text).toContain("**FAILED**");
    expect(text).toContain("Installer `Run-Hound-0.6.1-linux-x64.deb`: 123 bytes, sha256 `abc`");
    expect(text).toContain("| First launch | pass | 640 ms | Run Hound 0.6.1 |");
    expect(text).toContain("| Cancellation | **FAIL** | 12.3 s | bad \\| pipe and a newline |");
    expect(text).toContain("Runs: completed `r1`, stopped `r2`");
  });
});

describe("D5 first-run diagnostics (the installed app without Playwright)", () => {
  it("takes fuses or direct, with the app and evidence folder, and defaults to a 25 s watch with a screenshot at 15 s", () => {
    expect(parseDiagnoseArgs(["fuses", "--app", "a", "--evidence", "e"])).toEqual({ command: "fuses", app: "a", evidence: "e", seconds: 25, screenshotAt: 15 });
    expect(parseDiagnoseArgs(["direct", "--app", "a", "--evidence", "e", "--seconds", "10", "--screenshot-at", "5"])).toMatchObject({ command: "direct", seconds: 10, screenshotAt: 5 });
    expect(() => parseDiagnoseArgs(["launch", "--app", "a", "--evidence", "e"])).toThrow(/fuses or direct/);
    expect(() => parseDiagnoseArgs(["direct", "--evidence", "e"])).toThrow(/--app/);
    expect(() => parseDiagnoseArgs(["direct", "--app", "a"])).toThrow(/--evidence/);
    expect(() => parseDiagnoseArgs(["direct", "--app", "a", "--evidence", "e", "--seconds", "0"])).toThrow(/positive/);
    expect(() => parseDiagnoseArgs(["direct", "--app", "a", "--evidence", "e", "--nope", "1"])).toThrow(/Unknown argument/);
  });

  it("reads a fuse wire as named rows, and shows a fuse a newer Electron added by its index", () => {
    const names: Record<number, string> = { 0: "RunAsNode", 3: "EnableNodeCliInspectArguments" };
    const states: Record<number, string> = { 48: "DISABLE", 49: "ENABLE", 114: "REMOVED" };
    expect(describeFuses({ version: "1", 0: 49, 3: 48, 8: 114 }, names, states)).toEqual({
      version: "1",
      fuses: [
        { index: 0, name: "RunAsNode", state: "ENABLE" },
        { index: 3, name: "EnableNodeCliInspectArguments", state: "DISABLE" },
        { index: 8, name: "fuse 8", state: "REMOVED" },
      ],
    });
    expect(describeFuses({ version: "1", 0: 7 }, names, states).fuses[0]?.state).toBe("byte 7");
  });

  it("writes an exit code the way Windows reports it", () => {
    expect(exitCodeHex(2147483651)).toBe("0x80000003");
    expect(exitCodeHex(-2147483645)).toBe("0x80000003");
    expect(exitCodeHex(0)).toBe("0x00000000");
    expect(exitCodeHex(null)).toBeNull();
  });

  it("summarises the fuses and each direct run for the job summary", () => {
    const text = diagnosticsMarkdown({
      fuses: { fuses: [{ name: "RunAsNode", state: "ENABLE" }] },
      runs: [
        { id: "plain", args: [], seconds: 25, running: true, screenshot: "screen-plain.png" },
        { id: "playwright-flags", args: ["--inspect=0"], seconds: 25, running: false, exitCode: 2147483651, exitCodeHex: "0x80000003", signal: null, screenshotNote: "it had exited" },
        { id: "stock-app", what: "stock Electron running desktop/ unpackaged", skipped: "stock Electron is not installed" },
      ],
    });
    expect(text).toContain("| RunAsNode | ENABLE |");
    expect(text).toContain("| plain | installed app | none | still running after 25 s | - | screen-plain.png |");
    expect(text).toContain("| playwright-flags | installed app | --inspect=0 | had exited | 2147483651 (0x80000003) | it had exited |");
    expect(text).toContain("| stock-app | stock Electron running desktop/ unpackaged | - | skipped: stock Electron is not installed | - | - |");
    expect(diagnosticsMarkdown({ fuses: { error: "no sentinel", fuses: [] } })).toContain("Not read: no sentinel");
  });
});
