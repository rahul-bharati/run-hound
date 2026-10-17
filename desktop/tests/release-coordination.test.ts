import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PARTS, missingParts, parseArgs, partsIn, publishPart, upsertBlock } from "../scripts/release-coordination.mjs";
import { installerNotes, releaseNotes } from "../scripts/release-notes.mjs";

type Release = { isDraft: boolean; isPrerelease: boolean; body: string; assets: string[] };

const scratch = mkdtempSync(join(tmpdir(), "run-hound-coordination-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A GitHub Release behind a stand-in for `gh`: enough of view, create, upload and edit for publishPart, and a log of the calls. */
function fakeGitHub(initial: Release | null = null) {
  let release = initial;
  const calls: string[][] = [];
  const notesWritten: string[] = [];
  /** The asset names in `gh release create|upload <tag> <assets...> [options]`. */
  const assetNames = (args: string[]) =>
    args
      .slice(3)
      .filter((arg, i, rest) => !arg.startsWith("--") && !["--title", "--notes-file"].includes(rest[i - 1] ?? ""))
      .map((file) => file.split("/").pop()!);
  const gh = (args: string[]): string => {
    calls.push(args);
    const command = args[1];
    if (args[0] !== "release") throw new Error(`unexpected gh ${args.join(" ")}`);
    if (command === "view") {
      if (!release) throw Object.assign(new Error("Command failed"), { stderr: "release not found" });
      return JSON.stringify({ isDraft: release.isDraft, isPrerelease: release.isPrerelease, body: release.body });
    }
    if (command === "create") {
      if (release) throw Object.assign(new Error("Command failed"), { stderr: "Release.tag_name already exists" });
      const notes = args[args.indexOf("--notes-file") + 1]!;
      release = {
        isDraft: args.includes("--draft"),
        isPrerelease: args.includes("--prerelease"),
        body: readFileSync(notes, "utf8"),
        assets: assetNames(args),
      };
      return "";
    }
    if (!release) throw new Error(`gh release ${command} on a release that doesn't exist`);
    if (command === "upload") {
      release.assets = [...new Set([...release.assets, ...assetNames(args)])];
      return "";
    }
    if (command === "edit") {
      const at = args.indexOf("--notes-file");
      if (at !== -1) {
        release.body = readFileSync(args[at + 1]!, "utf8");
        notesWritten.push(release.body);
      }
      if (args.includes("--draft=false")) release.isDraft = false;
      if (args.includes("--prerelease")) release.isPrerelease = true;
      return "";
    }
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  let n = 0;
  return {
    gh,
    calls,
    notesWritten,
    get release() {
      return release;
    },
    writeNotes: (body: string) => {
      const path = join(scratch, `notes-${++n}.md`);
      writeFileSync(path, body);
      return path;
    },
  };
}

const CHANGELOG_NOTES = "Fixes.\n\n- one thing";
const INSTALLER_NOTES = "## Desktop installers\n\n| Platform | File | SHA-256 |";

function part(github: ReturnType<typeof fakeGitHub>, which: "images" | "desktop", over: Partial<Parameters<typeof publishPart>[0]> = {}) {
  return publishPart({
    gh: github.gh,
    tag: "v1.2.3",
    part: which,
    require: ["images", "desktop"],
    notes: which,
    files: which === "images" ? ["/a/run-hound.compose.yml", "/a/run-hound.env.example"] : ["/a/Run-Hound-1.2.3-mac-arm64.dmg", "/a/SHA256SUMS"],
    title: "Run Hound 1.2.3",
    readNotes: () => (which === "images" ? CHANGELOG_NOTES : INSTALLER_NOTES),
    writeNotes: github.writeNotes,
    ...over,
  });
}

describe("release notes blocks", () => {
  it("keeps the images block before the desktop block whichever is written first, and text a person added outside them", () => {
    const desktopFirst = upsertBlock(upsertBlock("", "desktop", INSTALLER_NOTES), "images", CHANGELOG_NOTES);
    const imagesFirst = upsertBlock(upsertBlock("", "images", CHANGELOG_NOTES), "desktop", INSTALLER_NOTES);
    expect(desktopFirst).toBe(imagesFirst);
    expect(desktopFirst.indexOf("run-hound:images")).toBeLessThan(desktopFirst.indexOf("run-hound:desktop"));
    expect(partsIn(desktopFirst)).toEqual(PARTS);
    const edited = `A note from the maintainer.\n\n${desktopFirst}`;
    const again = upsertBlock(edited, "images", "New notes.");
    expect(again).toContain("A note from the maintainer.");
    expect(again).toContain(INSTALLER_NOTES);
    expect(again).toContain("New notes.");
    expect(again).not.toContain(CHANGELOG_NOTES);
  });

  it("replaces a part's own block on a re-run instead of adding a second one", () => {
    const once = upsertBlock("", "desktop", "old table");
    const twice = upsertBlock(once, "desktop", "new table");
    expect(twice.match(/<!-- run-hound:desktop -->/g)).toHaveLength(1);
    expect(twice).toContain("new table");
    expect(twice).not.toContain("old table");
  });

  it("counts a part as in only when its block is closed, and names what is missing", () => {
    expect(partsIn("<!-- run-hound:images -->\nhalf")).toEqual([]);
    expect(partsIn(null)).toEqual([]);
    expect(missingParts(upsertBlock("", "images", "x"), ["images", "desktop"])).toEqual(["desktop"]);
  });

  it("rejects a part that does not exist", () => {
    expect(() => upsertBlock("", "docs", "x")).toThrow(/unknown release part/);
  });
});

describe("publishing a release shared by the images and the desktop workflows", () => {
  it.each([
    ["images", "desktop"],
    ["desktop", "images"],
  ] as const)("stays a draft after the %s part and is published by the %s part, in either order", async (first, second) => {
    const github = fakeGitHub();
    const one = await part(github, first);
    expect(one).toMatchObject({ created: true, published: false, missing: [second] });
    expect(github.release).toMatchObject({ isDraft: true, isPrerelease: false });
    expect(github.calls.some((call) => call.includes("--draft=false"))).toBe(false);
    expect(github.calls.find((call) => call[1] === "create")).toEqual(expect.arrayContaining(["--draft", "--verify-tag"]));

    const two = await part(github, second);
    expect(two).toMatchObject({ created: false, published: true, missing: [] });
    expect(github.release).toMatchObject({ isDraft: false });
    expect(github.calls.filter((call) => call.includes("--draft=false"))).toEqual([["release", "edit", "v1.2.3", "--draft=false", "--latest"]]);
    expect(github.release!.assets.sort()).toEqual(["Run-Hound-1.2.3-mac-arm64.dmg", "SHA256SUMS", "run-hound.compose.yml", "run-hound.env.example"]);
  });

  it("never overwrites the other part's notes: the installer table and the CHANGELOG both survive, whoever is second", async () => {
    for (const [first, second] of [["images", "desktop"], ["desktop", "images"]] as const) {
      const github = fakeGitHub();
      await part(github, first);
      await part(github, second);
      expect(github.release!.body).toContain(CHANGELOG_NOTES);
      expect(github.release!.body).toContain(INSTALLER_NOTES);
      // The notes edit that came second started from the first part's notes.
      expect(github.notesWritten.at(-1)).toContain(first === "images" ? CHANGELOG_NOTES : INSTALLER_NOTES);
    }
  });

  it("publishes a pre-release as a pre-release and never as the latest release", async () => {
    const github = fakeGitHub();
    await part(github, "images", { tag: "v1.3.0-rc.1" });
    expect(github.release).toMatchObject({ isDraft: true, isPrerelease: true });
    await part(github, "desktop", { tag: "v1.3.0-rc.1" });
    const publish = github.calls.find((call) => call.includes("--draft=false"))!;
    expect(publish).toContain("--prerelease");
    expect(publish).not.toContain("--latest");
  });

  it("publishes at once when this part is the only one the tag needs (a commit without the desktop workflow)", async () => {
    const github = fakeGitHub();
    const result = await part(github, "images", { require: ["images"] });
    expect(result).toMatchObject({ created: true, published: true });
    expect(github.release!.isDraft).toBe(false);
  });

  it("leaves a published release published on a re-run, updating its assets and its own block only", async () => {
    const github = fakeGitHub({ isDraft: false, isPrerelease: false, body: upsertBlock(upsertBlock("", "images", "old changelog"), "desktop", INSTALLER_NOTES), assets: ["run-hound.compose.yml"] });
    const result = await part(github, "images");
    expect(result).toMatchObject({ published: false, wasPublished: true });
    expect(github.calls.some((call) => call.includes("--draft=false"))).toBe(false);
    expect(github.release!.body).toContain(CHANGELOG_NOTES);
    expect(github.release!.body).toContain(INSTALLER_NOTES);
    expect(github.release!.body).not.toContain("old changelog");
  });

  it("carries on as an update when the other part created the release between the check and the create", async () => {
    const github = fakeGitHub();
    await part(github, "desktop");
    let views = 0;
    const result = await part(github, "images", {
      // Our first look finds nothing, so we create, which fails because the other part's release is already there.
      gh: (args) => {
        if (args[1] === "view" && views++ === 0) throw Object.assign(new Error("Command failed"), { stderr: "release not found" });
        return github.gh(args);
      },
    });
    expect(result).toMatchObject({ created: false, published: true });
    expect(github.release!.body).toContain(INSTALLER_NOTES);
    expect(github.release!.body).toContain(CHANGELOG_NOTES);
  });

  it("refuses a part the run isn't required to have, and an unknown part", async () => {
    await expect(part(fakeGitHub(), "desktop", { require: ["images"] })).rejects.toThrow(/doesn't include/);
    await expect(part(fakeGitHub(), "docs" as "images")).rejects.toThrow(/unknown release part/);
  });

  it("does not hide a gh failure that is not a missing release", async () => {
    const github = fakeGitHub();
    await expect(
      part(github, "images", {
        gh: () => {
          throw Object.assign(new Error("Command failed"), { stderr: "HTTP 401: Bad credentials" });
        },
      }),
    ).rejects.toThrow(/Command failed/);
  });
});

describe("the release-coordination command line", () => {
  it("reads the tag, part, requirement, notes file, title and assets", () => {
    expect(parseArgs(["publish", "--tag", "v1.2.3", "--part", "desktop", "--require", "images,desktop", "--notes-file", "n.md", "a.dmg", "SHA256SUMS"])).toEqual({
      tag: "v1.2.3",
      part: "desktop",
      require: ["images", "desktop"],
      notes: "n.md",
      title: undefined,
      files: ["a.dmg", "SHA256SUMS"],
    });
    expect(parseArgs(["publish", "--tag", "v1.2.3", "--part", "images", "--require", "images", "--title", "Run Hound 1.2.3", "--notes-file", "n.md", "c.yml"]).files).toEqual(["c.yml"]);
  });

  it("rejects what it can't use rather than guessing", () => {
    expect(() => parseArgs(["upload"])).toThrow(/usage/);
    expect(() => parseArgs(["publish", "--tag", "v1.2.3", "--part", "images", "--notes-file", "n.md", "a"])).toThrow(/required/);
    expect(() => parseArgs(["publish", "--tag", "v1.2.3", "--part", "images", "--require", "images", "--notes-file", "n.md"])).toThrow(/no assets/);
    expect(() => parseArgs(["publish", "--latest"])).toThrow(/unknown option/);
  });
});

describe("the desktop part of the notes", () => {
  it("is the installer table alone, which the CHANGELOG part (release-images.yml's) comes before", async () => {
    const dir = mkdtempSync(join(scratch, "notes-"));
    try {
      writeFileSync(join(dir, "Run-Hound-1.2.0-mac-arm64.dmg"), "abc");
      const only = await releaseNotes({ version: "1.2.0", tag: "v1.2.0", changelog: "## 1.2.0\n\nNew.\n", assetsDir: dir, installersOnly: true });
      expect(only.startsWith("## Desktop installers")).toBe(true);
      expect(only).not.toContain("New.");
      expect(only.trim()).toBe((await installerNotes({ assetsDir: dir })).trim());
      const both = await releaseNotes({ version: "1.2.0", tag: "v1.2.0", changelog: "## 1.2.0\n\nNew.\n", assetsDir: dir });
      expect(both).toContain("New.");
      expect(both).toContain(only.trim());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
