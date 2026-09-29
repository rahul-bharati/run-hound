import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const read = (name: string) => readFileSync(join(REPO, name), "utf8");

/** The services part of a compose file (from the first top-level key), without `build:` blocks, and with each
 * image: and pull_policy: value blanked out (the two files intentionally differ there: run-hound.compose.yml pulls a
 * release with pull_policy: always, docker-compose.yml builds, tags :local and sets pull_policy: never, so a local
 * build can never pretend to be a published release). */
function services(text: string): string {
  const body = text.slice(text.indexOf("x-sample: &sample"));
  return body
    .replace(/\n(\s+)build:\n(?:\1  .*\n)+/g, "\n")
    .replace(/^(\s*image: ghcr\.io\/rahul-bharati\/[a-z-]+):\S+$/gm, "$1")
    .replace(/^(\s*pull_policy:)\s*\S+$/gm, "$1");
}

describe("compose files", () => {
  it("run-hound.compose.yml (published images) matches docker-compose.yml (from source) apart from build: and image tags", () => {
    expect(services(read("run-hound.compose.yml"))).toBe(services(read("docker-compose.yml")));
  });

  it("run-hound.compose.yml pulls images only, and every image is ghcr.io/rahul-bharati/<name>:${RUNHOUND_TAG:-latest} with pull_policy: always", () => {
    const release = read("run-hound.compose.yml");
    expect(release).not.toMatch(/^\s+build:/m);
    const images = [...release.matchAll(/^\s*image: (\S+)/gm)].map((m) => m[1]);
    const names = ["run-hound", "run-hound-kennel", "run-hound-samples", "run-hound-fernway"];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(/^ghcr\.io\/rahul-bharati\/run-hound(-kennel|-samples|-fernway)?:\$\{RUNHOUND_TAG:-latest\}$/);
    for (const name of names) expect(release, name).toContain(`image: ghcr.io/rahul-bharati/${name}:\${RUNHOUND_TAG:-latest}`);
    // Every image-bearing anchor sets pull_policy: always right after its image:, so `up` never reuses a cached tag
    // instead of checking the registry (services that merge an anchor, such as kennel-clean, inherit both).
    const pullPolicies = [...release.matchAll(/^\s*pull_policy: (\S+)/gm)].map((m) => m[1]);
    expect(pullPolicies).toEqual(images.map(() => "always"));
  });

  it("docker-compose.yml (built from source) never pins an image to a release, so a local build can't pretend to be one", () => {
    const source = read("docker-compose.yml");
    const images = [...source.matchAll(/^\s*image: (\S+)/gm)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(/^ghcr\.io\/rahul-bharati\/run-hound(-kennel|-samples|-fernway)?:local$/);
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
