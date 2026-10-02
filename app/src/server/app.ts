/**
 * Composition root: builds model objects, constructs each feature's flow, mounts middleware, and registers the
 * controllers with their narrow flow dependency. The middleware order and route map match the pre-refactor app.ts.
 */
import { Hono } from "hono";
import {
  registerAccountsRoutes,
  registerAiRoutes,
  registerPlanRoutes,
  registerRunsRoutes,
  registerUiRoutes,
} from "./controllers/index.js";
import {
  headerGuard,
  hostAllow,
  jsonOnlyApi,
  securityHeaders,
} from "./middleware/index.js";
import { AccountsFlow } from "./models/account-flow.js";
import { AiFlow } from "./models/ai-flow.js";
import { PlanFlow } from "./models/plan-flow.js";
import { buildServerModels } from "./models/services.js";
import { RunsFlow } from "./models/run-flow.js";
import { UiFlow } from "./models/ui-flow.js";
import { discoverAndPlan } from "../engine/runner.js";
import type { ServerOptions } from "../interfaces/server.js";

export type { ServerOptions };

export interface CreateAppResult {
  app: Hono;
  models: ReturnType<typeof buildServerModels>;
}

/** Build the Hono app and the server models (returned for tests / future wiring). */
export function createApp(options: ServerOptions = {}): Hono {
  const models = buildServerModels(options);
  const app = new Hono();

  app.use("*", securityHeaders());
  app.use("*", hostAllow(models.host.hostAllowed));

  const uiFlow = new UiFlow({ version: models.version, canShowBrowser: models.canShowBrowser });
  registerUiRoutes(app, { flow: uiFlow });

  app.use("/api/*", jsonOnlyApi());

  const aiGuard = headerGuard("/api/ai");
  app.use("/api/ai", aiGuard);
  app.use("/api/ai/*", aiGuard);
  const accountsGuard = headerGuard("/api/accounts");
  app.use("/api/accounts", accountsGuard);
  app.use("/api/accounts/*", accountsGuard);

  const planFlow = new PlanFlow({
    discoverAndPlan,
    store: models.plans,
    aiPlanBudgetMs: models.host.aiPlanBudgetMs,
    ...(options.checks !== undefined ? { checks: options.checks } : {}),
    ...(options.allowedHosts !== undefined ? { allowedHosts: options.allowedHosts } : {}),
  });
  const runsFlow = new RunsFlow({
    discoverAndPlan,
    plans: models.plans,
    runs: {
      startRun: (plan, approved, flags) => models.runs.startRun(plan, approved, flags),
      runState: (id) => models.runs.runState(id),
      listRuns: () => models.runs.listRuns(),
      isRedactedPlan: (state) => models.runs.isRedactedPlan(state),
      get map() { return models.runs.runs; },
      maxConcurrentRuns: models.runs.maxConcurrentRuns,
      runsDir: models.runs.runsDir,
    },
    options: { checks: options.checks, allowedHosts: options.allowedHosts },
    host: { aiPlanBudgetMs: () => models.host.aiPlanBudgetMs },
    canShowBrowser: models.canShowBrowser,
  });
  const aiFlow = new AiFlow({
    host: { runsDir: models.host.runsDir, allowedHosts: () => models.host.allowedHosts(), extraHosts: models.host.extraHosts },
    version: models.version,
  });
  const accountsFlow = new AccountsFlow({
    allowedHosts: () => models.host.allowedHosts(),
    signInTests: models.signInTests,
  });

  registerPlanRoutes(app, { flow: planFlow });
  registerRunsRoutes(app, { flow: runsFlow });
  registerAiRoutes(app, { flow: aiFlow });
  registerAccountsRoutes(app, { flow: accountsFlow });

  app.notFound((c) => c.json({ error: "Not found." }, 404));
  return app;
}