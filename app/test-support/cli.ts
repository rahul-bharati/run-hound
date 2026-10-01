import { PassThrough } from "node:stream";
import { createContext } from "../src/cli/context.js";

export function cliContext() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
  stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
  return {
    context: createContext({ stdout, stderr, stdin }),
    readOut: () => out,
    readErr: () => err,
  };
}
