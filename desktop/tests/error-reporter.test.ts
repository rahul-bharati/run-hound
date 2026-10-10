import { describe, expect, it, vi } from "vitest";
import { createErrorReporter } from "../src/error-reporter.js";
import type { Problem } from "../src/problem-page.js";

/** A reporter whose window stays open until the test closes it. */
function setup(overrides: { show?: (problem: Problem) => Promise<void>; fallback?: (title: string, text: string) => void; log?: (text: string) => void } = {}) {
  const logged: string[] = [];
  const shown: Problem[] = [];
  const closers: Array<{ close(): void; fail(err: Error): void }> = [];
  const fallback = vi.fn(overrides.fallback ?? (() => undefined));
  const reporter = createErrorReporter({
    log: overrides.log ?? ((text) => void logged.push(text)),
    show:
      overrides.show ??
      ((problem) => {
        shown.push(problem);
        return new Promise<void>((resolve, reject) => closers.push({ close: resolve, fail: reject }));
      }),
    fallback,
  });
  return { reporter, logged, shown, closers, fallback };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("the error reporter", () => {
  it("writes the error to stderr in the app's style and shows it in the branded window", () => {
    const { reporter, logged, shown } = setup();
    reporter.report(new Error("boom"), "uncaughtException");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^\[run-hound\] uncaught exception: Error: boom\n {4}at /);
    expect(logged[0]!.endsWith("\n")).toBe(true);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe("Run Hound ran into a problem");
  });

  it("shows one window at a time: errors meanwhile are only logged", () => {
    const { reporter, logged, shown } = setup();
    for (let i = 0; i < 5; i++) reporter.report(new Error(`again ${i}`), "uncaughtException");
    expect(shown).toHaveLength(1);
    expect(logged).toHaveLength(5);
    expect(logged[4]).toContain("again 4");
  });

  it("shows the next error in a new window once the first is closed", async () => {
    const { reporter, shown, closers } = setup();
    reporter.report(new Error("first"), "uncaughtException");
    closers[0]!.close();
    await settle();
    reporter.report(new Error("second"), "unhandledRejection");
    expect(shown).toHaveLength(2);
    expect(shown[1]!.paragraphs[0]).toBe("Something Run Hound was doing in the background failed.");
  });

  it("falls back to the native error box, once, when the window can't be shown, and does not loop", async () => {
    const { reporter, logged, closers, fallback } = setup({
      show: () => Promise.reject(new Error("no display")),
    });
    reporter.report(new Error("first"), "uncaughtException");
    await settle();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0]![0]).toBe("Run Hound ran into a problem");
    expect(fallback.mock.calls[0]![1]).toContain("The error was: first");
    expect(logged.some((line) => line.includes("could not show the error window: no display"))).toBe(true);
    expect(closers).toHaveLength(0);
    // The failed window doesn't hold the reporter shut: the next error is tried again, still once each.
    reporter.report(new Error("second"), "uncaughtException");
    await settle();
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it("falls back when showing throws at once or the window fails later, and survives a fallback that throws", async () => {
    const throwing = setup({ show: () => { throw new Error("sync failure"); }, fallback: () => { throw new Error("no box either"); } });
    expect(() => throwing.reporter.report(new Error("x"), "uncaughtException")).not.toThrow();
    await settle();
    expect(throwing.fallback).toHaveBeenCalledTimes(1);

    const later = setup();
    later.reporter.report(new Error("y"), "uncaughtException");
    later.closers[0]!.fail(new Error("window crashed"));
    await settle();
    expect(later.fallback).toHaveBeenCalledTimes(1);
  });

  it("never throws, even when stderr does", () => {
    const { reporter, shown } = setup({ log: () => { throw new Error("EPIPE"); } });
    expect(() => reporter.report("text", "uncaughtException")).not.toThrow();
    expect(shown).toHaveLength(1);
  });
});
