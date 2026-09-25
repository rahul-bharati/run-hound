import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { aiFlowCheck, previewGroups } from "@/components/checks/data";
import { Callout } from "@/components/docs/callout";
import { CodeBlock } from "@/components/docs/code-block";
import { DocSection } from "@/components/docs/doc-section";
import { DocsToc } from "@/components/docs/toc";
import { SeverityLabel, type Severity } from "@/components/finding";
import { Container, NewTag, PageHeader } from "@/components/layout";
import { aiScreens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { site } from "@/lib/site";

const checkTotal = previewGroups.reduce((sum, g) => sum + g.checks.length, 0);

export const metadata: Metadata = {
  title: "Docs: V1 guide",
  description: `Run Hound V1 (${site.version}) guide: a Docker or Podman quick start with Kennel and sample apps, single-container and host-network runs, the install from source, testing your own page, optional AI with your own model, reading the report, the ${checkTotal} checks, safety and sending feedback.`,
};

const toc = [
  { id: "overview", label: "What V1 does" },
  { id: "quick-start", label: "Quick start" },
  { id: "requirements", label: "Requirements" },
  { id: "install", label: "From source" },
  { id: "kennel", label: "Try it on Kennel" },
  { id: "your-app", label: "Test your own app" },
  { id: "problems", label: "Common problems" },
  { id: "ai", label: "AI (optional)" },
  { id: "report", label: "Reading the report" },
  { id: "checks", label: `The ${checkTotal} checks` },
  { id: "safety", label: "Safety and test records" },
  { id: "limitations", label: "Known limitations" },
  { id: "feedback", label: "Sending feedback" },
];


const severities: { level: Severity; meaning: string }[] = [
  { level: "critical", meaning: "Data or money is at risk right now, for example a secret key shipped to every visitor." },
  { level: "high", meaning: "A core flow is broken or a group of people cannot use it, for example a form that fails silently." },
  { level: "medium", meaning: "Real harm in some situations, for example an error message that isn't announced." },
  { level: "low", meaning: "Worth fixing when you are nearby; rarely blocks anyone." },
];

const localInstall = `git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
corepack enable                     # once, if pnpm isn't installed
pnpm install
pnpm --filter run-hound exec playwright install chromium
pnpm --filter kennel build          # only needed for the Kennel demo`;

const quickStart = `curl -fsSLO ${site.composeFileUrl}
mkdir -p runs                       # reports land here; create it yourself so the files belong to you
docker compose -f run-hound.compose.yml up   # or: podman compose -f run-hound.compose.yml up`;

const envFile = `# optional: host ports, KENNEL_BUGS, allowed hosts, AI settings (every one has a default)
curl -fsSL https://raw.githubusercontent.com/rahul-bharati/run-hound/main/.env.example -o .env`;

const singleContainer = `mkdir -p runs
docker run --rm --init -p 127.0.0.1:4000:4000 \\
  --add-host host.docker.internal:host-gateway -e RUNHOUND_ALLOWED_HOSTS=host.docker.internal \\
  -e RUNHOUND_CONFIG_DIR=/repo/app/runs/.config \\
  -v "$PWD/runs:/repo/app/runs" ${site.image}`;

const testApps: { name: string; body: string }[] = [
  {
    name: "Kennel",
    body: "Our deliberately broken pet-sitting booking app, with every planted bug on (KENNEL_BUGS in .env). Target: http://kennel:3000/book.",
  },
  { name: "Kennel (clean)", body: "The same app in clean mode: every check should pass. Target: http://kennel-clean:3000/book." },
  { name: "classic-post", body: "A server-rendered sign-up form with no JavaScript that posts and redirects. Target: http://classic-post:4101/signup." },
  { name: "spa-fetch", body: "A contact form that saves with fetch and lists what it saved. Target: http://spa-fetch:4102/." },
  { name: "login", body: "An email and password sign-in form with a show-password toggle. Target: http://login:4103/." },
  { name: "cross-origin-api", body: "An RSVP form whose API lives on another origin, allowed through CORS. Target: http://cross-origin-api:4104/." },
  { name: "multi-form", body: "Three forms on one page (header search, contact, footer newsletter) and buttons outside them. Target: http://multi-form:4106/." },
];

const kennelLocal = `# terminal 1: Kennel with every bug on (the analytics port must differ from the app's)
KENNEL_BUGS=all PORT=5310 ANALYTICS_PORT=5311 pnpm kennel

# terminal 2: the web UI
pnpm serve --port 4310`;

const kennelCli = `cd app
pnpm exec tsx src/cli.ts run http://localhost:5310/book --plan-only     # the plan, with scenario ids
pnpm exec tsx src/cli.ts run http://localhost:5310/book --approve all   # run everything
echo $?                                                                 # 1: confirmed findings`;

const ownCli = `cd app
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --plan-only
pnpm exec tsx src/cli.ts run http://localhost:5173/signup --approve all`;

const dockerLinux = `mkdir -p runs
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ${site.image} \\
  run http://localhost:5173/signup --approve all

# the web UI on the host network, bound to loopback only
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ${site.image} \\
  serve --host 127.0.0.1 --port 4310`;

const aiCli = `cd app
pnpm exec tsx src/cli.ts ai status                                         # the effective settings and what's missing
pnpm exec tsx src/cli.ts ai test --ai-provider ollama --ai-model qwen3:8b  # one small call to check the model answers
pnpm exec tsx src/cli.ts run http://localhost:5310/book --ai --ai-provider ollama --ai-model qwen3:8b --plan-only`;

// The docs column: max-w-3xl (768 px) from xl, the viewport minus the gutters and the 220 px contents column on lg.
const docShotSizes =
  "(min-width: 1280px) 768px, (min-width: 1024px) calc(100vw - 428px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

const aiFigures = [
  { screen: aiScreens.settings, caption: "Settings → AI with Ollama on the same machine: the model picked from the server's list and a successful Test connection." },
  { screen: aiScreens.suggested, caption: "Two Suggested by AI flows in a plan: unticked, each with the model's reason and the steps it will take, ending in a check." },
  { screen: aiScreens.explanation, caption: "A finding after the run: the built-in “What to ask your AI”, then the model's AI explanation, labelled advisory." },
];

const aiDocker = `# .env: Ollama on your machine, seen from the container
RUNHOUND_AI=1
RUNHOUND_AI_PROVIDER=ollama
# Docker; Podman: http://host.containers.internal:11434/v1; host network on Linux: http://127.0.0.1:11434/v1
RUNHOUND_AI_BASE_URL=http://host.docker.internal:11434/v1
RUNHOUND_AI_MODEL=qwen3:8b`;

const dockerDesktop = `# in the folder with run-hound.compose.yml (quick start)
docker compose -f run-hound.compose.yml run --rm run-hound run http://host.docker.internal:5173/signup --approve all`;

const problems: { see: string; means: string }[] = [
  {
    see: "Nothing is answering at http://localhost:<port>",
    means: "Your app isn't running on that port, or Run Hound is in a container (see Docker Desktop above).",
  },
  {
    see: "No form found on …",
    means:
      "The page answered with an error (a 404 from a wrong URL, or a dev server's “Blocked request”), so there is nothing to test. A page that simply has no form gets the page-wide checks instead. Open the URL in your browser and check.",
  },
  {
    see: "Refusing to test …",
    means: "The host isn't local or private. Use localhost; list your own internal host names in RUNHOUND_ALLOWED_HOSTS.",
  },
  { see: "EADDRINUSE", means: "The port is taken. Pick another (--port, PORT, RUNHOUND_HOST_PORT)." },
  {
    see: "manifest unknown, or denied, pulling ghcr.io/rahul-bharati/run-hound…",
    means: "The images aren't published yet: they appear with the v0.3.0 release. Until then, clone the repository and run docker compose up --build.",
  },
  {
    see: "EACCES … mkdir '/repo/app/runs/…'",
    means: "The container can't write to your reports folder. Create it first (mkdir -p runs); on Podman avoid --user.",
  },
  {
    see: "“Looks like you launched a headed browser without having a XServer running”",
    means: "You ticked “Show the browser window” in a container or on a machine without a display. Untick it.",
  },
];

const runFiles: { name: string; body: string }[] = [
  { name: "report.html", body: "Open this one in your browser. The web UI links to it when the run ends." },
  { name: "report.md", body: "The same report as text; the easiest thing to send us." },
  { name: "report.json", body: "Everything, machine-readable, including runHoundVersion." },
  { name: "artifacts/", body: "The evidence images and GIFs." },
  { name: "specs/", body: "A Playwright test per finding that reproduces it without Run Hound." },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow={`DOCS · ${site.release} · ${site.version}`}
        title={
          <>
            Run {site.release} <span className="text-accent">on your machine.</span>
          </>
        }
        lede={`How to run Run Hound ${site.release} on your own machine: start it with the test apps in one command, try it on Kennel, our deliberately broken demo app, point it at a page of your own, and read a report where every finding comes with evidence.`}
      >
        <Callout
          label="Open source"
          title="The repository is public on GitHub."
          className="max-w-3xl"
        >
          <p>
            Anyone can clone it, try it and{" "}
            <a href={site.feedback} className="text-accent underline underline-offset-4 hover:text-accent-strong">
              file an issue
            </a>
            . The full guide is also in the repository as{" "}
            <a href={site.testingGuide} className="text-accent underline underline-offset-4 hover:text-accent-strong">
              TESTING.md
            </a>
            .
          </p>
        </Callout>
      </PageHeader>

      <Container className="pb-24">
        <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <DocsToc items={toc} />

          <div className="flex min-w-0 max-w-3xl flex-col gap-20">
            <DocSection id="overview" step="01" title={`What ${site.release} does`}>
              <div className="prose-night">
                <p>
                  Run Hound {site.release} ({site.releaseName.toLowerCase()}, {site.version}) opens one page of your local
                  app in a headless Chromium and finds <strong>every form and interactive control</strong> on it. It
                  plans the form checks for each form, plus page-wide checks (security headers, cookie flags, CORS,
                  public source maps and controls outside the forms), lets you pick which ones to run, runs them in a
                  real browser, and writes a report with evidence (annotated screenshots, short GIFs, request and
                  response cards) and a Playwright test for each finding.
                </p>
                <p>
                  New since V0 (0.1.0), which tested only the main form: every form on the page is tested, and five
                  new checks look at the page as a whole. See <a href="#checks">the {checkTotal} checks</a>.
                </p>
                <p>
                  New in 0.3.0: <strong>optional AI with your own model</strong>. It reviews the plan, suggests extra
                  flows and explains findings. It is off by default and never decides pass or fail. See{" "}
                  <a href="#ai">AI (optional)</a>.
                </p>
                <p>It doesn&apos;t:</p>
                <ul>
                  <li>follow links to other pages or test a feature across pages (planned for V2);</li>
                  <li>log in: pages behind a login aren&apos;t supported, and a login form can only be partly tested;</li>
                  <li>test public websites: only your own machine and private network addresses;</li>
                  <li>
                    use AI unless you turn it on: with AI off (the default) the plan comes from what Run Hound finds on
                    the page and nothing is sent to any AI provider. With it on, every pass or fail still comes from a
                    real check with evidence;
                  </li>
                  <li>delete the test records it creates (see <a href="#safety">Safety and test records</a>).</li>
                </ul>
                <p>
                  What we most want to learn: <strong>is every finding real, and did it miss a bug you
                  know about?</strong> A wrong finding costs you time, so we treat each false positive as a bug in Run
                  Hound.
                </p>
              </div>
            </DocSection>

            <DocSection id="quick-start" step="02" title="Quick start with Docker or Podman">
              <div className="prose-night">
                <p>
                  One compose file starts Run Hound and a set of local test apps from the published images, so you can
                  try it before pointing it at anything of your own. No clone and no build: you need Docker with Compose,
                  Docker Desktop, or Podman, and an empty folder.
                </p>
              </div>
              <CodeBlock label="Docker or Podman, from an empty folder">{quickStart}</CodeBlock>
              <div className="prose-night">
                <p>
                  The first start downloads about 2 GB of images. When the log says{" "}
                  <code>Run Hound UI: open http://localhost:4000</code>, open that address and enter{" "}
                  <code>http://kennel:3000/book</code> (inside the containers Kennel is called <code>kennel</code>). The
                  log also mentions <code>0.0.0.0:4000</code>: that address is inside the container; on your machine the
                  ports are bound to <code>127.0.0.1</code> only. Reports are written to <code>./runs</code> on your
                  machine. Ports taken, or want to change a setting? Every setting has a default; put your changes in a{" "}
                  <code>.env</code> file next to the compose file, starting from the documented example:
                </p>
              </div>
              <CodeBlock label="Optional settings">{envFile}</CodeBlock>
              <div className="prose-night">
                <p>
                  The images (<code>{site.image}</code>, with <code>run-hound-kennel</code> and{" "}
                  <code>run-hound-samples</code>, for linux/amd64 and arm64) appear on GitHub&apos;s container registry
                  with the v{site.version} release. Until then, clone the repository and run{" "}
                  <code>docker compose up --build</code>: its <code>docker-compose.yml</code> builds the same services
                  from source (see <a href="#install">From source</a>).
                </p>
                <p>These test apps start with it:</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {testApps.map((a) => (
                  <li key={a.name} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-4">
                    <span className="font-mono text-sm text-accent">{a.name}</span>
                    <span className="text-[15px] leading-relaxed text-muted [overflow-wrap:anywhere]">{a.body}</span>
                  </li>
                ))}
              </ul>
              <div className="prose-night">
                <p>
                  Kennel should give findings for its planted bugs. The five sample apps are built correctly on
                  purpose, so <strong>any confirmed finding on them is a false positive</strong>, and worth reporting.
                  Enter these addresses in the Run Hound UI: inside the compose network each app is reached by its service name. Every app is also published on 127.0.0.1 (ports in <code>.env.example</code>).
                </p>
                <h3>Only Run Hound, without the test apps</h3>
                <p>
                  One container, the web UI on <code>http://localhost:4000</code>. The <code>--add-host</code> and{" "}
                  <code>RUNHOUND_ALLOWED_HOSTS</code> flags let it reach apps on your machine as{" "}
                  <code>host.docker.internal</code> (Docker Desktop defines the name itself; this adds it on Linux),
                  and <code>RUNHOUND_CONFIG_DIR</code> keeps the AI settings you save in <code>./runs/.config</code>.
                  Podman works the same (<code>podman run …</code>).
                </p>
              </div>
              <CodeBlock label="Single container">{singleContainer}</CodeBlock>
            </DocSection>

            <DocSection id="requirements" step="03" title="Requirements">
              <div
                role="region"
                aria-labelledby="req-caption"
                tabIndex={0}
                className="overflow-x-auto rounded-2xl border border-line bg-surface"
              >
                <table className="w-full min-w-[34rem] border-collapse text-left text-[15px]">
                  <caption id="req-caption" className="sr-only">
                    Requirements for Docker or Podman and for the install from source
                  </caption>
                  <thead>
                    <tr className="border-b border-line">
                      <td className="px-5 py-3.5" />
                      <th scope="col" className="px-5 py-3.5 font-semibold">
                        Docker or Podman{" "}
                        <span className="font-mono text-[11px] tracking-widest text-accent">QUICKEST START</span>
                      </th>
                      <th scope="col" className="px-5 py-3.5 font-semibold">
                        From source
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-muted">
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">You need</th>
                      <td className="px-5 py-3.5 align-top">
                        Docker 24+ with Compose, Docker Desktop, or Podman with podman-compose, and curl. No clone, no Node
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        Node 22 or newer (24 recommended), pnpm (<code className="font-mono text-fg">corepack enable</code>), git
                      </td>
                    </tr>
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Disk</th>
                      <td className="px-5 py-3.5 align-top">About 2.7 GB (built on Microsoft&apos;s Playwright image)</td>
                      <td className="px-5 py-3.5 align-top">About 1 GB (dependencies and Chromium)</td>
                    </tr>
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Works on</th>
                      <td className="px-5 py-3.5 align-top">Linux, macOS, Windows (amd64 and arm64)</td>
                      <td className="px-5 py-3.5 align-top">Linux and macOS. Windows: use WSL2</td>
                    </tr>
                    <tr>
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Your own app</th>
                      <td className="px-5 py-3.5 align-top">
                        Linux: host network, same as local. Mac and Windows: a few dev-server settings
                      </td>
                      <td className="px-5 py-3.5 align-top">Just enter http://localhost:&lt;port&gt;/&lt;page&gt;</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="prose-night">
                <p>
                  <strong>Docker or Podman is the quickest way to try it</strong>: one file, test apps included, nothing
                  to clone. On Linux it tests your own app just as simply, through the host network. On a Mac or
                  Windows, <strong>the install from source</strong> tests your app exactly as your browser sees it, with
                  no networking set-up. And bring an app: a web app running on your machine with a form in it
                  (sign-up, contact, booking, checkout details, settings), or any page with buttons and controls. You don&apos;t need to know Playwright or
                  accessibility rules; the report explains each finding in plain language.
                </p>
              </div>
            </DocSection>

            <DocSection id="install" step="04" title="From source (contributing)">
              <div className="prose-night">
                <p>
                  For contributors, and anyone who would rather run it with Node than in a container. It needs a clone
                  of the repository:
                </p>
              </div>
              <CodeBlock label="From source">{localInstall}</CodeBlock>
              <div className="prose-night">
                <p>
                  On Ubuntu or Debian, if Chromium complains about missing libraries, run{" "}
                  <code>pnpm --filter run-hound exec playwright install --with-deps chromium</code> (it uses sudo). Check
                  it works: <code>cd app &amp;&amp; pnpm exec tsx src/cli.ts --version</code> prints{" "}
                  <code>run-hound {site.version}</code>. In the clone, <code>docker compose up --build</code> builds and
                  starts the same containers as the quick start from your working tree (<code>docker-compose.yml</code>).
                </p>
              </div>
            </DocSection>

            <DocSection id="kennel" step="05" title="Try it on Kennel first">
              <div className="prose-night">
                <p>
                  Kennel is a pet-sitting booking form with planted bugs you can switch on and off. Trying it first
                  shows you what findings, evidence and a clean run look like. It takes about 10 minutes.
                </p>
                <h3>Docker or Podman</h3>
                <p>
                  Start the <a href="#quick-start">quick start</a>: Kennel is already running next to Run Hound. Open{" "}
                  <code>http://localhost:4000</code> and enter <code>http://kennel:3000/book</code> (steps below), or
                  run it from the command line in the same folder:{" "}
                  <code>docker compose -f run-hound.compose.yml run --rm run-hound run http://kennel:3000/book --approve all</code>.
                  In containers the target isn&apos;t localhost, so <code>client-only-validation</code> is skipped and
                  the report says why.
                </p>
                <h3>From source</h3>
                <p>Two terminals, from the root of your clone. The ports are examples; any free ports work.</p>
              </div>
              <CodeBlock label="Start Kennel and the web UI">{kennelLocal}</CodeBlock>
              <div className="prose-night">
                <h3>Then, either way</h3>
                <ol>
                  <li>
                    Open the UI and enter Kennel&apos;s address: <code>http://localhost:4000</code> and{" "}
                    <code>http://kennel:3000/book</code> with Docker, <code>http://localhost:4310</code> and{" "}
                    <code>http://localhost:5310/book</code> from source. Then press <strong>Plan checks</strong>.
                  </li>
                  <li>
                    Read the plan, shown under <strong>Accessibility</strong>, <strong>Features</strong> and{" "}
                    <strong>Security</strong> headings, each with a “Select all” box. Each scenario says what it does
                    and whether it creates test records. Keep them all ticked and press <strong>Start run</strong>.
                    Nothing runs before you do.
                  </li>
                  <li>
                    Watch the live view: the page under test, the current group and scenario, the elapsed time, the
                    current step and a timestamped log. When the run ends, the report replaces the live view.{" "}
                    <strong>Stop run</strong> stops it for real (the rest is marked skipped and a report is still
                    written), and <strong>Back to test plan</strong> plans the same page again.
                  </li>
                  <li>
                    Read the report. You should see findings for most of Kennel&apos;s planted bugs: a button that does
                    nothing, a double submit, a secret key in the bundle, an email sent to the analytics service,
                    missing focus outlines and more. If Kennel runs on a dev server, header, cookie and CORS findings
                    there are marked advisory.
                  </li>
                  <li>
                    From the report, <strong>Re-run</strong> runs the same scenarios on the same page again,{" "}
                    <strong>Open HTML report</strong> and <strong>Download</strong> give you the files, and the{" "}
                    <strong>Runs</strong> page lists every run on this machine, including finished runs read back after
                    a restart.
                  </li>
                  <li>
                    Test the clean Kennel: with Docker enter <code>http://kennel-clean:3000/book</code> (it runs next to
                    the broken one); from source restart Kennel with <code>KENNEL_BUGS=none</code> and run again.{" "}
                    <strong>A clean Kennel should give zero confirmed findings.</strong> If it doesn&apos;t, that&apos;s
                    a bug worth reporting.
                  </li>
                </ol>
                <p>The same from the command line, from source:</p>
              </div>
              <CodeBlock label="Command line, from source">{kennelCli}</CodeBlock>
            </DocSection>

            <DocSection id="your-app" step="06" title="Test your own app">
              <div className="prose-night">
                <ol>
                  <li>
                    Start your app the way you normally develop it, with a <strong>throwaway database</strong>.
                  </li>
                  <li>
                    Find the exact URL of the page you want to test, for example{" "}
                    <code>http://localhost:5173/signup</code>.
                    Use <code>localhost</code>, not <code>0.0.0.0</code>.
                  </li>
                  <li>Run Run Hound on it, then check each finding against your app.</li>
                </ol>
                <h3>Docker on Linux (host network)</h3>
                <p>
                  On Linux the container can share your machine&apos;s network, so <code>localhost</code> means your
                  machine and nothing in your app needs to change. Podman works the same (<code>podman run …</code>).
                  Nothing to clone: this works from any folder.
                </p>
              </div>
              <CodeBlock label="Docker, host network">{dockerLinux}</CodeBlock>
              <div className="prose-night">
                <p>
                  The command prints <code>Report: /repo/app/runs/&lt;runId&gt;/report.html</code>; on your machine
                  that&apos;s <code>./runs/&lt;runId&gt;/report.html</code>.
                </p>
                <h3>Docker Desktop (Mac, Windows) or the compose UI</h3>
                <p>
                  Here <code>localhost</code> inside the container is the container itself, not your machine. Use{" "}
                  <code>host.docker.internal</code> instead (<code>host.containers.internal</code> also works on
                  Podman), and make your dev server accept it:
                </p>
                <ol>
                  <li>
                    <strong>Listen on all interfaces.</strong> Vite: <code>vite --host</code>. Next.js:{" "}
                    <code>next dev</code> already does. Express and Fastify: <code>listen(port, &quot;0.0.0.0&quot;)</code>;
                    Django: <code>runserver 0.0.0.0:8000</code>; Rails: <code>rails s -b 0.0.0.0</code>.
                  </li>
                  <li>
                    <strong>Allow the host name.</strong> Vite:{" "}
                    <code>server: {"{"} allowedHosts: [&quot;host.docker.internal&quot;] {"}"}</code>, or it answers
                    “Blocked request” and Run Hound reports “No form found”. Next.js:{" "}
                    <code>allowedDevOrigins: [&quot;host.docker.internal&quot;]</code>, or the page never becomes
                    interactive. Django: <code>ALLOWED_HOSTS</code>; Rails:{" "}
                    <code>config.hosts &lt;&lt; &quot;host.docker.internal&quot;</code>.
                  </li>
                  <li>
                    Enter <code>http://host.docker.internal:5173/signup</code> in the UI at{" "}
                    <code>http://localhost:4000</code> (the quick start, or the{" "}
                    <a href="#quick-start">single container</a>), or run:
                  </li>
                </ol>
              </div>
              <CodeBlock label="Docker Desktop">{dockerDesktop}</CodeBlock>
              <div className="prose-night">
                <p>
                  Limits of this set-up: a frontend that calls its API at <code>http://localhost:&lt;apiPort&gt;</code>{" "}
                  will call the container instead and fail (use the host network or the install from source);{" "}
                  <code>client-only-validation</code> is skipped for non-localhost targets; and “Show the browser
                  window” doesn&apos;t work in a container.
                </p>
                <h3>From source</h3>
                <p>
                  In your clone. Web UI: <code>pnpm serve --port 4310</code>, open <code>http://localhost:4310</code> and enter your
                  page&apos;s URL. Or the command line:
                </p>
              </div>
              <CodeBlock label="Command line">{ownCli}</CodeBlock>
              <div className="prose-night">
                <p>
                  Options: <code>--approve all|default|&lt;id,id&gt;</code> (default: the recommended scenarios),{" "}
                  <code>--plan-only</code>, <code>--allow-destructive</code>, <code>--headed</code> (a visible browser
                  window), <code>--runs-dir &lt;dir&gt;</code>, <code>--json</code>, and the <code>--ai</code> flags (see{" "}
                  <a href="#ai">AI (optional)</a>). <code>help</code> lists them.
                </p>
              </div>
            </DocSection>

            <DocSection id="problems" step="07" title="Common problems">
              <dl className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line bg-surface">
                {problems.map((p) => (
                  <div key={p.see} className="flex flex-col gap-1.5 px-5 py-4">
                    <dt className="font-mono text-[13px] text-fg [overflow-wrap:anywhere]">{p.see}</dt>
                    <dd className="text-[15px] leading-relaxed text-muted">{p.means}</dd>
                  </div>
                ))}
              </dl>
            </DocSection>

            <DocSection id="ai" step="08" title="AI (optional)">
              <div className="prose-night">
                <p>
                  New in 0.3.0, and <strong>off until you turn it on</strong>. Bring your own model: Ollama, LM Studio,
                  llama.cpp, vLLM, any OpenAI-compatible endpoint, or Amazon Bedrock. It takes on three jobs:
                </p>
                <ul>
                  <li>
                    <strong>Reviews the plan</strong>: recommends and ranks each built-in scenario with a one-line
                    reason. It never ticks a destructive scenario, and adds, removes or reorders nothing.
                  </li>
                  <li>
                    <strong>Suggests extra flows</strong>: up to 5, built only from the fields and buttons Run Hound
                    found, each checked by deterministic assertions (the <code>ai-flow</code> check). They are unticked
                    by default, and their findings are advisory.
                  </li>
                  <li>
                    <strong>Explains findings</strong>: an &ldquo;AI explanation (advisory)&rdquo; and an &ldquo;Ask
                    your AI&rdquo; prompt beside the built-in text.
                  </li>
                </ul>
                <p>
                  It never decides pass or fail, and if the model fails or times out you get the built-in plan with a
                  warning. The easiest start is <a href="https://ollama.com">Ollama</a> on your machine (<code>ollama pull qwen3:8b</code>,
                  or any model you like).
                </p>
                <h3>Web UI</h3>
                <ol>
                  <li>
                    Open <strong>Settings → AI</strong>, turn it on, pick a provider, choose a model from the dropdown
                    (it lists what the server has; <strong>Other…</strong> takes any id), press <strong>Save</strong>,
                    then <strong>Test connection</strong> (it tests the saved settings).
                  </li>
                  <li>
                    Plan a page with <strong>Review with AI</strong> ticked. Planning takes longer (a 9B model on a
                    laptop: about a minute). Each scenario shows the model&apos;s reason; <strong>Suggested by AI</strong>{" "}
                    scenarios show their steps and are unticked: tick the ones that look useful.
                  </li>
                  <li>
                    After the run, findings have an <strong>AI explanation</strong> panel below the built-in one.
                  </li>
                </ol>
              </div>
              <div className="flex flex-col gap-8">
                {aiFigures.map((f) => (
                  <figure key={f.caption} className="flex flex-col gap-3">
                    <Screenshot screen={f.screen} sizes={docShotSizes} />
                    <figcaption className="text-sm leading-relaxed text-muted">{f.caption}</figcaption>
                  </figure>
                ))}
              </div>
              <div className="prose-night">
                <h3>Command line</h3>
                <p>
                  From source, in <code>app/</code>. In a container the same commands follow the image name, for example{" "}
                  <code>docker run --rm --network host {site.image} ai status</code>.
                </p>
              </div>
              <CodeBlock label="Command line, from source">{aiCli}</CodeBlock>
              <div className="prose-night">
                <p>
                  Settings come from the Settings page (saved to <code>~/.config/run-hound/ai.json</code>, mode 0600, or
                  to <code>RUNHOUND_CONFIG_DIR</code> when it is set). <code>RUNHOUND_AI_*</code> environment variables
                  override the saved settings, and <code>--ai*</code> flags override both. The full list is
                  in <code>docs/ai-spec.md</code> and <code>.env.example</code> in the repository.
                </p>
                <h3>Docker or Podman</h3>
                <p>
                  The easiest way is the Settings page: with the quick start, what you save there is kept in{" "}
                  <code>./runs/.config</code> on your machine (for a plain <code>docker run</code>, add{" "}
                  <code>-e RUNHOUND_CONFIG_DIR=/repo/app/runs/.config</code>). Or put the <code>RUNHOUND_AI_*</code>{" "}
                  variables in the <code>.env</code> next to the compose file. The Ollama address depends on how the
                  container reaches your machine: with <code>--network host</code> on Linux it is{" "}
                  <code>http://127.0.0.1:11434/v1</code>; otherwise it is <code>host.docker.internal</code> (Docker) or{" "}
                  <code>host.containers.internal</code> (Podman), and Ollama must listen on all interfaces (
                  <code>OLLAMA_HOST=0.0.0.0 ollama serve</code>).
                </p>
              </div>
              <CodeBlock label=".env">{aiDocker}</CodeBlock>
              <div className="prose-night">
                <h3>What is sent</h3>
                <ul>
                  <li>
                    Only <strong>redacted page structure</strong>: the page title and path, field labels and types,
                    option labels, button names and the scenario list. Explanations also get each finding&apos;s text and
                    facts, without test values. Never typed values, cookies, response bodies or screenshots.
                  </li>
                  <li>
                    A local endpoint (localhost or a private address) needs nothing more. A remote one (OpenAI,
                    OpenRouter, Bedrock, …) is refused until you consent for that host: the Settings checkbox,{" "}
                    <code>--ai-allow-remote</code> or <code>RUNHOUND_AI_ALLOW_REMOTE=1</code>. Without consent nothing
                    is sent, not even a model list request.
                  </li>
                  <li>
                    API keys stay on the server and never appear in the UI or reports, and a saved key is only ever
                    sent to the endpoint it was saved for. Bedrock takes a Bedrock API key, AWS access keys, or an AWS
                    profile from <code>~/.aws</code> (<code>RUNHOUND_AI_AWS_PROFILE</code> or <code>AWS_PROFILE</code>:
                    static keys, <code>credential_process</code> or IAM Identity Center after{" "}
                    <code>aws sso login</code>; assume-role profiles aren&apos;t supported yet).
                  </li>
                </ul>
                <p>
                  Small local models work (tested with a 9B model on Ollama). Ollama is called through its native API
                  with thinking turned off; with other servers, prefer a non-reasoning model or turn reasoning off.
                </p>
              </div>
            </DocSection>

            <DocSection id="report" step="09" title="Reading the report">
              <div className="prose-night">
                <p>
                  Every run writes a folder: <code>./runs/&lt;runId&gt;/</code> for Docker,{" "}
                  <code>app/runs/&lt;runId&gt;/</code> from source. In it:
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {runFiles.map((f) => (
                  <li key={f.name} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-4">
                    <span className="font-mono text-sm text-accent">{f.name}</span>
                    <span className="text-[15px] leading-relaxed text-muted">{f.body}</span>
                  </li>
                ))}
              </ul>
              <div className="prose-night">
                <h3>The summary: groups and timing</h3>
                <p>
                  The report opens with how long the run took (“Finished in 38 s”), findings by severity, confirmed
                  versus advisory, and scenarios passed, failed, errored and skipped. Then a table per group,{" "}
                  <strong>Accessibility</strong>, <strong>Features</strong> and <strong>Security</strong>, with its
                  results, findings and time, and how many test records the run may have created. Every scenario
                  lists how long it took.
                </p>
                <h3>Findings</h3>
                <p>
                  Each finding has a title, its group, a severity, whether it is confirmed or advisory, where on the
                  page it is (every place, when there are several), <em>What this means</em>, <em>Why it matters</em>,{" "}
                  <em>What to ask your AI (or developer) to fix</em>, and the evidence: screenshots with the element
                  boxed and the measured facts, GIFs of flows such as a double click, and cards with the request,
                  response or script line that proves it. When the same problem affects several elements you get one
                  finding that lists every place.
                </p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {severities.map((s) => (
                  <li key={s.level} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                    <SeverityLabel severity={s.level} />
                    <p className="text-[15px] leading-relaxed text-muted">{s.meaning}</p>
                  </li>
                ))}
              </ul>
              <div className="prose-night">
                <h3>Confirmed and advisory</h3>
                <ul>
                  <li>
                    <strong>Confirmed</strong>: decided by a real check (a request was sent twice, axe found a
                    rule violation, a value was missing after reload). These should always be right. If one is
                    wrong, please report it.
                  </li>
                  <li>
                    <strong>Advisory</strong>: relies on judgement, for example a missing <code>autocomplete</code>{" "}
                    hint, or a header, cookie or CORS result on a dev server, which doesn&apos;t send the values your
                    production build will. Worth a look, not a failure.
                  </li>
                </ul>
                <p>
                  The command line exits with <strong>0</strong> when there are no confirmed findings (advisory ones
                  don&apos;t fail the run), <strong>1</strong> when there is at least one confirmed finding, and{" "}
                  <strong>2</strong> on an error: a refused or unreachable target, an error page (such as a 404), or a
                  bad option. That makes it a CI step as it is; <code>--json</code> puts the report on stdout.
                </p>
                <h3>Also in the report</h3>
                <ul>
                  <li>
                    <strong>Scenarios</strong>: every scenario under its group with its result, time and notes, the
                    ones you didn&apos;t approve, and checks that had nothing to test on your page.
                  </li>
                  <li>
                    <strong>Pages tested</strong>: every URL the run loaded. If your URL redirected to a login page, the
                    run tested that page instead.
                  </li>
                  <li>
                    <strong>What a browser can&apos;t see</strong>: backups, webhook signatures and other things no
                    browser test can check, so a clean report isn&apos;t mistaken for a clean app.
                  </li>
                </ul>
                <p>
                  To judge a finding, look at its evidence first, then try it by hand. The exported spec reproduces it
                  without Run Hound: in your project, <code>npm i -D @playwright/test @axe-core/playwright</code>, then{" "}
                  <code>npx playwright test &lt;file&gt;</code>. <Link href="/demo">The demo page</Link> shows real
                  evidence from a Kennel run.
                </p>
              </div>
            </DocSection>

            <DocSection id="checks" step="10" title={`The ${checkTotal} checks`}>
              <div className="prose-night">
                <p>
                  The plan, the run, the progress and the report all follow the same three groups. Form checks are
                  planned once for each form on the page; page-wide checks, including the five new in {site.release},
                  are planned once for the whole page. Scenarios that don&apos;t apply to your page (no form, no password field, no JSON save
                  request) are <strong>skipped with a plain reason</strong>, never silently dropped.
                </p>
                <p>
                  With <a href="#ai">AI</a> on, one more check can run, in the Features group:{" "}
                  <code>{aiFlowCheck.id}</code>. It isn&apos;t counted in the {checkTotal} because it runs only the flows
                  your model suggests and you tick.
                </p>
              </div>
              <div className="flex flex-col gap-8">
                {previewGroups.map((g) => (
                  <section key={g.group} aria-labelledby={`group-${g.group}`} className="flex flex-col gap-3">
                    <h3 id={`group-${g.group}`} className="flex items-baseline gap-3 font-display text-xl font-bold">
                      {g.group}
                      <span className="font-mono text-xs font-normal tracking-widest text-dim">
                        {g.checks.length} CHECKS
                      </span>
                    </h3>
                    <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line bg-surface">
                      {g.checks.map((c) => (
                        <li key={c.id} className="flex flex-col gap-1.5 px-5 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                            <span className="flex flex-wrap items-center gap-2.5">
                              <span className="font-mono text-sm text-accent">{c.id}</span>
                              {c.since === "V1" ? <NewTag /> : null}
                            </span>
                            <span className="font-mono text-[11px] tracking-widest text-dim">
                              TEST RECORDS: {c.records.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[15px] leading-relaxed text-muted">{c.line}</p>
                          {c.devServerAdvisory ? (
                            <p className="text-sm leading-relaxed text-dim">
                              Advisory when the target looks like a dev server.
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                <section aria-labelledby="group-ai" className="flex flex-col gap-3">
                  <h3 id="group-ai" className="flex items-baseline gap-3 font-display text-xl font-bold">
                    Only when AI is on
                    <span className="font-mono text-xs font-normal tracking-widest text-dim">1 CHECK</span>
                  </h3>
                  <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-dashed border-line-strong bg-surface">
                    <li className="flex flex-col gap-1.5 px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                        <span className="font-mono text-sm text-accent">{aiFlowCheck.id}</span>
                        <span className="font-mono text-[11px] tracking-widest text-dim">
                          TEST RECORDS: {aiFlowCheck.records.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-[15px] leading-relaxed text-muted">{aiFlowCheck.line}</p>
                      <p className="text-sm leading-relaxed text-dim">Findings are always advisory.</p>
                    </li>
                  </ul>
                </section>
              </div>
            </DocSection>

            <DocSection id="safety" step="11" title="Safety and test records">
              <div className="prose-night">
                <ul>
                  <li>
                    <strong>Local targets only.</strong> Run Hound tests <code>localhost</code>, loopback, private
                    network addresses and host names listed in <code>RUNHOUND_ALLOWED_HOSTS</code>. Public sites are
                    refused, and so is <code>0.0.0.0</code>.
                  </li>
                  <li>
                    <code>RUNHOUND_ALLOWED_HOSTS</code> skips the address check with <strong>no ownership check</strong>.
                    Only list host names you own.
                  </li>
                  <li>
                    The browser is pinned to the address the safety check approved and is stopped if the page navigates
                    somewhere else.
                  </li>
                  <li>
                    The web UI answers only on loopback addresses. Don&apos;t expose it to your network: anyone who can
                    reach it can start runs.
                  </li>
                  <li>
                    Reports redact secret-looking text, but screenshots can&apos;t be redacted. A page that shows a
                    secret shows it in the screenshots too.
                  </li>
                  <li>
                    With AI on, only redacted page structure goes to the model you configure; a remote endpoint needs
                    your consent first. See <a href="#ai">AI (optional)</a>.
                  </li>
                  <li>
                    Scenarios that could change or delete existing data (clicking a “Delete” button) are off unless you
                    pass <code>--allow-destructive</code> or tick the option in the UI.
                  </li>
                </ul>
                <h3>Test records it creates</h3>
                <p>
                  A full run sends each form successfully several times (about 7 or 8 save requests per form), so it
                  can create that many records in your app. The values are obviously fake (emails at <code>example.test</code>, a
                  run token in the text), and the report says how many save requests your app accepted.{" "}
                  <strong>Run Hound never deletes them. Point it at a development database you can throw away.</strong>
                </p>
                <p>
                  See also the <Link href="/acceptable-use">acceptable use policy</Link> and{" "}
                  <Link href="/security">security</Link>.
                </p>
              </div>
            </DocSection>

            <DocSection id="limitations" step="12" title="Known limitations">
              <div className="prose-night">
                <ul>
                  <li>
                    <strong>One page, no login.</strong> Up to 5 forms and 20 buttons outside them are tested, and
                    links aren&apos;t followed. Pages that redirect to a login screen get the login form
                    tested instead (check Pages tested). Login forms need a real account for anything past the first
                    submit.
                  </li>
                  <li>
                    <strong>Dev servers don&apos;t send production headers.</strong> Header, cookie and CORS findings on
                    a dev server are advisory. For confirmed results, test a production build served on your machine.
                  </li>
                  <li>
                    <strong>Unusual apps</strong> may still produce false findings. It has been tried on classic HTML
                    forms that post and redirect, fetch-based single-page apps, login forms and forms whose API is on
                    another origin, but not on your stack. That&apos;s what your feedback is for.
                  </li>
                  <li>
                    <strong>Development overlays</strong> (Next.js dev tools, Vite&apos;s error overlay) are part of the
                    page in development; if a finding points at one, tell us.
                  </li>
                  <li>
                    <strong>Docker</strong>: the image is large (about 2.7 GB), and there is no visible browser window.
                  </li>
                  <li>
                    <strong>Windows</strong> is only supported through WSL2 or Docker.
                  </li>
                  <li>
                    <strong>AI</strong>: output quality depends on the model; small models sometimes suggest flows that
                    are rejected (they name a button the form doesn&apos;t have) or give generic reasons. Findings from
                    AI-suggested flows are advisory: check them by hand.
                  </li>
                </ul>
              </div>
            </DocSection>

            <DocSection id="feedback" step="13" title="Sending feedback">
              <div className="prose-night">
                <p>
                  Open an issue with the <strong>Feedback</strong> form on GitHub, or email the same details to{" "}
                  <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>. Please include:
                </p>
                <ol>
                  <li>
                    <strong>The version</strong>: <code>docker run --rm {site.image} --version</code>, or{" "}
                    <code>pnpm exec tsx src/cli.ts --version</code> in <code>app/</code> from source,
                    or <code>runHoundVersion</code> in <code>report.json</code>.
                  </li>
                  <li>
                    <strong>Your OS and how you ran it</strong>: Docker (compose or single container) or from source, web UI or command line, Node
                    version.
                  </li>
                  <li>
                    <strong>What you tested</strong>: the framework, the dev server and what the form does (not the URL,
                    if it&apos;s private).
                  </li>
                  <li>
                    <strong>The report</strong>: <code>report.md</code>, or the run folder zipped.{" "}
                    <strong>Look through the screenshots first</strong>: they show whatever your page showed.
                  </li>
                  <li>
                    <strong>If you used AI</strong>: the provider and model, and whether the reasons and suggested flows
                    were useful or noise.
                  </li>
                  <li>
                    <strong>What was wrong</strong>: a false positive (which finding, and why), a missed bug (and how
                    to see it by hand), a crash (the command, the error text and the exit code), or something confusing.
                  </li>
                </ol>
                <p>A clean run on a well-built app is useful feedback too: tell us it worked, and on what.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <ButtonLink href={site.feedback}>
                  Send feedback on GitHub
                  <ArrowIcon />
                </ButtonLink>
                <ButtonLink href={site.github} variant="secondary">
                  View the repository
                </ButtonLink>
              </div>
            </DocSection>
          </div>
        </div>
      </Container>
    </>
  );
}
