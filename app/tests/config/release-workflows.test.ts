import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The release pipeline's safety rules, checked in the workflows' text (nothing here can run a workflow):
// docs/decisions/10-2026.md#2026-10-17-desktop-release-pipeline-hardening.
const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
// A Windows checkout may convert line endings; the text is compared with LF.
const read = (name: string) => readFileSync(join(REPO, name), "utf8").replaceAll("\r\n", "\n");
const DESKTOP = read(".github/workflows/desktop-installers.yml");
const IMAGES = read(".github/workflows/release-images.yml");

/** A job's text: from its key (two spaces of indent) to the next job's. */
function job(workflow: string, name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  expect(start, `a job named ${name}`).toBeGreaterThanOrEqual(0);
  const next = workflow.slice(start + 1).search(/^  [a-z][\w-]*:\s*$/m);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

/** A step's text: from its `- name:` line to the next step's. */
function step(jobText: string, name: string): string {
  const start = jobText.indexOf(`- name: ${name}\n`);
  expect(start, `a step named "${name}"`).toBeGreaterThanOrEqual(0);
  const next = jobText.slice(start + 1).search(/^ {6}- /m);
  return next < 0 ? jobText.slice(start) : jobText.slice(start, start + 1 + next);
}

const code = (text: string) => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

const SIGNING_SECRETS = [
  "MACOS_CSC_LINK", "MACOS_CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID",
  "APPLE_API_KEY_P8", "APPLE_API_KEY_ID", "APPLE_API_ISSUER", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD",
];
const DESKTOP_JOBS = ["preflight", "build", "first-run", "first-run-rpm", "gate", "publish"];

describe("desktop-installers.yml: signing secrets", () => {
  it("never runs on a trigger that hands a fork's code the workflow's secrets", () => {
    expect(code(DESKTOP)).not.toMatch(/pull_request_target|workflow_run/);
  });

  it("references the signing secrets in the build job only, and no other secret there", () => {
    const named = [...new Set([...code(DESKTOP).matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(named).toEqual([...SIGNING_SECRETS].sort());
    for (const other of DESKTOP_JOBS.filter((name) => name !== "build")) expect(code(job(DESKTOP, other)), other).not.toMatch(/secrets\./);
  });

  it("gives the build step each signing secret for a release tag on its own platform only", () => {
    const build = step(job(DESKTOP, "build"), "Build the installers");
    const lines = build.split("\n").filter((line) => line.includes("secrets."));
    expect(lines).toHaveLength(9);
    for (const line of lines) expect(line, line).toMatch(/\$\{\{ github\.ref_type == 'tag' && matrix\.os == '(mac|win)' && secrets\.\w+ \|\| '' \}\}/);
    expect(lines.filter((line) => line.includes("'win'")).map((line) => line.trim().split(":")[0])).toEqual(["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]);
  });

  it("writes the App Store Connect key only on a release tag, and deletes it after the build", () => {
    const build = job(DESKTOP, "build");
    expect(step(build, "Write the App Store Connect API key")).toMatch(/if: \$\{\{ matrix\.os == 'mac' && github\.ref_type == 'tag' \}\}/);
    const deleted = step(build, "Delete the App Store Connect API key");
    expect(deleted).toMatch(/if: \$\{\{ always\(\) && matrix\.os == 'mac' \}\}/);
    expect(deleted).toContain('rm -f "$RUNNER_TEMP/AuthKey.p8"');
    expect(build.indexOf("- name: Build the installers")).toBeLessThan(build.indexOf("- name: Delete the App Store Connect API key"));
  });

  it("puts the macOS and Windows build legs of a release tag in the release-signing Environment, and nothing else in any Environment", () => {
    const build = job(DESKTOP, "build");
    expect(build).toContain("environment: ${{ github.ref_type == 'tag' && matrix.environment || '' }}");
    const legs = build.split("\n").filter((line) => /^\s+- \{ id: /.test(line));
    expect(legs).toHaveLength(5);
    for (const leg of legs) {
      if (/os: (mac|win),/.test(leg)) expect(leg, leg).toContain("environment: release-signing }");
      else expect(leg, leg).toContain('environment: "" }');
    }
    expect(code(DESKTOP).match(/^\s+environment:/gm)).toHaveLength(1);
    for (const other of DESKTOP_JOBS.filter((name) => name !== "build")) expect(code(job(DESKTOP, other)), other).not.toMatch(/^\s+environment:/m);
  });

  it("fails a run outside a release tag that can see any signing secret, so a repository-level secret is noticed", () => {
    const tripwire = step(job(DESKTOP, "build"), "No signing secret outside the release-signing Environment");
    expect(tripwire).toContain("if: ${{ github.ref_type != 'tag' }}");
    for (const name of SIGNING_SECRETS) expect(tripwire, name).toContain(`${name}: \${{ secrets.${name} != '' }}`);
    expect(tripwire).toMatch(/exit 1/);
    // It reads only whether a secret is set: no secret is ever exported to the step.
    expect(tripwire.match(/secrets\.\w+/g)).toHaveLength(SIGNING_SECRETS.length);
    expect(tripwire.match(/secrets\.\w+ != ''/g)).toHaveLength(SIGNING_SECRETS.length);
  });
});

describe("desktop-installers.yml: preflight for a release tag", () => {
  const preflight = job(DESKTOP, "preflight");

  it("runs on a tag only, can read Actions runs and can write nothing", () => {
    expect(preflight).toContain("if: ${{ github.ref_type == 'tag' }}");
    expect(preflight).toMatch(/permissions:\n\s+actions: read\n\s+contents: read/);
    expect(preflight).not.toContain("write");
  });

  it("requires the tag's commit to be on main and CI to have passed on main for exactly that commit", () => {
    expect(preflight).toContain('repos/$GH_REPO/compare/main...$SHA');
    expect(preflight).toMatch(/identical \| behind\)/);
    expect(preflight).toContain("gh run list --workflow ci.yml --event push --branch main --commit \"$SHA\"");
    expect(preflight).toContain("gh run watch");
    expect(preflight).toMatch(/\[ "\$conclusion" = success \]/);
    expect(preflight).toMatch(/if \[ "\$\{#fail\[@\]\}" != 0 \]; then[\s\S]*exit 1/);
  });

  it("is what builds wait for, so no signing leg starts for a tag that failed it", () => {
    const build = job(DESKTOP, "build");
    expect(build).toMatch(/needs: preflight\n/);
    expect(build).toContain("if: ${{ !cancelled() && (github.ref_type != 'tag' || needs.preflight.result == 'success') }}");
  });

  it("is part of the release gate, which refuses a tag that failed it", () => {
    const gate = job(DESKTOP, "gate");
    expect(gate).toContain("needs: [preflight, build, first-run, first-run-rpm]");
    expect(gate).toContain("PREFLIGHT_RESULT: ${{ needs.preflight.result }}");
    expect(gate).toMatch(/\[ "\$REF_TYPE" = tag \] && \[ "\$PREFLIGHT_RESULT" != success \]/);
    expect(gate).toContain('REF_TYPE" != tag ]; then reasons+=');
  });
});

describe("desktop-installers.yml: a signed build is verified before it counts", () => {
  const build = job(DESKTOP, "build");
  const mac = step(build, "Verify the signature, Gatekeeper and notarization (macOS)");
  const win = step(build, "Verify the Authenticode signature (Windows)");

  it("runs after the build and before anything is uploaded, only for a build that says it signed", () => {
    expect(mac).toContain("matrix.os == 'mac' && steps.dist.outputs.signing == 'signed'");
    expect(win).toContain("matrix.os == 'win' && steps.dist.outputs.signing == 'signed'");
    const at = (needle: string) => build.indexOf(needle);
    expect(at("- name: Build the installers")).toBeLessThan(at("- name: Verify the signature, Gatekeeper and notarization (macOS)"));
    expect(at("- name: Verify the Authenticode signature (Windows)")).toBeLessThan(at("uses: actions/upload-artifact@"));
    expect(at("- name: Verify the signature, Gatekeeper and notarization (macOS)")).toBeLessThan(at("uses: actions/upload-artifact@"));
  });

  it("checks the app inside the dmg with codesign, spctl and stapler, and rejects ad hoc signatures and a missing hardened runtime", () => {
    expect(mac).toContain("set -euo pipefail");
    expect(mac).toContain("hdiutil attach -nobrowse -readonly");
    expect(mac).toContain('codesign --verify --deep --strict --verbose=2 "$app"');
    expect(mac).toContain("Authority=Developer ID Application:");
    expect(mac).toContain("Signature=adhoc");
    expect(mac).toMatch(/runtime/);
    expect(mac).toContain('spctl -a -vv -t exec "$app"');
    expect(mac).toContain('xcrun stapler validate "$app"');
  });

  it("checks the installer and the app with Get-AuthenticodeSignature: Valid, signer and timestamp, and fails otherwise", () => {
    expect(win).toContain("Get-AuthenticodeSignature -FilePath $file");
    expect(win).toContain("$sig.Status -ne 'Valid'");
    expect(win).toContain("SignerCertificate");
    expect(win).toContain("TimeStamperCertificate");
    expect(win).toContain("win-unpacked");
    expect(win).toMatch(/exit 1/);
  });
});

describe("one GitHub Release, shared by release-images.yml and desktop-installers.yml", () => {
  const publish = job(DESKTOP, "publish");
  const release = job(IMAGES, "github-release");
  const GROUP = "group: release-publish-${{ github.ref_name }}";

  it("is only ever created, edited and published by scripts/release-coordination.mjs", () => {
    for (const [name, text] of [["desktop publish", publish], ["images github-release", release]] as const) {
      expect(code(text), name).not.toMatch(/gh release (create|edit|upload|delete)/);
      expect(code(text), name).not.toMatch(/--latest|--draft=false|--notes-file "\$notes" "\$\{flags/);
      expect(text, name).toContain("node desktop/scripts/release-coordination.mjs publish");
    }
    expect(code(IMAGES)).not.toMatch(/gh release (create|edit|upload|delete)/);
    expect(code(DESKTOP)).not.toMatch(/gh release (create|edit|upload|delete)/);
  });

  it("has each workflow add its own part, and the images part wait for the desktop part only when the commit has the desktop workflow", () => {
    expect(publish).toContain('--part desktop --require images,desktop --notes-file "$notes"');
    expect(publish).toContain("--installers-only");
    expect(release).toContain("--part images --require \"$require\"");
    expect(release).toContain("require=images");
    expect(release).toContain("if [ -f .github/workflows/desktop-installers.yml ]; then require=images,desktop; fi");
  });

  it("serializes the two parts in one concurrency group, never cancelling one for the other", () => {
    for (const [name, text] of [["desktop publish", publish], ["images github-release", release]] as const) {
      expect(text, name).toMatch(new RegExp(`concurrency:\\n\\s+${GROUP.replace(/[$.{}]/g, "\\$&")}\\n\\s+cancel-in-progress: false`));
    }
  });

  it("gives write access to the repository to these two jobs only", () => {
    expect(code(DESKTOP).match(/contents: write/g)).toHaveLength(1);
    expect(publish).toContain("contents: write");
    expect(code(IMAGES).match(/contents: write/g)).toHaveLength(1);
    expect(release).toContain("contents: write");
    expect(DESKTOP).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(IMAGES).toMatch(/^permissions:\n {2}contents: read\n/m);
  });
});

describe("the release workflows' actions", () => {
  const uses = (text: string) => [...text.matchAll(/^\s*(?:- )?uses: (\S+)(?: # (\S+))?$/gm)].map((m) => ({ action: m[1]!, version: m[2] }));

  it.each([
    ["desktop-installers.yml", DESKTOP],
    ["release-images.yml", IMAGES],
  ])("%s pins every action to a full commit SHA with its version in a comment", (_name, text) => {
    const actions = uses(code(text)).filter(({ action }) => !action.startsWith("./"));
    expect(actions.length).toBeGreaterThan(10);
    for (const { action, version } of actions) {
      expect(action, action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      expect(version, action).toMatch(/^v\d+\.\d+\.\d+$/);
    }
  });

  it.each([
    ["desktop-installers.yml", DESKTOP],
    ["release-images.yml", IMAGES],
  ])("%s uses artifact actions that run on Node 24 (upload-artifact 6 and later, download-artifact 7 and later)", (_name, text) => {
    const major = (action: string) => Number(uses(code(text)).find((u) => u.action.startsWith(action))?.version?.slice(1).split(".")[0]);
    expect(major("actions/upload-artifact@")).toBeGreaterThanOrEqual(6);
    expect(major("actions/download-artifact@")).toBeGreaterThanOrEqual(7);
  });

  it("uses one SHA per action across the two workflows", () => {
    const shas = new Map<string, Set<string>>();
    for (const text of [DESKTOP, IMAGES]) {
      for (const { action } of uses(code(text))) {
        const [name, sha] = action.split("@");
        if (!sha || name!.startsWith("./")) continue;
        shas.set(name!, (shas.get(name!) ?? new Set()).add(sha));
      }
    }
    for (const [name, set] of shas) expect([...set], name).toHaveLength(1);
  });
});

describe("docs/development.md: the maintainer's setup for the release-signing Environment", () => {
  const docs = read("docs/development.md");

  it("names the Environment, the tag rule, the reviewers and where each secret goes", () => {
    expect(docs).toContain("release-signing");
    expect(docs).toContain("v*.*.*");
    expect(docs).toMatch(/[Rr]equired reviewers/);
    for (const name of SIGNING_SECRETS) expect(docs, name).toContain(name);
    expect(docs).toMatch(/not (as )?(a )?repository (or organization )?secret/i);
  });
});
