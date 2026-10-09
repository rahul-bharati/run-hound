import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournal } from "../../../src/agent/journal.js";
import { redactSecrets } from "../../../src/engine/redact.js";
import type { AgentStep } from "../../../src/interfaces/agent.js";

/**
 * The agent's journal (docs/agent-spec.md "Journal", and the JSDoc of src/agent/journal.ts).
 *
 * Contract these tests pin down (interpretations marked *):
 * - createJournal(runDir, hide) appends one AgentStep per line to <runDir>/agent/journal.jsonl and exposes that path as
 *   `file`. The `agent/` folder is created when the first step is written, so a run folder without it works.
 * - Each append writes exactly one line of valid JSON (the step), in the order of the calls, ending in "\n".
 * - Every line goes through `hide` before it is written, whole: a secret in the thought, the call, the path or the
 *   evidence names is hidden, with the line still being one line.
 * - Append-only: earlier lines are never changed. Nothing is written (the file does not exist) until the first append.
 *   * A second journal on the same run folder (a continued run) appends after the lines already there.
 *   * hide is called once per append with the line as text; the text parses to the step (a trailing newline may or may
 *     not be part of it). A line's newline characters inside strings stay escaped, so a thought with line breaks is
 *     still one line.
 *   * A run folder that does not exist yet is created too (the folder is made recursively).
 */

const MARKER = "ACME-SECRET";
const hideMarker = (text: string): string => text.replaceAll(MARKER, "[hidden]");

let runDir: string;

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), "rh-journal-"));
});

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

function step(index: number, overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    index,
    at: `2026-10-09T10:00:${String(index).padStart(2, "0")}.000Z`,
    decision: { thought: `Thought number ${index}`, call: { tool: "navigate", path: `/app/page-${index}` } },
    actionClass: "observation",
    counted: true,
    result: { ok: true },
    path: `/app/page-${index}`,
    durationMs: 120 + index,
    usage: { provider: "anthropic", model: "claude-test", calls: 1, inputTokens: 900, outputTokens: 40 },
    evidence: [`agent/${String(index).padStart(3, "0")}-page.png`],
    ...overrides,
  };
}

async function lines(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1).split("\n");
}

describe("createJournal", () => {
  it("exposes the journal's path as <runDir>/agent/journal.jsonl", () => {
    const journal = createJournal(runDir, (text) => text);
    expect(journal.file).toBe(join(runDir, "agent", "journal.jsonl"));
  });

  it("creates the agent folder and the file when the first step is written", async () => {
    const journal = createJournal(runDir, (text) => text);
    await journal.append(step(1));
    expect((await stat(join(runDir, "agent"))).isDirectory()).toBe(true);
    expect((await stat(journal.file)).isFile()).toBe(true);
  });

  it("creates a run folder that does not exist yet *", async () => {
    const nested = join(runDir, "runs", "r-2026-10-09");
    const journal = createJournal(nested, (text) => text);
    await journal.append(step(1));
    expect(await lines(join(nested, "agent", "journal.jsonl"))).toHaveLength(1);
  });

  it("writes one valid JSON line per append, in the order of the calls", async () => {
    const journal = createJournal(runDir, (text) => text);
    const written = [
      step(1),
      step(2, { decision: { thought: "Looking at the form", call: { tool: "observe" } }, counted: false, evidence: [] }),
      step(3, { result: { ok: false, code: "off-target" }, path: "/" }),
    ];
    for (const entry of written) await journal.append(entry);

    const file = await lines(journal.file);
    expect(file).toHaveLength(3);
    expect(file.map((line) => JSON.parse(line))).toEqual(written);
  });

  it("keeps a thought with line breaks on one line", async () => {
    const journal = createJournal(runDir, (text) => text);
    const entry = step(1, { decision: { thought: "first\nsecond\r\nthird fourth", call: { tool: "back" } } });
    await journal.append(entry);
    const file = await lines(journal.file);
    expect(file).toHaveLength(1);
    expect(JSON.parse(file[0] ?? "")).toEqual(entry);
  });

  it("is append-only: a second journal on the same run folder adds after what is there *", async () => {
    const first = createJournal(runDir, (text) => text);
    await first.append(step(1));
    await first.append(step(2));
    const before = await readFile(first.file, "utf8");

    const continued = createJournal(runDir, (text) => text);
    await continued.append(step(3));

    const after = await readFile(continued.file, "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect((await lines(continued.file)).map((line) => (JSON.parse(line) as AgentStep).index)).toEqual([1, 2, 3]);
  });

  it("does not create the file for a journal that never writes", async () => {
    const journal = createJournal(runDir, (text) => text);
    await expect(stat(journal.file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("hide", () => {
  it("is applied to the whole line: a secret in the thought is hidden", async () => {
    const journal = createJournal(runDir, hideMarker);
    await journal.append(step(1, { decision: { thought: `Signed in as ${MARKER}, checking the page`, call: { tool: "observe" } } }));

    const text = await readFile(journal.file, "utf8");
    expect(text).not.toContain(MARKER);
    const written = JSON.parse(text.trim()) as AgentStep;
    expect(written.decision.thought).toBe("Signed in as [hidden], checking the page");
  });

  it("is applied to every part of the step, not only the thought", async () => {
    const journal = createJournal(runDir, hideMarker);
    await journal.append(
      step(1, {
        decision: { thought: "Opening the profile", call: { tool: "navigate", path: `/users/${MARKER}/profile` } },
        path: `/users/${MARKER}/profile`,
        evidence: [`agent/001-${MARKER}.png`],
        usage: { provider: "anthropic", model: `model-${MARKER}`, calls: 1, inputTokens: null, outputTokens: null },
      }),
    );

    const text = await readFile(journal.file, "utf8");
    expect(text).not.toContain(MARKER);
    const written = JSON.parse(text.trim()) as AgentStep;
    expect(written.path).toBe("/users/[hidden]/profile");
    expect(written.decision.call).toEqual({ tool: "navigate", path: "/users/[hidden]/profile" });
    expect(written.evidence).toEqual(["agent/001-[hidden].png"]);
  });

  it("hides a secret in every line, and leaves a line without one as it was", async () => {
    const journal = createJournal(runDir, hideMarker);
    await journal.append(step(1));
    await journal.append(step(2, { decision: { thought: `Found ${MARKER}`, call: { tool: "observe" } } }));
    await journal.append(step(3));

    const file = await lines(journal.file);
    expect(file.join("\n")).not.toContain(MARKER);
    expect(JSON.parse(file[0] ?? "")).toEqual(step(1));
    expect((JSON.parse(file[1] ?? "") as AgentStep).decision.thought).toBe("Found [hidden]");
    expect(JSON.parse(file[2] ?? "")).toEqual(step(3));
  });

  it("is called once per append, with the line as text * ", async () => {
    const hide = vi.fn((text: string) => text);
    const journal = createJournal(runDir, hide);
    const entries = [step(1), step(2)];
    for (const entry of entries) await journal.append(entry);

    expect(hide).toHaveBeenCalledTimes(2);
    const seen = hide.mock.calls.map(([text]) => JSON.parse(text.trim()) as AgentStep);
    expect(seen).toEqual(entries);
    for (const [text] of hide.mock.calls) expect(text.trim()).not.toContain("\n");
  });

  it("works with the engine's own redaction of secrets", async () => {
    // Built by concatenation so secret scanners don't flag this file.
    const secret = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    const journal = createJournal(runDir, redactSecrets);
    await journal.append(step(1, { decision: { thought: `The page printed ${secret} in a banner`, call: { tool: "observe" } } }));

    const text = await readFile(journal.file, "utf8");
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED:stripe-secret]");
    expect(text.trim().split("\n")).toHaveLength(1);
  });
});
