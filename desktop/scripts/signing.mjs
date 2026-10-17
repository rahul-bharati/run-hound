// Whether an installer build is signed, decided from the environment alone, so a build signs itself exactly when its
// secrets exist and says so when they don't (docs/desktop-architecture.md "Implementation status", installer pipeline).
// The variables are electron-builder's own, read from the installed app-builder-lib 26.15.3:
//   macOS certificate    CSC_LINK (+ CSC_KEY_PASSWORD) or CSC_NAME for a keychain identity   macPackager.js, macCodeSign.js
//   macOS notarization   one complete set of APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID,
//                        APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE   MacTargetHelper.getNotarizeOptions
//   Windows certificate  WIN_CSC_LINK, else CSC_LINK (+ WIN_CSC_KEY_PASSWORD, else CSC_KEY_PASSWORD)   windowsSignToolManager.js
// Linux packages (deb, rpm) are not signed by this pipeline, and D1 Rule 7 asks for signing on macOS and Windows only.

/** @typedef {{ state: "signed" | "unsigned" | "not-required", reason: string }} Signing */

const filled = (value) => typeof value === "string" && value.trim() !== "";
const allOf = (env, names) => names.every((name) => filled(env[name]));

/** Every variable that makes electron-builder sign, notarize or look for a certificate. */
export const SIGNING_VARIABLES = [
  "CSC_LINK", "CSC_KEY_PASSWORD", "CSC_NAME", "CSC_KEYCHAIN", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER",
  "APPLE_KEYCHAIN", "APPLE_KEYCHAIN_PROFILE",
];

/** The notarization credential sets electron-builder accepts, in the order it tries them. */
const NOTARIZATION = [
  ["an Apple ID", ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]],
  ["an App Store Connect API key", ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]],
  ["a keychain profile", ["APPLE_KEYCHAIN_PROFILE"]],
];

/** The tags a release is cut from (the workflows' `v*.*.*`): v1.2.3, v1.2.3-rc.1. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Whether this run may sign at all. Off GitHub Actions (a maintainer's own machine) always. On GitHub Actions only a run
 * for a release tag, so a branch, a pull request or a manual run that somehow sees the signing secrets still builds
 * unsigned. This is a second lock behind the Environment the workflow's signing legs use (docs/development.md "Signing
 * secrets"), not a replacement for it: a workflow edited in a branch can ignore this file.
 * @param {Record<string, string | undefined>} env
 */
export function mayCodeSign(env) {
  if (env.GITHUB_ACTIONS !== "true") return true;
  return env.GITHUB_REF_TYPE === "tag" && RELEASE_TAG.test(env.GITHUB_REF_NAME ?? "");
}

/**
 * @param {string} platform process.platform of the machine building the installer
 * @param {Record<string, string | undefined>} env
 * @returns {Signing} "signed" only when everything the platform needs is present; otherwise "unsigned" with what is missing.
 */
export function resolveSigning(platform, env) {
  if (platform === "linux") return { state: "not-required", reason: "deb and rpm packages are not signed" };
  if (!mayCodeSign(env)) return { state: "unsigned", reason: "this GitHub Actions run is not for a release tag (v*.*.*), and only those sign" };
  if (platform === "win32") {
    return filled(env.WIN_CSC_LINK) || filled(env.CSC_LINK)
      ? { state: "signed", reason: "a code-signing certificate (WIN_CSC_LINK or CSC_LINK)" }
      : { state: "unsigned", reason: "no code-signing certificate (WIN_CSC_LINK or CSC_LINK)" };
  }
  if (platform === "darwin") {
    const certificate = filled(env.CSC_LINK) || filled(env.CSC_NAME);
    const notarization = NOTARIZATION.find(([, names]) => allOf(env, names));
    if (certificate && notarization) return { state: "signed", reason: `a Developer ID certificate, notarized with ${notarization[0]}` };
    const missing = [
      ...(certificate ? [] : ["a Developer ID certificate (CSC_LINK or CSC_NAME)"]),
      ...(notarization ? [] : ["notarization credentials (a complete APPLE_ID, APPLE_API_KEY or APPLE_KEYCHAIN_PROFILE set)"]),
    ];
    return { state: "unsigned", reason: `no ${missing.join(" and no ")}` };
  }
  return { state: "unsigned", reason: `${platform} is not a platform Run Hound ships an installer for` };
}

/**
 * The environment electron-builder runs in. Unsigned: every signing variable is removed (an unset GitHub secret arrives
 * as an empty string, which electron-builder reads as a certificate to import) and the macOS keychain search is off.
 * RUNHOUND_UNSIGNED_SUFFIX is what package.json's "artifactName" appends, "-unsigned" or nothing.
 * @param {Signing} signing
 * @param {Record<string, string | undefined>} env
 */
export function builderEnv(signing, env) {
  const out = { ...env };
  if (signing.state === "unsigned") {
    for (const name of SIGNING_VARIABLES) delete out[name];
    out.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  } else {
    for (const name of SIGNING_VARIABLES) if (!filled(out[name])) delete out[name];
  }
  out.RUNHOUND_UNSIGNED_SUFFIX = signing.state === "unsigned" ? "-unsigned" : "";
  return out;
}
