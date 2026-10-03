import type { ParseArgsOptionDescriptor } from "node:util";

export const AI_OPTIONS = {
  ai: { type: "boolean" },
  "ai-provider": { type: "string" },
  "ai-model": { type: "string" },
  "ai-base-url": { type: "string" },
  "ai-allow-remote": { type: "boolean" },
} as const satisfies Record<string, ParseArgsOptionDescriptor>;

export const RUN_OPTIONS = {
  approve: { type: "string", default: "default" },
  "allow-destructive": { type: "boolean", default: false },
  headed: { type: "boolean", default: false },
  "runs-dir": { type: "string" },
  json: { type: "boolean", default: false },
  "plan-only": { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
  as: { type: "string" },
  ...AI_OPTIONS,
} as const satisfies Record<string, ParseArgsOptionDescriptor>;

export const AI_COMMAND_OPTIONS = {
  help: { type: "boolean", short: "h", default: false },
  ...AI_OPTIONS,
} as const satisfies Record<string, ParseArgsOptionDescriptor>;

export const ACCOUNTS_OPTIONS = {
  help: { type: "boolean", short: "h", default: false },
  "login-url": { type: "string" },
  username: { type: "string" },
  label: { type: "string" },
  "password-stdin": { type: "boolean", default: false },
  // Recognize this only to refuse it without echoing a password from shell history.
  password: { type: "string" },
} as const satisfies Record<string, ParseArgsOptionDescriptor>;

export const SERVE_OPTIONS = {
  help: { type: "boolean", short: "h", default: false },
  port: { type: "string", default: "4000" },
  host: { type: "string", default: "127.0.0.1" },
  "runs-dir": { type: "string" },
  version: { type: "boolean", short: "v", default: false },
} as const satisfies Record<string, ParseArgsOptionDescriptor>;

// At most this much of stdin is read for `--password-stdin`.
export const MAX_STDIN = 64 * 1024;
