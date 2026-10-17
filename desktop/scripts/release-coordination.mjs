// How release-images.yml and desktop-installers.yml share one GitHub Release for a tag
// (docs/decisions/10-2026.md#2026-10-17-desktop-release-pipeline-hardening).
//
// Two workflows run on the same tag: release-images.yml (the Docker images, the compose file and the CHANGELOG notes) and
// desktop-installers.yml (the signed installers, SHA256SUMS and the installer table). Each one calls
//   node scripts/release-coordination.mjs publish --tag v1.2.3 --part images|desktop --require images,desktop \
//        --notes-file notes.md asset...
// when its own part is ready, and neither ever publishes the release by itself:
//   - The release is created as a DRAFT and stays one until every required part is in it. `/releases/latest` (what the
//     desktop app's update check reads) never lists a draft, so a tag whose installers failed their gate is not announced.
//   - Each part owns one marked block of the release notes ("<!-- run-hound:images -->" ... "<!-- /run-hound:images -->").
//     A part replaces its own block and leaves the other's, and any text a person added outside the blocks, as it found them,
//     so neither workflow overwrites the other's notes (the installer checksum table in particular).
//   - A part is "in" when its block is in the notes, which it writes after its assets are uploaded. The part that finds
//     every required block present is the one that publishes (--latest, or --prerelease for a tag with a "-" in it).
// Both workflows run this inside the concurrency group `release-publish-<tag>`, so one part's upload, notes edit and check
// complete before the other's begin: of two parts, the second always sees the first. A release that is already published
// (a re-run) gets its assets and its block updated and is not touched otherwise.
// `gh` reads GH_TOKEN and GH_REPO from the environment.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The parts of a release, in the order their blocks appear in the notes. */
export const PARTS = ["images", "desktop"];

const open = (part) => `<!-- run-hound:${part} -->`;
const close = (part) => `<!-- /run-hound:${part} -->`;

/** The block of `part` in `body`: its start, end and inner text, or null when it has none. */
function findBlock(body, part) {
  const start = body.indexOf(open(part));
  if (start === -1) return null;
  const end = body.indexOf(close(part), start);
  if (end === -1) return null;
  return { start, end: end + close(part).length, text: body.slice(start + open(part).length, end).trim() };
}

/** The parts that have a complete block in `body`. */
export function partsIn(body) {
  return PARTS.filter((part) => findBlock(body ?? "", part) !== null);
}

/** `part` of `required` that `body` doesn't have yet. */
export function missingParts(body, required) {
  const have = partsIn(body);
  return required.filter((part) => !have.includes(part));
}

/**
 * `body` with the block of `part` set to `content`. The other part's block and any text outside the blocks are kept; the
 * result is the text outside the blocks, then the blocks in PARTS order, each separated by a blank line.
 */
export function upsertBlock(body, part, content) {
  if (!PARTS.includes(part)) throw new Error(`unknown release part "${part}" (${PARTS.join(", ")})`);
  const blocks = new Map();
  let rest = body ?? "";
  for (const name of PARTS) {
    const found = findBlock(rest, name);
    if (!found) continue;
    blocks.set(name, found.text);
    rest = `${rest.slice(0, found.start)}${rest.slice(found.end)}`;
  }
  blocks.set(part, content.trim());
  const text = [rest.trim(), ...PARTS.filter((name) => blocks.has(name)).map((name) => `${open(name)}\n${blocks.get(name)}\n${close(name)}`)];
  return `${text.filter(Boolean).join("\n\n")}\n`;
}

const notFound = (err) => /release not found/i.test(`${err?.stderr ?? ""}${err?.message ?? ""}`);

/**
 * Adds a part to the tag's release, and publishes the release when every required part is in. `gh(args)` runs the GitHub
 * CLI and returns its standard output (injected, so the tests can stand in a release).
 * @returns {Promise<{ created: boolean, published: boolean, wasPublished: boolean, missing: string[] }>}
 */
export async function publishPart({ gh, tag, part, require, notes, files, title, readNotes = (path) => readFileSync(path, "utf8"), writeNotes }) {
  if (!PARTS.includes(part)) throw new Error(`unknown release part "${part}" (${PARTS.join(", ")})`);
  if (!require.includes(part)) throw new Error(`--require ${require.join(",")} doesn't include this run's own part "${part}"`);
  const prerelease = /^v?\d+\.\d+\.\d+-/.test(tag);
  const view = () => {
    try {
      return JSON.parse(gh(["release", "view", tag, "--json", "isDraft,isPrerelease,body"]));
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  };

  const content = readNotes(notes);
  let release = view();
  let created = false;
  if (!release) {
    try {
      gh(["release", "create", tag, ...files, "--draft", "--verify-tag", "--title", title, "--notes-file", writeNotes(upsertBlock("", part, content)), ...(prerelease ? ["--prerelease"] : [])]);
      created = true;
    } catch (err) {
      // Created by the other part between the check and the create (the concurrency group makes this unlikely): carry on as an update.
      release = view();
      if (!release) throw err;
    }
  }
  if (!created) {
    gh(["release", "upload", tag, ...files, "--clobber"]);
    gh(["release", "edit", tag, "--notes-file", writeNotes(upsertBlock(release.body, part, content))]);
  }

  const after = view();
  if (!after) throw new Error(`release ${tag} is gone after it was written`);
  const missing = missingParts(after.body, require);
  if (!after.isDraft) return { created, published: false, wasPublished: true, missing };
  if (missing.length > 0) return { created, published: false, wasPublished: false, missing };
  gh(["release", "edit", tag, "--draft=false", prerelease ? "--prerelease" : "--latest"]);
  return { created, published: true, wasPublished: false, missing };
}

/**
 * The command line: `publish --tag vX.Y.Z --part images|desktop --require images,desktop --notes-file FILE [--title T] asset...`.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  if (argv[0] !== "publish") throw new Error("usage: publish --tag vX.Y.Z --part images|desktop --require images,desktop --notes-file FILE [--title T] asset...");
  const valued = ["--tag", "--part", "--require", "--notes-file", "--title"];
  const options = {};
  const files = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (valued.includes(arg)) {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      options[arg] = argv[++i];
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      files.push(arg);
    }
  }
  const require = (options["--require"] ?? "").split(",").filter(Boolean);
  if (!options["--tag"] || !options["--part"] || !options["--notes-file"] || require.length === 0) throw new Error("--tag, --part, --require and --notes-file are required");
  if (files.length === 0) throw new Error("no assets to attach");
  return { tag: options["--tag"], part: options["--part"], require, notes: options["--notes-file"], title: options["--title"], files };
}

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fail = (message) => {
    console.error(`release-coordination: ${message}`);
    process.exit(1);
  };
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const { tag, part, require, notes, files } = parsed;
  const scratch = mkdtempSync(join(tmpdir(), "run-hound-release-"));
  let counter = 0;
  try {
    const result = await publishPart({
      gh: runGh,
      tag,
      part,
      require,
      notes: resolve(notes),
      files: files.map((file) => resolve(file)),
      title: parsed.title ?? `Run Hound ${tag.replace(/^v/, "")}`,
      writeNotes: (body) => {
        const path = join(scratch, `notes-${++counter}.md`);
        writeFileSync(path, body);
        return path;
      },
    });
    const where = result.created ? "created the draft release" : result.wasPublished ? "updated the already published release" : "updated the draft release";
    const summary = result.published
      ? `${where} and published it: every part (${require.join(", ")}) is in.`
      : result.wasPublished
        ? `${where}.`
        : `${where}. It stays a DRAFT until the ${result.missing.join(" and ")} part${result.missing.length === 1 ? " is" : "s are"} in.`;
    console.log(`release-coordination: ${tag}: ${part} part: ${summary}`);
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Release ${tag}\n\nThe ${part} part ${summary}\n`, { flag: "a" });
    if (!result.published && !result.wasPublished) console.log(`::notice title=Release ${tag} is a draft::${summary} Re-run the workflow that failed or was skipped, or publish the draft by hand once you have checked it.`);
  } catch (err) {
    fail(err instanceof Error ? `${err.message}${err.stderr ? `\n${err.stderr}` : ""}` : String(err));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
