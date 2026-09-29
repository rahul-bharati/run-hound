// content/commands.ts: the commands that pull, start and run Run Hound, and the lab's downloads, are written there once,
// so a flag, the image or the compose file's address can't differ from one page to the next (inventory: install and lab
// commands were defined in 4 places). `pnpm test` (node:test, scripts/test-hooks.mjs).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";
import type { CodeBlockData } from "@/components/primitives/copy";
import { commands, type ShellBlock } from "@/content/commands";
import { site } from "@/lib/site";
import { sourceFiles } from "../../scripts/lib/build-output.mjs";

const siteDir = new URL("../../", import.meta.url).pathname;
const srcDir = join(siteDir, "src");
const repo = join(siteDir, "..");
const own = join(srcDir, "content", "commands.ts");

/**
 * A command, not its name: `docker pull` or `docker run` followed by what it pulls or runs, the same with `podman`, or a
 * download with `curl -fsSLO` or `curl -fsSL` (`curl.exe` on Windows). A sentence may still name a command ("write each
 * <code>docker run</code> on one line", "<code>podman run …</code>").
 */
const command = /\bdocker\s+(?:pull|run)\s+\S|\bpodman\s+(?:pull|run)\s+[^\s…]|\bcurl(?:\.exe)?\s+-fsSLO?\b/;

/** A comment's line breaks, so a line number still points at its line. */
const keepLines = (comment: string) => comment.replace(/[^\n]/g, "");

/** The code without its comments: a comment that shows a command is not a command the site shows. */
const withoutComments = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, keepLines)
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, keepLines)
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");

/** Each line of a file that writes a command, as "file:line: text". */
function commandsIn(file: string): string[] {
  const lines = withoutComments(readFileSync(file, "utf8")).split("\n");
  return lines.flatMap((line, i) => (command.test(line) ? [`${relative(srcDir, file)}:${i + 1}: ${line.trim()}`] : []));
}

describe("the commands that pull, start and run Run Hound, and the lab's downloads, are written once, in content/commands.ts", () => {
  test("no other file in src/ writes a docker or podman pull or run command, or a curl download (MDX and Markdown included)", () => {
    const files = sourceFiles(srcDir, ["ts", "tsx", "md", "mdx"]).filter((file) => file !== own);
    assert.ok(files.length > 50, `found ${files.length} source files; has the walk stopped matching?`);
    assert.deepEqual(files.flatMap(commandsIn), []);
  });

  test("content/commands.ts is where they are", () => {
    assert.ok(commandsIn(own).length >= 3, "commands.ts writes the pull, the run and the download");
  });

  test("the pattern finds a command and lets a sentence name one", () => {
    const found = (text: string) => command.test(withoutComments(text));
    assert.ok(found("const x = `docker pull ${site.imageName}`;"));
    assert.ok(found('<code>docker run --rm {site.image} --version</code>'));
    assert.ok(found("curl -fsSLO https://example.test/run-hound.compose.yml"));
    assert.ok(found("curl.exe -fsSLO https://example.test/run-hound.compose.yml"));
    assert.ok(found("curl -fsSL https://example.test/.env.example -o .env"));
    assert.ok(found("podman run --rm --init -p 127.0.0.1:4000:4000 ghcr.io/rahul-bharati/run-hound"));
    assert.ok(found("<code>podman pull ghcr.io/rahul-bharati/run-hound</code>"));
    assert.ok(found("```sh\ndocker run --rm --init ghcr.io/rahul-bharati/run-hound\n```"));
    assert.ok(!found("write each <code>docker run</code> on one line"));
    assert.ok(!found("To update, <code>docker pull</code> again."));
    assert.ok(!found("Podman works the same (podman pull, podman run)."));
    assert.ok(!found("Podman works the same (<code>podman pull …</code>, <code>podman run …</code>)."));
    assert.ok(!found("// the same as `docker run --rm image`, from a comment"));
  });
});

/** The commands a block runs, one per entry, with a continued line joined back into one. */
const runs = (block: ShellBlock) => block.commands.map((c) => c.replace(/ \\\n\s*/g, " "));

describe("the commands", () => {
  test("a copied block holds commands only: no prompt, no comment, no blank entry", () => {
    for (const [name, block] of Object.entries(commands.blocks) as [string, ShellBlock][]) {
      assert.ok(block.commands.length > 0, name);
      for (const c of block.commands) {
        assert.doesNotMatch(c, /^\s*(?:\$|#)/, `${name}: "${c}" starts with a prompt or a comment`);
        assert.doesNotMatch(c, /\s#\s/, `${name}: "${c}" carries a comment`);
        assert.ok(c.trim() === c && c.length > 0, `${name}: "${c}"`);
      }
    }
  });

  test("pull and run on one line runs what the quick start's three commands run", () => {
    assert.equal(commands.pullAndRun, runs(commands.blocks.run).join(" && "));
  });

  test("the test lab on one line runs what its block runs", () => {
    assert.equal(commands.lab, runs(commands.blocks.lab).join(" && "));
  });

  test("the image is the published one, without a tag (latest), so the commands never go stale", () => {
    assert.equal(site.imageName, "ghcr.io/rahul-bharati/run-hound");
    assert.match(commands.pullAndRun, new RegExp(`^docker pull ${site.imageName} && `));
    assert.ok(commands.pullAndRun.endsWith(` ${site.imageName}`));
  });

  test("the web UI is published on 127.0.0.1 only, at the port the image serves on (app/Dockerfile CMD)", () => {
    const dockerfile = readFileSync(join(repo, "app", "Dockerfile"), "utf8");
    const port = dockerfile.match(/^CMD \[[^\]]*"--port",\s*"(\d+)"/m)?.[1];
    assert.ok(port, "app/Dockerfile's CMD names the port");
    assert.match(commands.pullAndRun, new RegExp(` -p 127\\.0\\.0\\.1:${port}:${port} `));
    assert.doesNotMatch(commands.pullAndRun, /-p \d+:\d+/, "never on every interface");
  });

  test("reports land in ./runs, the folder the image writes them to (app/docker-entrypoint.sh RUNS)", () => {
    const entrypoint = readFileSync(join(repo, "app", "docker-entrypoint.sh"), "utf8");
    const runsDir = entrypoint.match(/^RUNS=(\S+)$/m)?.[1];
    assert.ok(runsDir, "the entrypoint names its runs folder");
    assert.ok(commands.pullAndRun.includes(`-v "$PWD/runs:${runsDir}"`));
  });

  test("the quick start's output is what a plain docker run prints: the entrypoint's log line, then the server's two", () => {
    const entrypoint = readFileSync(join(repo, "app", "docker-entrypoint.sh"), "utf8");
    const dockerfile = readFileSync(join(repo, "app", "Dockerfile"), "utf8");
    const cli = readFileSync(join(repo, "app", "src", "cli.ts"), "utf8");
    const port = dockerfile.match(/^CMD \[[^\]]*"--port",\s*"(\d+)"/m)?.[1];
    const host = dockerfile.match(/^CMD \[[^\]]*"--host",\s*"([^"]+)"/m)?.[1];
    // The line it prints when RUNHOUND_PUBLIC_URL is unset, as it is in a plain docker run (only the compose files set it).
    const echo = entrypoint.match(/echo "(Run Hound UI: open http:\/\/localhost:\$port [^"]*)"/)?.[1];
    // serve's warning for a host other than loopback (the image binds 0.0.0.0 inside the container), then its address.
    const warning = cli.match(/`(run-hound: warning: serving on \$\{values\.host\}, [^`]*?)\\n`/)?.[1];
    const listening = cli.match(/`(Run Hound listening on http:\/\/\$\{host\}:\$\{info\.port\})\\n`/)?.[1];
    assert.ok(port && host && echo && warning && listening, "the entrypoint's line, serve's two lines and the image's host and port");
    assert.ok(!/^(127\.|localhost$)/.test(host), "the image serves on an address that isn't loopback, so serve warns");
    assert.deepEqual(commands.blocks.run.output, [
      echo.replace("$port", port),
      warning.replace("${values.host}", host),
      listening.replace("${host}", host).replace("${info.port}", port),
    ]);
    // "The 0.0.0.0 address below": the line after it names that address.
    assert.match(commands.blocks.run.output?.[0] ?? "", new RegExp(`The ${host.replace(/\./g, "\\.")} address below`));
  });

  test("the test lab's compose file comes from the latest GitHub Release and is a file of the repository", () => {
    assert.equal(site.composeFileUrl, "https://github.com/rahul-bharati/run-hound/releases/latest/download/run-hound.compose.yml");
    assert.ok(commands.lab.startsWith(`curl -fsSLO ${site.composeFileUrl} && `));
    assert.ok(existsSync(join(repo, "run-hound.compose.yml")));
    assert.ok(existsSync(join(repo, ".env.example")), "the settings file the lab's .env starts from");
  });

  test("the command-line run for CI uses the image's own entrypoint command and --approve all", () => {
    const [ci] = runs(commands.blocks.ciRun);
    assert.match(ci, new RegExp(`^docker run --rm --init .* ${site.imageName} run http://host\\.docker\\.internal:\\d+/\\S+ --approve all$`));
  });
});

/** Every block, as the CodeBlock primitive takes it: a block that isn't CodeBlockData fails the type check (next build). */
const asCodeBlocks: Readonly<Record<string, CodeBlockData>> = commands.blocks;

describe("the terminal blocks (CodeBlock data, §2.5)", () => {
  test("each holds only what a CodeBlock takes: commands, output and a comment", () => {
    for (const [name, block] of Object.entries(asCodeBlocks)) {
      assert.deepEqual(Object.keys(block).filter((key) => !["commands", "output", "comment"].includes(key)), [], name);
    }
  });

  test("a comment is one line of words, without the '# ' the block draws before it", () => {
    const withComment = Object.entries(asCodeBlocks).filter(([, block]) => block.comment !== undefined);
    assert.ok(withComment.length >= 3, "the host-network UI, the lab's settings file and its status have one");
    for (const [name, block] of withComment) {
      const comment = block.comment ?? "";
      assert.ok(comment.length > 0 && comment.trim() === comment && !comment.includes("\n"), `${name}: "${comment}"`);
      assert.doesNotMatch(comment, /^#/, name);
    }
  });

  test("the docs pages get a block for every command they show (§3.5: Install, The test lab, Test your app, CLI and CI)", () => {
    assert.deepEqual(Object.keys(commands.blocks).sort(), [
      "ciRun",
      "hostNetworkRun",
      "hostNetworkUi",
      "hostRun",
      "lab",
      "labEnv",
      "labRun",
      "labStatus",
      "labStop",
      "podmanLab",
      "podmanRun",
      "run",
      "source",
      "windowsHostRun",
      "windowsLab",
      "windowsLabEnv",
      "windowsRun",
    ]);
  });

  test("one run from the command line: Docker Desktop, or Linux with --add-host, and the same for CI", () => {
    const [run] = runs(commands.blocks.hostRun);
    assert.deepEqual(commands.blocks.hostRun.commands, commands.blocks.ciRun.commands);
    assert.ok(run.includes("--add-host host.docker.internal:host-gateway"));
    assert.ok(run.includes(`-v "$PWD/runs:/repo/app/runs"`));
  });

  test("Linux on the host network: localhost is your machine, and the web UI is bound to loopback only", () => {
    const [mkdir, run] = runs(commands.blocks.hostNetworkRun);
    assert.equal(mkdir, "mkdir -p runs");
    assert.match(run, new RegExp(`^docker run --rm --init --network host -v "\\$PWD/runs:/repo/app/runs" ${site.imageName} run http://localhost:\\d+/\\S+ --approve all$`));
    const [ui] = runs(commands.blocks.hostNetworkUi);
    assert.match(ui, new RegExp(`^docker run --rm --init --network host .* ${site.imageName} serve --host 127\\.0\\.0\\.1 --port \\d+$`));
    assert.doesNotMatch(ui, /-p /, "the host network publishes nothing: the UI is on the host's loopback");
  });

  test("the run inside the test lab uses the lab's compose file and its run-hound service", () => {
    const [run] = runs(commands.blocks.labRun);
    const compose = readFileSync(join(repo, "run-hound.compose.yml"), "utf8");
    assert.match(compose, /^ {2}run-hound:\s*$/m, "the compose file's run-hound service");
    assert.match(run, /^docker compose -f run-hound\.compose\.yml run --rm run-hound run http:\/\/host\.docker\.internal:\d+\/\S+ --approve all$/);
    assert.ok(commands.lab.includes("run-hound.compose.yml"));
  });

  test("the lab's settings file comes from the same release as its compose file", () => {
    assert.deepEqual(commands.blocks.labEnv.commands, [`curl -fsSL ${site.envFileUrl} -o .env`]);
    assert.equal(site.envFileUrl, site.composeFileUrl.replace("run-hound.compose.yml", "run-hound.env.example"));
  });

  test("checking the lab never stops it: the status and the stop are separate blocks", () => {
    assert.deepEqual(runs(commands.blocks.labStatus), ["docker compose -f run-hound.compose.yml ps"]);
    assert.deepEqual(runs(commands.blocks.labStop), ["docker compose -f run-hound.compose.yml down"]);
  });

  test("Podman runs the same lab with podman compose", () => {
    const lab = runs(commands.blocks.lab);
    assert.deepEqual(runs(commands.blocks.podmanLab), [...lab.slice(0, -1), lab.at(-1)?.replace(/^docker compose /, "podman compose ")]);
  });

  test("Podman pulls and runs the same image with the same flags: podman for docker (README.md, docs/install.md)", () => {
    const run = commands.blocks.run.commands;
    assert.deepEqual(commands.blocks.podmanRun.commands, run.map((c) => c.replace(/^docker /, "podman ")));
    assert.deepEqual(runs(commands.blocks.podmanRun).filter((c) => /^docker /.test(c)), [], "no docker left");
    assert.equal(runs(commands.blocks.podmanRun).filter((c) => /^podman (?:pull|run) /.test(c)).length, 2, "the pull and the run");
  });

  test("Windows PowerShell: each docker run on one line, mkdir runs, and curl.exe for downloads (docs/install.md)", () => {
    const [pull, mkdir, run] = runs(commands.blocks.run);
    assert.equal(mkdir, "mkdir -p runs");
    assert.deepEqual(commands.blocks.windowsRun.commands, [pull, "mkdir runs", run]);
    const [download, , up] = runs(commands.blocks.lab);
    assert.deepEqual(commands.blocks.windowsLab.commands, [download.replace(/^curl /, "curl.exe "), "mkdir runs", up]);
    // Test your app's Windows section: the same run on one line.
    assert.deepEqual(commands.blocks.windowsHostRun.commands, runs(commands.blocks.hostRun));
    // The lab's settings file, with curl.exe.
    assert.deepEqual(commands.blocks.windowsLabEnv.commands, runs(commands.blocks.labEnv).map((c) => c.replace(/^curl /, "curl.exe ")));
    const windows = [commands.blocks.windowsRun, commands.blocks.windowsLab, commands.blocks.windowsHostRun, commands.blocks.windowsLabEnv];
    for (const c of windows.flatMap((block) => block.commands)) {
      assert.ok(!c.includes("\\\n"), `"${c}" continues on a second line, which PowerShell doesn't`);
      assert.doesNotMatch(c, /^curl /, `"${c}": in Windows PowerShell 5.1, curl is Invoke-WebRequest`);
      assert.doesNotMatch(c, /^mkdir -p /, `"${c}": PowerShell's mkdir has no -p`);
    }
  });

  test("from source: clone, install, the browser and the web UI, with the repository's own address", () => {
    const [clone, cd, ...rest] = commands.blocks.source.commands;
    assert.equal(clone, `git clone ${site.github}.git`);
    assert.equal(cd, "cd run-hound");
    assert.deepEqual(rest, ["pnpm install", "pnpm --filter run-hound exec playwright install chromium", "pnpm serve"]);
    assert.match(commands.blocks.source.comment ?? "", /corepack enable/);
  });
});
