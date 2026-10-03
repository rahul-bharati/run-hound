/** Configurable defaults the runner reads: the per-scenario and network-idle time limits, and the env-backed allowed-hosts fallback. Pure data; the runner calls allowedHosts() each time so test isolation (process.env) holds. */

export const SCENARIO_TIMEOUT_MS = 3 * 60_000;

export const NETWORK_IDLE_TIMEOUT_MS = 5_000;

export function allowedHosts(injected: string[] | undefined, env: NodeJS.ProcessEnv = process.env): string[] {
  return injected ?? (env.RUNHOUND_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
}
