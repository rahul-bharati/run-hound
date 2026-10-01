import { describe, expect, it, vi } from "vitest";
import { buildDispatch, runAndReport } from "../../../src/cli/dispatch.js";
import { UsageError } from "../../../src/errors/usage-error.js";
import { registerSecretLiterals } from "../../../src/engine/redact.js";
import { USAGE } from "../../../src/constants/cli-constants.js";
import { cliContext } from "../../../test-support/cli.js";
import type { CommandRegistry } from "../../../src/types/cli.js";

function application(commands: CommandRegistry = new Map()) {
  const streams = cliContext();
  const set = vi.fn<(code: number) => void>();
  return {
    ...streams,
    set,
    run: (args: string[]) => runAndReport(args, {
      context: streams.context,
      exit: { set },
      dispatch: buildDispatch({ context: streams.context, commands }),
    }),
  };
}

describe("CLI dispatch", () => {
  it("routes a registered command's arguments and preserves its exit code", async () => {
    const handler = vi.fn(() => 1);
    const app = application(new Map([["custom", handler]]));
    await app.run(["custom", "a", "--json"]);
    expect(handler).toHaveBeenCalledWith(["a", "--json"]);
    expect(app.set).toHaveBeenCalledWith(1);
  });

  it.each(["nope", "constructor", "toString", "__proto__"])("rejects unregistered %s as a usage error", async (command) => {
    const app = application();
    await app.run([command]);
    expect(app.set).toHaveBeenCalledWith(2);
    expect(app.readErr()).toBe(`run-hound: unknown command: ${command}\n${USAGE}\n`);
  });

  it("preserves missing-command wording", async () => {
    const app = application();
    await app.run([]);
    expect(app.readErr()).toBe(`run-hound: missing command\n${USAGE}\n`);
  });

  it.each(["--help", "-h", "help"])("preserves the %s alias without overwriting an existing exit code", async (alias) => {
    const app = application();
    await app.run([alias]);
    expect(app.readOut()).toBe(`${USAGE}\n`);
    expect(app.set).not.toHaveBeenCalled();
  });

  it.each(["--version", "-v", "version"])("preserves the %s alias", async (alias) => {
    const app = application();
    await app.run([alias]);
    expect(app.readOut()).toMatch(/^run-hound \d+\.\d+\.\d+\n$/);
    expect(app.set).not.toHaveBeenCalled();
  });

  it("adds usage only for a UsageError from a handler", async () => {
    const app = application(new Map([["accounts", () => { throw new UsageError("accounts needs a command"); }]]));
    await app.run(["accounts"]);
    expect(app.readErr()).toBe(`run-hound: accounts needs a command\n${USAGE}\n`);
    expect(app.set).toHaveBeenCalledWith(2);
  });

  it("masks registered secrets before applying the account hider to failures", async () => {
    const secret = "test-password-f7c8a9-not-a-pattern";
    const unregister = registerSecretLiterals([secret]);
    try {
      const app = application(new Map([["run", () => { throw new Error(`${secret} alice@example.test`); }]]));
      const hider = vi.fn((text: string) => text.replaceAll("alice@example.test", "[account]"));
      app.context.setAccountHider(hider);
      await app.run(["run"]);
      expect(hider).toHaveBeenCalledOnce();
      expect(hider.mock.calls[0]![0]).not.toContain(secret);
      expect(app.readErr()).not.toContain(secret);
      expect(app.readErr()).not.toContain("alice@example.test");
      expect(app.readErr()).toContain("[account]");
      expect(app.readErr()).not.toContain("Usage:");
      expect(app.set).toHaveBeenCalledWith(2);
    } finally {
      unregister();
    }
  });

  it("keeps account masking scoped to its invocation", () => {
    const a = cliContext();
    const b = cliContext();
    a.context.setAccountHider(() => "[account]");
    expect(a.context.accountHider("alice")).toBe("[account]");
    expect(b.context.accountHider("alice")).toBe("alice");
  });
});
