/**
 * Where the lab writes: site/.lab-out/<lab id>/ (git-ignored), for screenshots, traces, logs and each spec's JSON.
 * The lab id is LAB_ID, or the build folder's name without ".next-" (NEXT_DIST_DIR=.next-G1 writes to .lab-out/G1/),
 * or "lab" for a build in .next.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { distName, siteDir } from "../../lib/build-output.mjs";

export const labId = process.env.LAB_ID || (distName === ".next" ? "lab" : distName.replace(/^\.next-?/, "") || "lab");

/** A path under the lab's output folder (the folder itself with no parts). */
export const labOut = (...parts) => join(process.env.LAB_OUT || join(siteDir, ".lab-out", labId), ...parts);

/** Writes JSON under the lab's output folder, creating folders; returns the path. */
export function writeJson(relativePath, data) {
  const path = labOut(relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`);
  return path;
}
