import { describe, expect, it, vi } from "vitest";
import { serveCommand } from "../../../src/cli/commands/serve.js";
import { buildDispatch, runAndReport } from "../../../src/cli/dispatch.js";
import { registerSecretLiterals } from "../../../src/engine/redact.js";
import { cliContext } from "../../support/cli.js";
import type { IServeCommandDeps, IServerHandle } from "../../../src/interfaces/cli.js";

function serverHarness() {
  const streams = cliContext();
  const signals = new Map<NodeJS.Signals, () => void>();
  let onError: (err: NodeJS.ErrnoException) => void = () => { throw new Error("No error listener installed"); };
  let onClose: () => void = () => { throw new Error("Server has not been closed"); };
  let listening = false;
  const close = vi.fn((callback: () => void) => { onClose = callback; });
  const server: IServerHandle = {
    close,
    get listening() { return listening; },
    on: (_event, listener) => { onError = listener; },
  };
  const exit = { set: vi.fn<(code: number) => void>(), terminate: vi.fn<(code: number) => void>() };
  const deps: IServeCommandDeps = {
    context: streams.context,
    services: {
      createApp: () => ({ fetch: () => new Response() }),
      startServer: () => server,
    },
    exit,
    signals: {
      once: (signal, listener) => { signals.set(signal, listener); },
      removeListener: (signal) => { signals.delete(signal); },
    },
  };
  return {
    ...streams, deps, exit, signals, close,
    fail: (error: NodeJS.ErrnoException) => onError(error),
    finishClosing: () => onClose(),
    markListening: () => { listening = true; },
  };
}

describe("serve lifecycle", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("exits only after closing on %s", (signal) => {
    const h = serverHarness();
    serveCommand([], h.deps);
    h.signals.get(signal)!();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.exit.terminate).not.toHaveBeenCalled();
    h.finishClosing();
    expect(h.exit.terminate).toHaveBeenCalledWith(0);
  });

  it("does not overwrite an asynchronous listen failure when dispatch completes", async () => {
    const h = serverHarness();
    const dispatch = buildDispatch({ context: h.context, commands: new Map([["serve", (args) => {
      serveCommand(args, h.deps);
      h.fail(Object.assign(new Error("occupied"), { code: "EADDRINUSE" }));
    }]]) });
    await runAndReport(["serve"], { context: h.context, exit: h.exit, dispatch });
    expect(h.exit.set.mock.calls).toEqual([[2]]);
    expect(h.exit.terminate).not.toHaveBeenCalled();
    expect(h.signals.size).toBe(0);
    expect(h.readErr()).toBe("run-hound: port 4000 on 127.0.0.1 is already in use (another Run Hound or dev server?). Stop it or pass --port <n>.\n");
  });

  it("redacts unknown listen errors and leaves live-server errors non-fatal", () => {
    const h = serverHarness();
    const secret = "test-server-secret-47dda";
    const unregister = registerSecretLiterals([secret]);
    try {
      serveCommand([], h.deps);
      h.context.setAccountHider((text) => text.replaceAll("alice@example.test", "[account]"));
      h.fail(new Error(`${secret} alice@example.test`));
      expect(h.readErr()).not.toContain(secret);
      expect(h.readErr()).not.toContain("alice@example.test");
      expect(h.exit.set).toHaveBeenCalledWith(2);
      h.exit.set.mockClear();
      h.markListening();
      h.fail(new Error(secret));
      expect(h.readErr()).not.toContain(secret);
      expect(h.exit.set).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
});
