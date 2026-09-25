import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const read = (name: string) => readFileSync(join(REPO, name), "utf8");

/** The services part of a compose file (from the first top-level key), without `build:` blocks. */
function services(text: string): string {
  const body = text.slice(text.indexOf("x-sample: &sample"));
  return body.replace(/\n(\s+)build:\n(?:\1  .*\n)+/g, "\n");
}

describe("compose files", () => {
  it("run-hound.compose.yml (published images) matches docker-compose.yml (from source) apart from build:", () => {
    expect(services(read("run-hound.compose.yml"))).toBe(services(read("docker-compose.yml")));
  });

  it("run-hound.compose.yml pulls images only and uses this version's tags", () => {
    const release = read("run-hound.compose.yml");
    const version = (JSON.parse(read("app/package.json")) as { version: string }).version;
    expect(release).not.toMatch(/^\s+build:/m);
    const images = [...release.matchAll(/image: (\S+)/g)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(new RegExp(`^ghcr\\.io/rahul-bharati/run-hound(-kennel|-samples)?:${version.replace(/\./g, "\\.")}$`));
  });
});

/** Test accounts (docs/v2-spec.md "Test accounts"): every variable passes through, empty unless set in .env. */
const ACCOUNT_VARS = [
  ...["A", "B"].flatMap((slot) => ["LOGIN_URL", "USERNAME", "PASSWORD", "LABEL"].map((field) => `RUNHOUND_ACCOUNT_${slot}_${field}`)),
  "RUNHOUND_ACCOUNTS_ISOLATED",
];

describe("test accounts in the deployment files", () => {
  it.each(["docker-compose.yml", "run-hound.compose.yml"])("%s passes the RUNHOUND_ACCOUNT* variables through, empty by default", (name) => {
    const text = read(name);
    for (const v of ACCOUNT_VARS) expect(text, v).toMatch(new RegExp(`^\\s+${v}: \\$\\{${v}:-\\}\\s*$`, "m"));
  });

  it("docker-entrypoint.sh hands `accounts` to the CLI, like `ai`", () => {
    const line = read("app/docker-entrypoint.sh")
      .split("\n")
      .find((l) => /^\s*serve\s*\|/.test(l));
    expect(line).toBeDefined();
    const commands = line!.replace(/\)\s*$/, "").split("|").map((w) => w.trim());
    expect(commands).toContain("ai");
    expect(commands).toContain("accounts");
  });
});
