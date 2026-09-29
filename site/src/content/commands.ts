import { site } from "@/lib/site";

/**
 * The commands that pull, start and run Run Hound (docker pull, docker run, their Podman forms and the lab's
 * downloads), written once. Pages, MDX, llms-full.txt and the homepage read them here, and no other file writes a
 * `docker` or `podman` pull or run command or a `curl -fsSLO` or `curl -fsSL` download (commands.test.ts), so a flag,
 * the image or the compose file's address can't differ from one page to the next. A sentence may still name a command
 * ("write each `docker run` on one line"). The lab's other compose commands (up, ps, down, run) are here too, but pages
 * that predate this module still write some in their text until they are rewritten. Commands are never translated.
 *
 * The main way to run Run Hound (README.md "Quick start", docs/install.md): the web UI on http://localhost:4000,
 * reports in ./runs, apps on your machine reached as http://host.docker.internal:<port>. The image sets
 * RUNHOUND_ALLOWED_HOSTS (host.docker.internal,host.containers.internal) and RUNHOUND_CONFIG_DIR
 * (/repo/app/runs/.config) itself, and its entrypoint prints the address to open; -e still overrides either. Podman: the
 * same with `podman`.
 *
 * Server-only, like every content module: a client component (a Copy button) gets its command as a prop.
 */

/**
 * A terminal block, the CodeBlock primitive's data (§2.5; components/primitives/copy.ts CodeBlockData, which
 * commands.test.ts checks every block against): Copy copies `commands` only, never the comment or the output.
 */
export type ShellBlock = {
  /** The commands, one per entry; a long one continues on the next line after " \", as a terminal accepts it. */
  readonly commands: readonly string[];
  /** Real output the block prints, shown dim and never copied: lines from the code or from a captured run. */
  readonly output?: readonly string[];
  /** One line shown before the commands, without the "# " the block draws; never copied. */
  readonly comment?: string;
};

/** A command with a comment beside it, the comment starting at `column` so a block's comments line up. */
const noted = (command: string, column: number, comment: string) => `${command.padEnd(column)}# ${comment}`;

// Run Hound's image without a tag, i.e. `latest`: the main pull-and-run commands use it, so they never go stale.
const image = site.imageName;
// The web UI published on 127.0.0.1 only, on the port the image serves on (app/Dockerfile CMD: 4000), and
// host.docker.internal added on Linux (Docker Desktop defines it itself).
const runFlags = "--rm --init -p 127.0.0.1:4000:4000 --add-host host.docker.internal:host-gateway";
// Reports land in ./runs on your machine: the image writes them to /repo/app/runs (app/docker-entrypoint.sh).
const runsMount = `-v "$PWD/runs:/repo/app/runs"`;
const pull = `docker pull ${image}`;
const mkdirRuns = "mkdir -p runs";
/** The web UI, on two lines as a terminal block shows it. */
const runUi = `docker run ${runFlags} \\\n  ${runsMount} ${image}`;

// The test lab: one compose file, downloaded from the latest GitHub Release (site.composeFileUrl), starts Run Hound,
// Kennel, Fernway and the sample apps from the published images.
const composeFile = "run-hound.compose.yml";
const download = `curl -fsSLO ${site.composeFileUrl}`;
const labUp = `docker compose -f ${composeFile} up`;
const podmanLabUp = `podman compose -f ${composeFile} up`;
const labPs = `docker compose -f ${composeFile} ps`;
const labDown = `docker compose -f ${composeFile} down`;
// The documented settings file for the compose file, from the same latest release.
const envDownload = `curl -fsSL ${site.envFileUrl} -o .env`;
const envComment = "optional: host ports, KENNEL_BUGS, FERNWAY_BUGS, allowed hosts, AI, test accounts (every one has a default)";

// The command line in a container, against an app on your machine: Docker Desktop, or Linux with --add-host.
const hostRun = `docker run --rm --init --add-host host.docker.internal:host-gateway ${runsMount} \\\n  ${image} run http://host.docker.internal:5173/signup --approve all`;
// Linux: share the host's network instead, so localhost is your machine and nothing in the app changes.
const hostNetwork = `docker run --rm --init --network host ${runsMount} ${image}`;
const hostNetworkRun = `${hostNetwork} \\\n  run http://localhost:5173/signup --approve all`;
const hostNetworkUi = `${hostNetwork} \\\n  serve --host 127.0.0.1 --port 4310`;
const hostNetworkUiComment = "the web UI on the host network, bound to loopback only";
// The same run in the test lab, in the folder with the compose file.
const labRun = `docker compose -f ${composeFile} run --rm run-hound run http://host.docker.internal:5173/signup --approve all`;

// From source (to contribute, or to watch the browser in a window).
const gitClone = `git clone ${site.github}.git`;
const cdRepo = "cd run-hound";
const clone = `${gitClone}\n${cdRepo}`;
const playwright = "pnpm --filter run-hound exec playwright install chromium";

/** Pull and run as the quick start shows it: three commands, and what the image prints. */
const runBlock: ShellBlock = {
  commands: [pull, mkdirRuns, runUi],
  // What a plain docker run prints (no RUNHOUND_PUBLIC_URL; the image serves on 0.0.0.0:4000, app/Dockerfile CMD):
  // app/docker-entrypoint.sh's line, then serve's warning for an address that isn't loopback and its address
  // (app/src/cli.ts). The 0.0.0.0 address is inside the container; -p publishes it on 127.0.0.1 only.
  output: [
    "Run Hound UI: open http://localhost:4000 in your browser (or the host port you published with -p). The 0.0.0.0 address below is inside the container.",
    "run-hound: warning: serving on 0.0.0.0, not just localhost. Anyone who can reach this address can start runs.",
    "Run Hound listening on http://0.0.0.0:4000",
  ],
};

/** A command that continues on the next line, on one line (PowerShell doesn't continue lines with "\"). */
const joined = (command: string) => command.replace(/ \\\n\s*/g, " ");

/** A block's commands on one line, joined with &&, for a one-line Copy. */
const oneLine = (block: ShellBlock) => block.commands.map(joined).join(" && ");

const labBlock: ShellBlock = { commands: [download, mkdirRuns, labUp] };

/** One run from the command line against an app on your machine: Docker Desktop, or Linux with --add-host. */
const hostRunBlock: ShellBlock = { commands: [hostRun] };

/** Windows PowerShell's curl: in Windows PowerShell 5.1, `curl` is Invoke-WebRequest, which rejects these options. */
const curlExe = (command: string) => command.replace(/^curl /, "curl.exe ");

export const commands = {
  /** Pull and run on one line, for a Copy button: the homepage's hero and Start band (was site.dockerCommand). */
  pullAndRun: oneLine(runBlock),
  /** The test lab on one line, for a Copy button (was site.labCommand). */
  lab: oneLine(labBlock),
  /** The image's version, in a sentence (what a bug report asks for). */
  version: `docker run --rm ${site.image} --version`,
  /** The AI settings as the image sees them, in a sentence. */
  aiStatus: `docker run --rm --network host ${image} ai status`,

  /**
   * Terminal blocks with Copy, for the redesigned pages (§2.5 CodeBlock; §3.5 Quick start, Install, The test lab, Test
   * your app, CLI and CI). Each copies commands only: a note a reader needs is the block's comment or the page's text.
   */
  blocks: {
    /** Pull and run: the quick start's three commands, with what the image prints as output. */
    run: runBlock,
    /** The test lab, from an empty folder. */
    lab: labBlock,
    /** The test lab with Podman. */
    podmanLab: { commands: [download, mkdirRuns, podmanLabUp] },
    /** Pull and run with Podman: the same image and flags (README.md: "Podman: the same with podman"). */
    podmanRun: { commands: runBlock.commands.map((c) => c.replace(/^docker /, "podman ")) },
    /** One run from the command line against an app on your machine, as CI runs it: exit 1 on a confirmed finding. */
    ciRun: hostRunBlock,
    /** The same run, for Test your app: Docker Desktop, or Linux with --add-host. */
    hostRun: hostRunBlock,
    /** The same run in the test lab. */
    labRun: { commands: [labRun], comment: `in the folder with ${composeFile}` },
    /** Linux: one run on the host network, so localhost is your machine. */
    hostNetworkRun: { commands: [mkdirRuns, hostNetworkRun] },
    /** Linux: the web UI on the host network. */
    hostNetworkUi: { commands: [hostNetworkUi], comment: hostNetworkUiComment },
    /** The lab's optional settings file. */
    labEnv: { commands: [envDownload], comment: envComment },
    /** The lab's services and their health. */
    labStatus: { commands: [labPs], comment: "each service and its health" },
    /** Stopping the lab: a block of its own, so copying the status never stops it. */
    labStop: { commands: [labDown], comment: "stop: Ctrl+C, then" },
    /**
     * Windows PowerShell (docs/install.md): each docker run on one line, `mkdir runs` for `mkdir -p runs`, and curl.exe
     * for curl (in Windows PowerShell 5.1, curl is Invoke-WebRequest).
     */
    windowsRun: { commands: [pull, "mkdir runs", joined(runUi)] },
    windowsLab: { commands: [curlExe(download), "mkdir runs", labUp] },
    /** Test your app on Windows: the command-line run on one line. */
    windowsHostRun: { commands: [joined(hostRun)] },
    /** The lab's optional settings file, with curl.exe. */
    windowsLabEnv: { commands: [curlExe(envDownload)] },
    /** From source: clone, install, the browser, then the web UI on http://localhost:4000. */
    source: {
      commands: [gitClone, cdRepo, "pnpm install", playwright, "pnpm serve"],
      comment: "once, if pnpm isn't installed: corepack enable",
    },
  },

  /**
   * The blocks today's pages show, as they show them, comments included. Each goes when its page is rewritten on the
   * blocks above (the docs split, How it works, Demo, AI-built apps and the homepage).
   */
  text: {
    /** Pull and run, three commands (was site.runCommands): the docs, "Start now", AI-built apps, llms-full.txt. */
    run: `${pull}\n${noted(mkdirRuns, 33, "reports land in ./runs")}\n${runUi}`,
    /** The test lab, from an empty folder (the docs' quick start). */
    lab: [
      download,
      noted(mkdirRuns, 36, "reports land here; create it yourself so the files belong to you"),
      noted(labUp, 45, `or: ${podmanLabUp}`),
    ].join("\n"),
    /** The test lab (the "Start now" block). */
    labStart: [download, noted(mkdirRuns, 33, "reports land in ./runs"), labUp, `# Podman: ${podmanLabUp}`].join("\n"),
    /** The test lab with the first targets to enter (Demo). */
    labDemo: [
      download,
      mkdirRuns,
      noted(labUp, 45, `or: ${podmanLabUp}`),
      "",
      "# then open http://localhost:4000 and enter http://kennel:3000/book",
      "# or Fernway, with its planted bugs: http://fernway-bugs:4110/",
    ].join("\n"),
    /** The lab's optional settings file. */
    labEnv: `# ${envComment}\n${envDownload}`,
    /** Checking and stopping the lab. */
    labStatus: [noted(labPs, 47, "each service and its health"), "# stop: Ctrl+C, then", labDown].join("\n"),
    /** Linux: one run on the host network (AI-built apps). */
    hostNetwork: `${mkdirRuns}\n${hostNetworkRun}`,
    /** Linux: one run, then the web UI, on the host network (the docs). */
    hostNetworkWithUi: `${mkdirRuns}\n${hostNetworkRun}\n\n# ${hostNetworkUiComment}\n${hostNetworkUi}`,
    /** Docker Desktop, or Linux with --add-host: one run, and the same in the test lab (the docs). */
    hostRun: `${hostRun}\n\n# the same in the test lab, in the folder with ${composeFile}\n${labRun}`,
    /** From source, to try it (the "Start now" block). */
    sourceStart: [
      clone,
      noted("corepack enable", 33, "once, if pnpm isn't installed"),
      "pnpm install",
      playwright,
      noted("pnpm serve", 33, "web UI on http://localhost:4000"),
    ].join("\n"),
    /** From source, with the Kennel demo built (the docs). */
    sourceInstall: [
      clone,
      noted("corepack enable", 36, "once, if pnpm isn't installed"),
      "pnpm install",
      playwright,
      noted("pnpm --filter kennel build", 36, "only needed for the Kennel demo"),
    ].join("\n"),
  },
} as const;
