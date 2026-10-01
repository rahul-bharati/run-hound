import type { AccountId } from "../core/types.js";

export type { AccountId } from "../core/types.js";

export const ACCOUNT_IDS: readonly AccountId[] = ["a", "b"];

export type AccountSource = "file" | "env" | "default";
