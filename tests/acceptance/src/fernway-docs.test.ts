/**
 * Keeps the docs that describe Fernway's planted bugs in step with the fixture (no browser, no Fernway): the bug ids and
 * the check that catches each one come from fixtures/fernway/bugs.json, so a bug added there, or a check that ships for
 * one, fails here until docs/development.md, the docs/fixtures.md status block and both compose file headers say so.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./kennel.js";

interface Bug {
  id: string;
  detectedBy: string;
}

async function text(path: string): Promise<string> {
  return readFile(join(REPO_ROOT, path), "utf8");
}

async function bugs(): Promise<Bug[]> {
  const json = JSON.parse(await text("fixtures/fernway/bugs.json")) as { bugs: Bug[] };
  return json.bugs;
}

/** "W01-W10" for the ids starting with prefix, in bugs.json order. */
function range(all: Bug[], prefix: string): string {
  const ids = all.map((b) => b.id).filter((id) => id.startsWith(prefix));
  expect(ids.length, `bugs.json has ${prefix} bugs`).toBeGreaterThan(0);
  return `${ids[0]}-${ids[ids.length - 1]}`;
}

/** The checks that catch Fernway's V bugs, each once. */
function vChecks(all: Bug[]): string[] {
  return [...new Set(all.filter((b) => b.id.startsWith("V")).map((b) => b.detectedBy))];
}

describe("docs describe every Fernway bug the fixture plants", () => {
  it("both compose file headers give FERNWAY_BUGS=all as every W and V bug", async () => {
    const all = await bugs();
    const expected = `${range(all, "W")} and ${range(all, "V")}`;
    for (const file of ["docker-compose.yml", "run-hound.compose.yml"]) {
      const line = (await text(file)).split("\n").find((l) => l.includes("fernway-bugs") && l.includes("FERNWAY_BUGS"));
      expect(line, `${file} has a header line for fernway-bugs`).toBeDefined();
      expect(line, file).toContain(`default: all, ${expected})`);
    }
  });

  it("docs/fixtures.md's status block covers every V bug and names the check that catches each", async () => {
    const all = await bugs();
    const status = (await text("docs/fixtures.md"))
      .split("\n")
      .filter((l, i, lines) => lines.slice(0, i + 1).every((x) => x.startsWith(">") || x.startsWith("#") || x === ""))
      .join("\n");
    expect(status).toContain("**Status");
    expect(status).toContain(range(all, "W"));
    expect(status).toContain(range(all, "V"));
    for (const check of vChecks(all)) expect(status, check).toContain(`\`${check}\``);
    expect(status).not.toMatch(/0\.4\.0 ships/);
  });

  it("docs/development.md's Fernway entry names the check that catches each V bug and calls none of them planned", async () => {
    const all = await bugs();
    const entry = (await text("docs/development.md")).split("\n").find((l) => l.startsWith("- **Fernway**"));
    expect(entry, "docs/development.md has a Fernway entry").toBeDefined();
    const lastV = range(all, "V").split("-")[1] ?? "";
    expect(entry).toContain(lastV);
    for (const check of vChecks(all)) expect(entry, check).toContain(`\`${check}\``);
    expect(entry).not.toMatch(/still planned/);
  });
});
