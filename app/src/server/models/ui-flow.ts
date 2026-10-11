/**
 * UI flow: render the local app shell once at startup, compute its CSP once (so the inline hashes match).
 */
import { renderUi } from "../ui/index.js";
import { uiCsp } from "../middleware/security.js";
import type { IUiFlow } from "../../interfaces/server.js";

/** Dependencies the UI flow needs. */
export interface UiFlowDeps {
  version: string;
  canShowBrowser: boolean;
  /** Whether the agent's features are on (RUNHOUND_AGENT=1, or createApp({ agent: true })): the New run page then offers briefs (A2). */
  agent: boolean;
}

/** UI flow: serves GET / with its pre-rendered HTML and pre-computed CSP. */
export class UiFlow implements IUiFlow {
  readonly #html: string;
  readonly #policy: string;

  constructor(deps: UiFlowDeps) {
    this.#html = renderUi({ version: deps.version, canShowBrowser: deps.canShowBrowser, agent: deps.agent });
    this.#policy = uiCsp(this.#html);
  }

  uiHtml(): string {
    return this.#html;
  }

  uiPolicy(): string {
    return this.#policy;
  }
}