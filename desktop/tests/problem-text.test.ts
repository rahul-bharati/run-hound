import { describe, expect, it } from "vitest";
import { ERR_ABORTED, UNCAUGHT_TITLE, crashProblem, errorText, loadFailureProblem, pathOf, uncaughtProblem } from "../src/problem-text.js";

describe("uncaughtProblem", () => {
  it("says an uncaught exception in plain words, with the message, and keeps the whole stack for the monospace block and stderr", () => {
    const error = new Error("launch-check boom\nsecond line");
    const { problem, log } = uncaughtProblem(error, "uncaughtException");
    expect(problem.title).toBe(UNCAUGHT_TITLE);
    expect(problem.paragraphs).toEqual([
      "Something unexpected went wrong inside Run Hound.",
      "You can keep using it. If it stops responding or acts strangely, quit and open it again.",
      "The error was: launch-check boom",
    ]);
    expect(problem.details).toBe(error.stack);
    expect(log).toBe(`uncaught exception: ${error.stack}`);
  });

  it("calls an unhandled rejection a task in the background", () => {
    const { problem, log } = uncaughtProblem(new Error("nobody caught me"), "unhandledRejection");
    expect(problem.paragraphs[0]).toBe("Something Run Hound was doing in the background failed.");
    expect(log.startsWith("unhandled rejection: Error: nobody caught me")).toBe(true);
  });

  it("copes with anything being thrown: a string, an object, nothing, an error with no stack", () => {
    expect(uncaughtProblem("just text", "uncaughtException").problem.paragraphs.at(-1)).toBe("The error was: just text");
    expect(uncaughtProblem({ code: "E_X", detail: [1, 2] }, "unhandledRejection").problem.details).toContain("E_X");
    expect(uncaughtProblem(undefined, "unhandledRejection").problem.details).toBe("undefined");
    const bare = new Error("bare");
    bare.stack = undefined;
    expect(errorText(bare)).toBe("Error: bare");
    expect(uncaughtProblem(new Error(""), "uncaughtException").problem.paragraphs).toHaveLength(2);
  });

  it("cuts a very long message to one short line", () => {
    const { problem } = uncaughtProblem(new Error("x".repeat(1000)), "uncaughtException");
    expect(problem.paragraphs.at(-1)).toBe(`The error was: ${"x".repeat(300)}…`);
  });

  it("never throws, even for a value that can't be printed", () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("no"); }, getPrototypeOf: () => { throw new Error("no"); } });
    expect(() => uncaughtProblem(hostile, "uncaughtException")).not.toThrow();
  });
});

describe("pathOf", () => {
  it("is the path alone: no query, fragment or credentials, which can carry tokens", () => {
    expect(pathOf("http://user:pw@127.0.0.1:5000/api/runs/abc/report.html?token=SECRET#frag")).toBe("/api/runs/abc/report.html");
    expect(pathOf("http://127.0.0.1:5000/?token=SECRET")).toBe("/");
    expect(pathOf("not a url")).toBe("(unknown)");
  });
});

describe("loadFailureProblem", () => {
  const failure = { code: -102, description: "ERR_CONNECTION_REFUSED", url: "http://127.0.0.1:5000/api/runs/abc/report.html?token=SECRET#x" };

  it("says what happened in words, then the error and the page's path, and nothing from the query", () => {
    const problem = loadFailureProblem(failure);
    expect(problem.title).toBe("This page didn't load");
    expect(problem.paragraphs[0]).toBe("The part of Run Hound that serves this page isn't answering. It may have stopped or restarted.");
    expect(problem.paragraphs[1]).toBe("Try again. If it keeps happening, quit and open Run Hound again.");
    expect(problem.details).toBe("Error: ERR_CONNECTION_REFUSED (-102)\nPage: /api/runs/abc/report.html");
    expect(JSON.stringify(problem)).not.toMatch(/SECRET|token|127\.0\.0\.1/);
  });

  it("words a few families of failure, and falls back for the rest", () => {
    const why = (description: string) => loadFailureProblem({ ...failure, description }).paragraphs[0];
    expect(why("ERR_EMPTY_RESPONSE")).toBe(why("net::ERR_CONNECTION_RESET"));
    expect(why("ERR_TIMED_OUT")).toBe("The part of Run Hound that serves this page took too long to answer.");
    expect(why("ERR_INTERNET_DISCONNECTED")).toBe("This computer's network connection changed or went offline while the page was loading.");
    expect(why("ERR_BLOCKED_BY_CLIENT")).toBe("Something stopped the page from loading.");
    expect(loadFailureProblem({ ...failure, description: "net::ERR_X" }).details).toBe("Error: ERR_X (-102)\nPage: /api/runs/abc/report.html");
    expect(loadFailureProblem({ code: -2, description: "", url: "" }).details).toBe("Error: unknown (-2)\nPage: (unknown)");
  });

  it("treats ERR_ABORTED as a code of its own, -3, so main.ts can ignore a cancelled navigation", () => {
    expect(ERR_ABORTED).toBe(-3);
  });
});

describe("crashProblem", () => {
  it("says the page crashed and what to do, with Electron's reason and the page's path", () => {
    const problem = crashProblem("oom", "http://127.0.0.1:5000/api/runs/abc/report.html?token=SECRET");
    expect(problem.title).toBe("This page stopped working");
    expect(problem.paragraphs).toEqual(["The page in this window crashed.", "Reload it to carry on. Settings and results Run Hound has already saved are not affected."]);
    expect(problem.details).toBe("Reason: oom\nPage: /api/runs/abc/report.html");
  });
});
