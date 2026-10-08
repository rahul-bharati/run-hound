// Write SHA256SUMS for the installers in a folder: `node scripts/checksums.mjs [folder] [--out file]` (folder defaults
// to release/, the file to <folder>/SHA256SUMS). One "<sha256>  <name>" line per installer (.dmg, .exe, .deb, .rpm),
// sorted by name, in the format `sha256sum -c SHA256SUMS` checks. Blockmaps and electron-builder's own files are left out.
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INSTALLER_EXTENSIONS = [".dmg", ".exe", ".deb", ".rpm"];

/** The installers directly inside `dir`, sorted by name. */
export function installersIn(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && INSTALLER_EXTENSIONS.includes(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolveHash(hash.digest("hex")));
  });
}

/** The SHA256SUMS text for `dir`, and the sizes (bytes) of the files in it. */
export async function checksumsFor(dir) {
  const names = installersIn(dir);
  if (names.length === 0) throw new Error(`no installers (${INSTALLER_EXTENSIONS.join(", ")}) in ${dir}`);
  const lines = [];
  const sizes = {};
  for (const name of names) {
    lines.push(`${await sha256(join(dir, name))}  ${name}`);
    sizes[name] = statSync(join(dir, name)).size;
  }
  return { text: `${lines.join("\n")}\n`, sizes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt === -1 ? null : args.splice(outAt, 2)[1];
  const dir = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "release"));
  try {
    const { text, sizes } = await checksumsFor(dir);
    writeFileSync(out ? resolve(out) : join(dir, "SHA256SUMS"), text);
    process.stdout.write(text);
    for (const [name, bytes] of Object.entries(sizes)) console.error(`${name}: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    console.error(`checksums: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
