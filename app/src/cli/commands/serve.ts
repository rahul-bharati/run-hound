import { parseArgs } from "node:util";
import { USAGE } from "../../constants/cli-constants.js";
import { RUN_HOUND_VERSION } from "../../engine/runner.js";
import { UsageError } from "../../errors/usage-error.js";
import { printVersion } from "../adapters/terminal.js";
import { parseArgsWithError } from "../../utils/parse-args-with-errors.js";
import { SERVE_OPTIONS } from "../../config/cli.js";
import { redactSecrets } from "../../engine/redact.js";
import type { IServeCommandDeps } from "../../interfaces/cli.js";

const PUBLIC_HOST = /^(127\.|localhost$|::1$|\[::1\]$)/;

export function serveCommand(args: string[], deps: IServeCommandDeps): void {
  const { values, positionals } = parseArgsWithError(() =>
    parseArgs({ args, allowPositionals: true, options: SERVE_OPTIONS }),
  );
  if (values.help) {
    deps.context.stdout.write(`${USAGE}\n`);
    return;
  }
  if (values.version) {
    printVersion(deps.context.stdout, RUN_HOUND_VERSION);
    return;
  }
  if (positionals.length) throw new UsageError(`unexpected argument: ${positionals[0]}`);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new UsageError(`invalid port: ${values.port}`);

  if (!PUBLIC_HOST.test(values.host)) {
    deps.context.stderr.write(
      `run-hound: warning: serving on ${values.host}, not just localhost. Anyone who can reach this address can start runs.\n`,
    );
  }
  const app = deps.services.createApp({ runsDir: values["runs-dir"], boundHost: values.host });
  const server = deps.services.startServer({ port, host: values.host, app, stdout: deps.context.stdout });

  const stop = () => server.close(() => deps.exit.terminate(0));
  deps.signals.once("SIGINT", stop);
  deps.signals.once("SIGTERM", stop);

  // Listen errors arrive asynchronously, outside the dispatcher's error handler.
  server.on("error", (err) => {
    if (server.listening) {
      deps.context.stderr.write(`run-hound: server error: ${redactSecrets(err.message)}\n`);
      return;
    }
    const where = `port ${port} on ${values.host}`;
    if (err.code === "EADDRINUSE")
      failServe(deps, `${where} is already in use (another Run Hound or dev server?). Stop it or pass --port <n>.`);
    else if (err.code === "EACCES")
      failServe(deps, `not allowed to listen on ${where} (ports below 1024 need extra permissions). Pass --port <n>.`);
    else if (err.code === "EADDRNOTAVAIL")
      failServe(deps, `${values.host} is not an address of this machine. Pass --host 127.0.0.1.`);
    else failServe(deps, `could not listen on ${where}: ${err.message}`);
    deps.signals.removeListener("SIGINT", stop);
    deps.signals.removeListener("SIGTERM", stop);
  });
}

function failServe(
  deps: IServeCommandDeps,
  message: string,
): void {
  deps.context.stderr.write(`run-hound: ${deps.context.accountHider(redactSecrets(message))}\n`);
  deps.exit.set(2);
}
