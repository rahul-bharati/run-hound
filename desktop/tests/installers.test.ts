import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checksumsFor, installersIn } from "../scripts/checksums.mjs";
import { changelogSection, releaseNotes } from "../scripts/release-notes.mjs";
import { SIGNING_VARIABLES, builderEnv, resolveSigning } from "../scripts/signing.mjs";

describe("D4 signing follows the environment", () => {
  const appleId = { APPLE_ID: "a@example.com", APPLE_APP_SPECIFIC_PASSWORD: "x", APPLE_TEAM_ID: "T" };
  const apiKey = { APPLE_API_KEY: "/k.p8", APPLE_API_KEY_ID: "K", APPLE_API_ISSUER: "I" };

  it("builds unsigned, and says why, when the secrets are absent or empty (an unset GitHub secret is an empty string)", () => {
    expect(resolveSigning("darwin", {}).state).toBe("unsigned");
    expect(resolveSigning("darwin", { CSC_LINK: "", ...appleId, APPLE_ID: "" }).state).toBe("unsigned");
    expect(resolveSigning("win32", { WIN_CSC_LINK: "", CSC_LINK: "  " })).toMatchObject({ state: "unsigned", reason: expect.stringContaining("WIN_CSC_LINK") });
  });

  it("signs on macOS only with a certificate and a complete notarization set", () => {
    expect(resolveSigning("darwin", { CSC_LINK: "base64", ...appleId }).state).toBe("signed");
    expect(resolveSigning("darwin", { CSC_LINK: "base64", ...apiKey }).state).toBe("signed");
    expect(resolveSigning("darwin", { CSC_NAME: "Run Hound", APPLE_KEYCHAIN_PROFILE: "notary" }).state).toBe("signed");
    expect(resolveSigning("darwin", { CSC_LINK: "base64" })).toMatchObject({ state: "unsigned", reason: expect.stringContaining("notarization") });
    expect(resolveSigning("darwin", { CSC_LINK: "base64", APPLE_ID: "a@example.com" }).state).toBe("unsigned");
    expect(resolveSigning("darwin", appleId)).toMatchObject({ state: "unsigned", reason: expect.stringContaining("certificate") });
  });

  it("signs on Windows with WIN_CSC_LINK, or CSC_LINK as electron-builder falls back to it", () => {
    expect(resolveSigning("win32", { WIN_CSC_LINK: "base64", WIN_CSC_KEY_PASSWORD: "p" }).state).toBe("signed");
    expect(resolveSigning("win32", { CSC_LINK: "base64" }).state).toBe("signed");
  });

  it("does not sign Linux packages, and does not call that unsigned", () => {
    expect(resolveSigning("linux", { CSC_LINK: "base64" }).state).toBe("not-required");
  });

  it("strips every signing variable and turns the keychain search off for an unsigned build, and names it", () => {
    const env = builderEnv(resolveSigning("darwin", {}), { PATH: "/bin", CSC_LINK: "", CSC_KEY_PASSWORD: "p", ...Object.fromEntries(SIGNING_VARIABLES.map((n) => [n, ""])) });
    expect(Object.keys(env).filter((name) => SIGNING_VARIABLES.includes(name))).toEqual([]);
    expect(env).toMatchObject({ PATH: "/bin", CSC_IDENTITY_AUTO_DISCOVERY: "false", RUNHOUND_UNSIGNED_SUFFIX: "-unsigned" });
  });

  it("keeps the secrets of a signed build, drops its empty ones, and adds no suffix", () => {
    const given = { CSC_LINK: "base64", CSC_KEY_PASSWORD: "p", WIN_CSC_LINK: "", APPLE_ID: "a", APPLE_APP_SPECIFIC_PASSWORD: "x", APPLE_TEAM_ID: "T" };
    const env = builderEnv(resolveSigning("darwin", given), given);
    expect(env).toMatchObject({ CSC_LINK: "base64", CSC_KEY_PASSWORD: "p", APPLE_ID: "a", RUNHOUND_UNSIGNED_SUFFIX: "" });
    expect("WIN_CSC_LINK" in env).toBe(false);
    expect(env.CSC_IDENTITY_AUTO_DISCOVERY).toBeUndefined();
    expect(builderEnv(resolveSigning("linux", {}), {}).RUNHOUND_UNSIGNED_SUFFIX).toBe("");
  });
});

describe("D4 package configuration", () => {
  const config = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).build;

  it("names every installer Run-Hound-<version>-<os>-<arch>[-unsigned].<ext> from one pattern", () => {
    expect(config.artifactName).toBe("Run-Hound-${version}-${os}-${arch}${env.RUNHOUND_UNSIGNED_SUFFIX}.${ext}");
    for (const platform of ["linux", "mac", "win"]) expect(config[platform].artifactName).toBeUndefined();
  });

  it("keeps the hardened runtime on, which notarization needs (it only takes effect when signing)", () => {
    expect(config.mac.hardenedRuntime).toBe(true);
  });

  it("declares electron-builder's default deb dependencies (setting depends replaces them) plus the Chromium libraries they don't pull in", () => {
    const scheme = JSON.parse(readFileSync(createRequire(createRequire(import.meta.url).resolve("electron-builder/package.json")).resolve("app-builder-lib/scheme.json"), "utf8"));
    const defaults: string[] = scheme.definitions.DebOptions.properties.depends.default;
    expect(defaults.length).toBeGreaterThan(5);
    expect(config.deb.depends).toEqual(expect.arrayContaining(defaults));
    expect(config.deb.depends).toEqual(expect.arrayContaining(["libasound2", "libgbm1", "libdrm2"]));
  });
});

describe("D4 checksums and release notes", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const folder = (files: Record<string, string>) => {
    dir = mkdtempSync(join(tmpdir(), "run-hound-installers-"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };

  it("lists installers only, sorted, in sha256sum's format", async () => {
    const where = folder({ "Run-Hound-1.0.0-win-x64.exe": "abc", "Run-Hound-1.0.0-linux-amd64.deb": "", "latest.yml": "x", "a.dmg.blockmap": "y", "SHA256SUMS": "old" });
    expect(installersIn(where)).toEqual(["Run-Hound-1.0.0-linux-amd64.deb", "Run-Hound-1.0.0-win-x64.exe"]);
    const { text } = await checksumsFor(where);
    expect(text).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Run-Hound-1.0.0-linux-amd64.deb\n" +
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  Run-Hound-1.0.0-win-x64.exe\n",
    );
  });

  it("refuses an empty folder rather than writing an empty checksum file", async () => {
    await expect(checksumsFor(folder({ "notes.txt": "x" }))).rejects.toThrow(/no installers/);
  });

  const changelog = "# Changelog\n\n## 1.2.0 (Title), 1 October 2026\n\nNew [guide](docs/usage.md).\n\n- one\n\n## 1.1.0\n\nOld.\n";

  it("takes the version's CHANGELOG section and nothing else", () => {
    expect(changelogSection(changelog, "1.2.0")).toBe("New [guide](docs/usage.md).\n\n- one");
    expect(changelogSection(changelog, "1.1.0")).toBe("Old.");
    expect(changelogSection(changelog, "9.9.9")).toBe("");
  });

  it("makes links absolute at the tag, lists the installers, and copes with a version that has no entry", async () => {
    const where = folder({ "Run-Hound-1.2.0-mac-arm64.dmg": "abc", "Run-Hound-1.2.0-linux-x86_64.rpm": "abc" });
    const notes = await releaseNotes({ version: "1.2.0", tag: "v1.2.0", changelog, assetsDir: where });
    expect(notes).toContain("](https://github.com/rahul-bharati/run-hound/blob/v1.2.0/docs/usage.md)");
    expect(notes).toMatch(/\| macOS arm64 \| `Run-Hound-1\.2\.0-mac-arm64\.dmg` \| `ba7816bf8f01cfea…` \|/);
    expect(notes).toMatch(/\| Linux x86_64 \| `Run-Hound-1\.2\.0-linux-x86_64\.rpm`/);
    expect(await releaseNotes({ version: "9.9.9", tag: "v9.9.9", changelog })).toContain('no "## 9.9.9" section');
  });
});
