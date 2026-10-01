/**
 * Public contracts of the local server (createApp and its options). The CLI (`serve`) and every test import ServerOptions
 * and createApp from `app.ts`; ServerOptions stays there as the public re-export, and is declared here so the rest of the
 * server depends on a typed contract, not on app.ts itself.
 */
import type { RunOptions } from "../../engine/runner.js";

export interface ServerOptions extends Pick<RunOptions, "checks" | "runsDir" | "allowedHosts"> {
  /** Runs allowed at the same time (each one drives its own Chromium). Default 2; more are refused with 409. */
  maxConcurrentRuns?: number;
  /** Whether a visible browser window can open on this machine. Detected (canShowBrowser) when omitted. */
  canShowBrowser?: boolean;
  /**
   * Extra host names and addresses this server answers to, besides loopback ones (RUNHOUND_SERVER_HOSTS).
   * Everything else is refused: a public domain that resolves to 127.0.0.1 (DNS rebinding) can't drive Run Hound
   * from a web page, and another container on the same network can't reach it by the server's IP address.
   */
  serverHosts?: string[];
  /** The address people open (RUNHOUND_PUBLIC_URL, set by the compose files); its host is accepted too. */
  publicUrl?: string;
  /**
   * The address `serve --host` bound to. A specific address is accepted (you chose to serve on it); a wildcard
   * (0.0.0.0, ::) adds nothing, so binding to every interface in a container doesn't open the API to its network.
   */
  boundHost?: string;
  /** How long the AI part of planning (review + suggest) may take per plan. Default AI_PLAN_BUDGET_MS (4 minutes). */
  aiPlanBudgetMs?: number;
}
