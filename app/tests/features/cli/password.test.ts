// `--password-stdin` reader adapter: piped + TTY paths.
import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { readPasswordFromStdin } from "../../../src/cli/adapters/password.js";

describe("readPasswordFromStdin", () => {
  it("returns the first line of a piped (non-TTY) stream", async () => {
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    let errText = "";
    stderr.on("data", (b: Buffer) => (errText += b.toString("utf8")));
    const promise = readPasswordFromStdin("Test", stdin, stderr);
    stdin.write("hunter2-bytes\nextra\n");
    stdin.end();
    expect(await promise).toBe("hunter2-bytes");
    expect(errText).toBe("");
  });

  it("throws when the piped input is empty", async () => {
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    const promise = readPasswordFromStdin("Test", stdin, stderr);
    stdin.end();
    await expect(promise).rejects.toThrow(/--password-stdin: no password/);
  });

  it("throws when the piped input is only newlines", async () => {
    const stdin = new PassThrough();
    const stderr = new PassThrough();
    const promise = readPasswordFromStdin("Test", stdin, stderr);
    stdin.write("\n\n\n");
    stdin.end();
    await expect(promise).rejects.toThrow(/--password-stdin: no password/);
  });
});