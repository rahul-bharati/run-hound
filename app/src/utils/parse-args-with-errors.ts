import { UsageError } from "../errors/usage-error.js";

export function parseArgsWithError<R>(run: () => R): R {
  try {
    return run();
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code.startsWith("ERR_PARSE_ARGS")) throw new UsageError((err as Error).message);
    throw err;
  }
}
