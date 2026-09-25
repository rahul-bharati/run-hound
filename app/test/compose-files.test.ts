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
