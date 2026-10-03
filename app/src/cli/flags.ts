import { UsageError } from "../errors/usage-error.js";
import type { IAiFlags } from "../interfaces/cli.js";
import type { AiFlags } from "../ai/config.js";
import { AI_PROVIDERS } from "../constants/ai-constants.js";
import type { AiProvider } from "../ai/types.js";

export function aiFlagsFrom(values: IAiFlags): AiFlags {
  const provider = values["ai-provider"];
  if (provider !== undefined && !(AI_PROVIDERS as readonly string[]).includes(provider)) {
    throw new UsageError(`unknown --ai-provider "${provider}" (use ${AI_PROVIDERS.join(", ")})`);
  }
  const flags: AiFlags = {};
  if (values.ai !== undefined) flags.enabled = values.ai;
  if (provider !== undefined) flags.provider = provider as AiProvider;
  if (values["ai-model"] !== undefined) flags.model = values["ai-model"];
  if (values["ai-base-url"] !== undefined) flags.baseUrl = values["ai-base-url"];
  if (values["ai-allow-remote"]) flags.allowRemote = true;
  return flags;
}
