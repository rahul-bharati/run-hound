/**
 * AI controller: GET /api/ai (resolved config without the key), PUT /api/ai (AiConfigPatch → AiStatus),
 * POST /api/ai/test (one tiny call with the saved settings), GET /api/ai/models (model list for a provider/baseUrl),
 * and GET /api/settings (version + runsDir + allowedHosts + serverHosts + AI status). Mounted under /api/ai* and
 * /api/ai, guarded by headerGuard.
 */
import type { Hono } from "hono";
import { aiStatus, DEFAULT_BASE_URLS, endpointHost, resolveAiConfig, saveAiConfig } from "../../ai/config.js";
import { testConnection } from "../../ai/client.js";
import { listModels } from "../../ai/models.js";
import { AI_PROVIDERS } from "../../constants/ai-constants.js";
import type { AiConfigPatch, AiProvider } from "../../ai/types.js";
import { redactSecrets } from "../../engine/redact.js";
import type { Services } from "../models/services.js";

/** Origin of a URL, or null when it doesn't parse. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export interface AiControllerDeps {
  services: Services;
}

export function registerAiRoutes(app: Hono, deps: AiControllerDeps): void {
  const { services } = deps;

  app.get("/api/settings", async (c) =>
    c.json({
      version: services.version,
      runsDir: services.host.runsDir,
      allowedHosts: services.host.allowedHosts(),
      serverHosts: services.host.extraHosts,
      ai: aiStatus(await resolveAiConfig()),
    }),
  );

  app.get("/api/ai", async (c) =>
    c.json(aiStatus(await resolveAiConfig()), 200, {
      "cache-control": "no-store",
    }),
  );

  app.put("/api/ai", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The request body must be JSON." }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return c.json({ error: "Send the AI settings as a JSON object." }, 400);
    const features = (body as { features?: unknown }).features;
    if (
      features !== undefined &&
      (typeof features !== "object" ||
        features === null ||
        Array.isArray(features) ||
        Object.values(features).some((v) => typeof v !== "boolean"))
    ) {
      return c.json(
        {
          error:
            'features must be an object like {"review": true, "suggest": true, "explain": false}.',
        },
        400,
      );
    }
    try {
      const { notice, ...resolved } = await saveAiConfig(body as AiConfigPatch);
      return c.json(
        { ...aiStatus(resolved), ...(notice ? { notice } : {}) },
        200,
        { "cache-control": "no-store" },
      );
    } catch (err) {
      return c.json(
        {
          error: redactSecrets(
            err instanceof Error ? err.message : String(err),
          ),
        },
        400,
      );
    }
  });

  app.post("/api/ai/test", async (c) => {
    const { config } = await resolveAiConfig();
    const result = await testConnection({ ...config, enabled: true });
    return c.json(
      result.ok ? result : { ok: false, error: redactSecrets(result.error) },
      200,
      { "cache-control": "no-store" },
    );
  });

  app.get("/api/ai/models", async (c) => {
    const { config } = await resolveAiConfig();
    const asked = c.req.query("provider");
    if (asked && !(AI_PROVIDERS as readonly string[]).includes(asked))
      return c.json(
        { error: `Unknown provider "${redactSecrets(asked)}".` },
        400,
      );
    const provider = (asked || config.provider) as AiProvider;
    const baseUrl =
      c.req.query("baseUrl") ||
      (provider === config.provider
        ? config.baseUrl
        : DEFAULT_BASE_URLS[provider]);
    const target = { provider, baseUrl, region: config.region };
    const savedOrigin = originOf(config.baseUrl);
    // The saved key only ever goes to the endpoint it was saved for.
    const apiKey =
      savedOrigin !== null && originOf(baseUrl) === savedOrigin
        ? config.apiKey
        : null;
    const consent =
      /^(1|true|on)$/i.test(c.req.query("allowRemote") ?? "") ||
      (config.allowRemote && endpointHost(target) === endpointHost(config));
    const list = await listModels({ ...target, apiKey, allowRemote: consent });
    return c.json(
      list.error ? { ...list, error: redactSecrets(list.error) } : list,
      200,
      { "cache-control": "no-store" },
    );
  });
}
