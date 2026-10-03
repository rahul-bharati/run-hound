import { runAndReport, buildDispatch } from "./dispatch.js";
import { createContext } from "./context.js";
import { exitQuietlyOnClosedPipe } from "../engine/stdio.js";
import { readPasswordFromStdin } from "./adapters/password.js";
import { startServerWithApp } from "./adapters/server.js";
import { runCommand } from "./commands/run.js";
import { aiCommand } from "./commands/ai.js";
import { accountsCommand } from "./commands/accounts.js";
import { serveCommand } from "./commands/serve.js";
import { resolveAccounts, clearAccount, saveAccounts, checkAccountsPatch } from "../operations/accounts-storage.js";
import { resolveAiConfig } from "../ai/config.js";
import { aiSession } from "../ai/session.js";
import { testConnection } from "../ai/client.js";
import { canShowBrowser, discoverAndPlan, runPlan } from "../engine/runner.js";
import { createApp } from "../server/app.js";
import { checkLoginUrls, registerPasswords, testSignIn } from "../server/accounts.js";
import type { ISignalController, IServeExitController } from "../interfaces/cli.js";
import type { CommandHandler } from "../types/cli.js";

export async function run(argv: string[]): Promise<void> {
  const context = createContext({ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin });
  exitQuietlyOnClosedPipe(context.stdout);
  exitQuietlyOnClosedPipe(context.stderr);
  const exit: IServeExitController = {
    set: (code) => { process.exitCode = code; },
    terminate: (code) => { process.exit(code); },
  };
  const signals: ISignalController = {
    once: (signal, listener) => { process.once(signal, listener); },
    removeListener: (signal, listener) => { process.removeListener(signal, listener); },
  };
  const commands = new Map<string, CommandHandler>([
    ["run", (args) => runCommand(args, {
      context,
      services: { resolveAccounts, resolveAiConfig, discoverAndPlan, runPlan, registerPasswords, canShowBrowser, aiSession },
    })],
    ["ai", (args) => aiCommand(args, { context, services: { resolveAiConfig, testConnection } })],
    ["accounts", (args) => accountsCommand(args, {
      context,
      services: { resolveAccounts, clearAccount, saveAccounts, checkAccountsPatch, testSignIn, checkLoginUrls, registerPasswords },
      readPassword: (label) => readPasswordFromStdin(label, context.stdin, context.stderr),
      allowedHosts: () => (process.env.RUNHOUND_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean),
    })],
    ["serve", (args) => serveCommand(args, {
      context,
      services: { createApp, startServer: startServerWithApp },
      signals,
      exit,
    })],
  ]);
  await runAndReport(argv, { context, exit, dispatch: buildDispatch({ context, commands }) });
}
