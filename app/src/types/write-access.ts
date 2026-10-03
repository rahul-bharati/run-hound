/**
 * Type aliases for the write-access check. The behavior-bearing interfaces live in `interfaces/write-access.ts`;
 * the configurable limits live in `config/write-access.ts`; the reusable fixed values (regexes, status sets,
 * identity names, salt) live in `constants/write-access-constants.ts`; the focused modules live under
 * `checks/write-access/`.
 */

import type { Identity } from "../core/types.js";

/** The scenario identity, read from a scenario id (see `identityOf` in `checks/write-access/identity.ts`). */
export type Who = Exclude<Identity, "self">;
