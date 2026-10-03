import { USAGE } from "../constants/cli-constants.js";
import { RUN_HOUND_VERSION } from "../engine/runner.js";
import { UsageError } from "../errors/usage-error.js";
import { printVersion } from "./adapters/terminal.js";
import { redactSecrets } from "../engine/redact.js";
import type { IApplicationDeps, IDispatchOptions } from "../interfaces/cli.js";
import type { DispatchFn } from "../types/cli.js";

export function buildDispatch({ context, commands }: IDispatchOptions): DispatchFn {
  return async (argv) => {
    const [command, ...rest] = argv;
    if (command === "--help" || command === "-h" || command === "help") {
      context.stdout.write(`${USAGE}\n`);
      return;
    }
    if (command === "--version" || command === "-v" || command === "version") {
      printVersion(context.stdout, RUN_HOUND_VERSION);
      return;
    }
    const handler = command === undefined ? undefined : commands.get(command);
    if (!handler) throw new UsageError(command ? `unknown command: ${command}` : "missing command");
    return handler(rest);
  };
}

export async function runAndReport(argv: string[], deps: IApplicationDeps): Promise<void> {
  try {
    const code = await deps.dispatch(argv);
    if (code !== undefined) deps.exit.set(code);
  } catch (err) {
    const message = err instanceof UsageError
      ? `${err.message}\n${USAGE}`
      : err instanceof Error ? err.message : String(err);
    deps.context.stderr.write(`run-hound: ${deps.context.accountHider(redactSecrets(message))}\n`);
    deps.exit.set(2);
  }
}
