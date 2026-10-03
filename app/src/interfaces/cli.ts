import type { CommandRegistry, DispatchFn } from "../types/cli.js";

export interface IAiFlags {
  ai?: boolean;
  "ai-provider"?: string;
  "ai-model"?: string;
  "ai-base-url"?: string;
  "ai-allow-remote"?: boolean;
}

export interface ICliStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
}

export interface ICliContext extends ICliStreams {
  accountHider(text: string): string;
  setAccountHider(hide: (text: string) => string): void;
}

export interface IRunServices {
  resolveAccounts: typeof import("../operations/accounts-storage.js").resolveAccounts;
  resolveAiConfig: typeof import("../ai/config.js").resolveAiConfig;
  discoverAndPlan: typeof import("../engine/runner.js").discoverAndPlan;
  runPlan: typeof import("../engine/runner.js").runPlan;
  registerPasswords: typeof import("../server/accounts.js").registerPasswords;
  canShowBrowser: typeof import("../engine/runner.js").canShowBrowser;
  aiSession: typeof import("../ai/session.js").aiSession;
}

export interface IAiServices {
  resolveAiConfig: typeof import("../ai/config.js").resolveAiConfig;
  testConnection: typeof import("../ai/client.js").testConnection;
}

export interface IAccountsServices {
  resolveAccounts: typeof import("../operations/accounts-storage.js").resolveAccounts;
  clearAccount: typeof import("../operations/accounts-storage.js").clearAccount;
  saveAccounts: typeof import("../operations/accounts-storage.js").saveAccounts;
  checkAccountsPatch: typeof import("../operations/accounts-storage.js").checkAccountsPatch;
  testSignIn: typeof import("../server/accounts.js").testSignIn;
  checkLoginUrls: typeof import("../server/accounts.js").checkLoginUrls;
  registerPasswords: typeof import("../server/accounts.js").registerPasswords;
}

export interface ICliHonoApp {
  fetch(request: Request): Response | Promise<Response>;
}

export interface IServerOptions {
  port: number;
  host: string;
  app: ICliHonoApp;
  stdout: NodeJS.WritableStream;
}

export interface IServerHandle {
  close(callback: () => void): void;
  readonly listening: boolean;
  on(event: "error", listener: (err: NodeJS.ErrnoException) => void): void;
}

export interface IServeServices {
  createApp(options: Parameters<typeof import("../server/app.js").createApp>[0]): ICliHonoApp;
  startServer(options: IServerOptions): IServerHandle;
}

export interface IExitController {
  set(code: number): void;
}

export interface IServeExitController extends IExitController {
  terminate(code: number): void;
}

export interface ISignalController {
  once(signal: NodeJS.Signals, listener: () => void): void;
  removeListener(signal: NodeJS.Signals, listener: () => void): void;
}

export interface IRunCommandDeps {
  context: ICliContext;
  services: IRunServices;
}

export interface IAiCommandDeps {
  context: ICliContext;
  services: IAiServices;
}

export interface IAccountsCommandDeps {
  context: ICliContext;
  services: IAccountsServices;
  readPassword(label: string): Promise<string>;
  allowedHosts(): string[];
}

export interface IServeCommandDeps {
  context: ICliContext;
  services: IServeServices;
  signals: ISignalController;
  exit: IServeExitController;
}

export interface IDispatchOptions {
  context: ICliContext;
  commands: CommandRegistry;
}

export interface IApplicationDeps {
  context: ICliContext;
  exit: IExitController;
  dispatch: DispatchFn;
}
