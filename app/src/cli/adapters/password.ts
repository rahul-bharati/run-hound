import { MAX_STDIN } from "../../config/cli.js";


export async function readPasswordFromStdin(
  label: string,
  stdin: NodeJS.ReadableStream,
  stderr: NodeJS.WritableStream,
): Promise<string> {
  let text = "";
  if ((stdin as NodeJS.ReadStream).isTTY) {
    stderr.write(`Password for ${label} (not shown): `);
    text = await new Promise<string>((resolvePassword, reject) => {
      const tty = stdin as NodeJS.ReadStream;
      let typed = "";
      tty.setRawMode(true);
      tty.setEncoding("utf8");
      const done = (error?: Error) => {
        tty.setRawMode(false);
        tty.pause();
        tty.removeListener("data", onData);
        stderr.write("\n");
        if (error) reject(error);
        else resolvePassword(typed);
      };
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
          if (ch === "\u0003") return done(new Error("Cancelled; nothing was saved."));
          if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
          else typed += ch;
        }
      };
      tty.on("data", onData);
      tty.resume();
    });
  } else {
    for await (const chunk of stdin) {
      text += String(chunk);
      if (text.length > MAX_STDIN || /\r?\n/.test(text)) break;
    }
  }
  const password = text.split(/\r?\n/)[0] ?? "";
  if (password === "")
    throw new Error("--password-stdin: no password was given on stdin, so nothing was saved.");
  return password;
}
