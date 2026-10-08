export interface Args { app: string; evidence: string; artifact: string; home: string; installedPaths: string[]; packageFiles: string; afterUninstall: boolean; waitSeconds: number }
export interface Step { name: string; ok: boolean; ms: number; detail?: string; error?: string }
export interface Evidence { schema: number; ok: boolean; steps: Step[]; [key: string]: unknown }
export function parseArgs(argv: string[]): Args;
export function expectedDataDirs(platform: string, home: string, env?: Record<string, string | undefined>): { settings: string; runs: string };
export function isolatedEnv(base: Record<string, string | undefined>, platform: string, home: string): Record<string, string>;
export function leftoverFiles(listing: string, kind: (path: string) => "file" | "dir" | null): string[];
export function redact(text: unknown, secrets: string[]): string;
export class StepRecorder {
  constructor(options?: { now?: () => number; secrets?: string[] });
  steps: Step[];
  run(name: string, fn: () => unknown): Promise<boolean>;
  get ok(): boolean;
}
export function poll<T>(fn: () => Promise<T | undefined> | T | undefined, options: { timeoutMs: number; intervalMs?: number; what: string; now?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<T>;
export function findPlainText(files: { path: string; bytes: Uint8Array }[], secret: string): string[];
export function confirmedFindings(report: unknown): { confidence: string }[];
export const STOPPED_NOTE: string;
export function stoppedRunProblems(report: unknown): { problems: string[]; stopped: string[] };
export function reportDigest(report: unknown): Record<string, unknown>;
export function buildEvidence(facts: Record<string, unknown>, steps: Step[]): Evidence;
export function summaryMarkdown(evidence: Record<string, unknown>): string;
export const APP_NAME: string;
export function nameProblems(facts: { platform: string; executable: string; appName: unknown; userData: unknown }): string[];
