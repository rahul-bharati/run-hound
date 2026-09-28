/**
 * The Security group's check pages (C2c: bundle-secrets, pii-leak, verbose-errors, security-headers, cookie-flags,
 * cors, source-maps, access-control, mass-assignment, csrf, write-access, paywall-trust), in the hub's order. One file
 * per group, so C2a, C2b and C2c never edit the same file; ./index.ts joins the three. To add a page: write ./<id>.ts,
 * add its id to `expectedIds` (pages.test.ts then fails until the page exists), then import it and list it in `pages`
 * in the hub's order.
 */
import { page as bundleSecrets } from "./bundle-secrets";
import { page as piiLeak } from "./pii-leak";
import { page as verboseErrors } from "./verbose-errors";
import { page as securityHeaders } from "./security-headers";
import { page as cookieFlags } from "./cookie-flags";
import { page as cors } from "./cors";
import { page as sourceMaps } from "./source-maps";
import { page as accessControl } from "./access-control";
import { page as massAssignment } from "./mass-assignment";
import { page as csrf } from "./csrf";
import { page as writeAccess } from "./write-access";
import { page as paywallTrust } from "./paywall-trust";
import type { CheckPage } from "./types";

/** The group these pages belong to (content/checks/data.ts): pages.test.ts holds every page here to it. */
export const group = "Security";

/** The checks whose page must exist (pages.test.ts). */
export const expectedIds: readonly string[] = [
  "bundle-secrets",
  "pii-leak",
  "verbose-errors",
  "security-headers",
  "cookie-flags",
  "cors",
  "source-maps",
  "access-control",
  "mass-assignment",
  "csrf",
  "write-access",
  "paywall-trust",
];

/** The group's pages, in the hub's order. `as const` keeps each id a literal type (./index.ts). */
export const pages = [
  bundleSecrets,
  piiLeak,
  verboseErrors,
  securityHeaders,
  cookieFlags,
  cors,
  sourceMaps,
  accessControl,
  massAssignment,
  csrf,
  writeAccess,
  paywallTrust,
] as const satisfies readonly CheckPage[];
