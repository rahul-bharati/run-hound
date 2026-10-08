// The notes for a desktop release: `node scripts/release-notes.mjs --version 0.6.1 --tag v0.6.1 [--assets folder] [--out file]`.
// The body is the "## <version> ..." section of CHANGELOG.md (up to the next "## "), with relative links made absolute at
// the tag, as release-images.yml's GitHub Release does; when CHANGELOG.md has no such section the notes say so and carry
// only the installer list. The installer list is read from --assets (the files that will be attached, with their checksums).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checksumsFor } from "./checksums.mjs";

const repo = process.env.GITHUB_REPOSITORY ?? "rahul-bharati/run-hound";
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";

/** The body of the "## <version>" section of `changelog`, trimmed, or "" when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = (line) => {
    const [marker, name] = line.split(/\s+/);
    return marker === "##" ? name?.replace(/,$/, "") : undefined;
  };
  const start = lines.findIndex((line) => heading(line) === version);
  if (start === -1) return "";
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

/** Platform and architecture of an installer by its name: Run-Hound-<version>-<os>-<arch>[-unsigned].<ext>. */
function describe(name) {
  const [, os, arch] = /-(mac|win|linux)-(x64|arm64|amd64|x86_64|aarch64)(?:-unsigned)?\.\w+$/.exec(name) ?? [];
  const platform = { mac: "macOS", win: "Windows", linux: "Linux" }[os];
  return platform ? `${platform} ${arch}` : name;
}

export async function releaseNotes({ version, tag, changelog, assetsDir }) {
  const absolute = (text) => text.replace(/\]\((?:\.\/)?([^):/#][^):]*)\)/g, `](${server}/${repo}/blob/${tag}/$1)`);
  const body = absolute(changelogSection(changelog, version));
  const parts = [body || `Run Hound ${version}. (CHANGELOG.md has no "## ${version}" section.)`];
  if (assetsDir) {
    const { text } = await checksumsFor(assetsDir);
    const rows = text.trim().split("\n").map((line) => {
      const [sum, name] = line.split("  ");
      return `| ${describe(name)} | \`${name}\` | \`${sum.slice(0, 16)}…\` |`;
    });
    parts.push(
      [
        "## Desktop installers",
        "",
        "| Platform | File | SHA-256 |",
        "| --- | --- | --- |",
        ...rows,
        "",
        "`SHA256SUMS` lists the full checksums: download it next to the installers and run `sha256sum -c SHA256SUMS --ignore-missing` (macOS: `shasum -a 256 -c SHA256SUMS --ignore-missing`).",
      ].join("\n"),
    );
  }
  return `${parts.join("\n\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const version = option("--version");
  if (!version) {
    console.error("release-notes: --version is required.");
    process.exit(1);
  }
  const changelog = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../CHANGELOG.md"), "utf8");
  const assets = option("--assets");
  const text = await releaseNotes({ version, tag: option("--tag") ?? `v${version}`, changelog, assetsDir: assets && resolve(assets) });
  const out = option("--out");
  if (out) writeFileSync(resolve(out), text);
  else process.stdout.write(text);
}
