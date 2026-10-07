import { parseArgs } from "node:util";
import { USAGE } from "../../constants/cli-constants.js";
import { UsageError } from "../../errors/usage-error.js";
import { parseArgsWithError } from "../../utils/parse-args-with-errors.js";
import { AI_COMMAND_OPTIONS } from "../../config/cli.js";
import { aiStatus } from "../../ai/config.js";
import { aiFlagsFrom } from "../flags.js";
import { aiStatusLines, aiTestOk, aiTestFailed } from "../presenters/ai.js";
import { redactSecrets } from "../../engine/redact.js";
import type { IAiCommandDeps } from "../../interfaces/cli.js";

export async function aiCommand(args: string[], deps: IAiCommandDeps): Promise<number> {
  const { values, positionals } = parseArgsWithError(() =>
    parseArgs({ args, allowPositionals: true, options: AI_COMMAND_OPTIONS, allowNegative: true }),
  );
  if (values.help) {
    deps.context.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const [sub, ...extra] = positionals;
  if (extra.length) throw new UsageError(`unexpected argument: ${extra[0]}`);
  const resolved = await deps.services.resolveAiConfig({ flags: aiFlagsFrom(values) });
  const status = aiStatus(resolved);

  if (sub === "status") {
    deps.context.stdout.write(`${redactSecrets(aiStatusLines(status).join("\n"))}\n`);
    return 0;
  }
  if (sub === "test") {
    const result = await deps.services.testConnection({ ...resolved.config, enabled: true });
    if (result.ok) {
      deps.context.stdout.write(aiTestOk(status.provider ?? "(none)", result.model, result.ms));
      return 0;
    }
    deps.context.stderr.write(aiTestFailed(redactSecrets(result.error), status));
    return 1;
  }
  throw new UsageError(
    sub
      ? `unknown ai command: ${sub} (use "ai status" or "ai test")`
      : 'ai needs a command: "ai status" or "ai test"',
  );
}
