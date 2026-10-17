/**
 * Saves, clears and lists the keys the live provider tests (tests/live) use, in Run Hound's encrypted store
 * (<config folder>/secrets.json), never in the repository or a .env file.
 *
 *   pnpm --filter run-hound live-keys set <anthropic|openai|gemini|bedrock>   reads the key from stdin
 *   pnpm --filter run-hound live-keys clear <provider>
 *   pnpm --filter run-hound live-keys list                                    names only, never a value
 *
 * `set` takes the key from stdin only (never from the command line, where it would land in shell history and the
 * process list): type or paste it, then Enter (nothing is echoed on a terminal), or pipe it in. For bedrock the value
 * is a Bedrock API key (bearer token); an AWS access key pair is only read from the environment by the tests.
 */
import { configDir } from "../src/config/ai.js";
import { readSecrets, writeSecrets } from "../src/operations/secret-store.js";

const PROVIDERS = ["anthropic", "openai", "gemini", "bedrock"] as const;
type Provider = (typeof PROVIDERS)[number];

const storeName = (provider: Provider) => (provider === "bedrock" ? "live.bedrock.token" : `live.${provider}.key`);

const USAGE = `Usage: live-keys set <${PROVIDERS.join("|")}>   (key on stdin)
       live-keys clear <${PROVIDERS.join("|")}>
       live-keys list`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function providerArg(value: string | undefined): Provider {
  if (!PROVIDERS.includes(value as Provider)) fail(USAGE);
  return value as Provider;
}

/** One line from stdin. On a terminal, raw mode with no echo; otherwise the first line of the piped input. */
async function readKey(provider: Provider): Promise<string> {
  const { stdin, stderr } = process;
  if (stdin.isTTY) {
    stderr.write(`${provider} key (not shown), then Enter: `);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    return new Promise<string>((resolve, reject) => {
      let value = "";
      const finish = (done: () => void) => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stderr.write("\n");
        done();
      };
      const onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === "\r" || char === "\n") return finish(() => resolve(value));
          if (char === "\u0003") return finish(() => reject(new Error("cancelled")));
          if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
          else value += char;
        }
      };
      stdin.on("data", onData);
    });
  }
  let text = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) text += chunk;
  return text.split(/\r?\n/)[0] ?? "";
}

async function main(): Promise<void> {
  const [command, name] = process.argv.slice(2);
  const dir = configDir();
  if (command === "set") {
    const provider = providerArg(name);
    const value = (await readKey(provider)).trim();
    if (!value) fail("No key given; nothing saved.");
    await writeSecrets(dir, { [storeName(provider)]: value });
    console.log(`Saved the ${provider} test key (${storeName(provider)}) in ${dir}.`);
  } else if (command === "clear") {
    const provider = providerArg(name);
    await writeSecrets(dir, { [storeName(provider)]: null });
    console.log(`Cleared ${storeName(provider)}.`);
  } else if (command === "list") {
    const { values, problem } = await readSecrets(dir);
    for (const provider of PROVIDERS) console.log(`${provider.padEnd(10)} ${values[storeName(provider)] ? "set" : "not set"}  (${storeName(provider)})`);
    if (problem) console.error(problem);
  } else {
    fail(USAGE);
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
