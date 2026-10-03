import type { ICliContext, ICliStreams } from "../interfaces/cli.js";

export function createContext(opts: ICliStreams): ICliContext {
  let hide: (text: string) => string = (text) => text;
  return {
    stdout: opts.stdout,
    stderr: opts.stderr,
    stdin: opts.stdin,
    accountHider: (text) => hide(text),
    setAccountHider(next) {
      hide = next;
    },
  };
}
