import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { exitQuietlyOnClosedPipe } from "./stdio.js";

describe("exitQuietlyOnClosedPipe", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("exits with the current exit code when the reader closed the pipe (EPIPE), instead of crashing", () => {
    const stream = new PassThrough();
    const exits: number[] = [];
    exitQuietlyOnClosedPipe(stream, (code) => exits.push(code));
    process.exitCode = 1;
    stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    expect(exits).toEqual([1]);
  });

  it("exits 0 when no exit code was set yet", () => {
    const stream = new PassThrough();
    const exits: number[] = [];
    exitQuietlyOnClosedPipe(stream, (code) => exits.push(code));
    stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    expect(exits).toEqual([0]);
  });

  it("does not hide other stream errors", () => {
    const stream = new PassThrough();
    exitQuietlyOnClosedPipe(stream, () => undefined);
    expect(() => stream.emit("error", Object.assign(new Error("disk full"), { code: "ENOSPC" }))).toThrow("disk full");
  });
});
