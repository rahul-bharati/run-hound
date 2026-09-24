import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { v0Groups } from "@/components/checks/data";
import { Callout } from "@/components/docs/callout";
import { CodeBlock } from "@/components/docs/code-block";
import { DocSection } from "@/components/docs/doc-section";
import { DocsToc } from "@/components/docs/toc";
import { SeverityLabel, type Severity } from "@/components/finding";
import { Container, PageHeader } from "@/components/layout";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Docs: V0 tester guide",
  description:
    "Run Hound V0 (0.1.0) tester guide: requirements, local and Docker install, trying it on the Kennel demo app, testing your own app, reading the report, the 15 checks, safety and sending feedback.",
};

const toc = [
  { id: "overview", label: "What V0 does" },
  { id: "requirements", label: "Requirements" },
  { id: "install", label: "Install" },
  { id: "kennel", label: "Try it on Kennel" },
  { id: "your-app", label: "Test your own app" },
  { id: "problems", label: "Common problems" },
  { id: "report", label: "Reading the report" },
  { id: "checks", label: "The 15 checks" },
  { id: "safety", label: "Safety and test records" },
  { id: "limitations", label: "Known limitations" },
  { id: "feedback", label: "Sending feedback" },
] as const;

const accessMail = site.accessMail;

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

const dockerInstall = `git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
mkdir -p runs                       # reports land here; create it so the files belong to you
docker compose up --build           # or: podman-compose up --build`;

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

const dockerLinux = `docker compose build run-hound      # once
mkdir -p runs
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" rahulrbharati/run-hound:0.1.0 \\
  run http://localhost:5173/signup --approve all

# the web UI on the host network, bound to loopback only
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" rahulrbharati/run-hound:0.1.0 \\
  serve --host 127.0.0.1 --port 4310`;

const dockerDesktop = `docker compose run --rm run-hound run http://host.docker.internal:5173/signup --approve all`;

const problems: { see: string; means: string }[] = [
  {
    see: "Nothing is answering at http://localhost:<port>",
    means: "Your app isn't running on that port, or Run Hound is in a container (see Docker Desktop above).",
  },
  {
    see: "No form found on …",
    means:
      "The page has no form, the URL is wrong, the page returned an error (a 404, a dev server's “Blocked request”), or it redirected to a login page. Open the URL in your browser and check.",
  },
  {
    see: "Refusing to test …",
    means: "The host isn't local or private. Use localhost; list your own internal host names in RUNHOUND_ALLOWED_HOSTS.",
  },
  { see: "EADDRINUSE", means: "The port is taken. Pick another (--port, PORT, RUNHOUND_HOST_PORT)." },
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
        eyebrow={`DOCS · V0 TESTER PREVIEW ${site.version}`}
        title={
          <>
            Run V0 <span className="text-accent">on your machine.</span>
          </>
        }
        lede="How to run Run Hound V0 on your own machine: install it, try it on Kennel, our deliberately broken demo app, point it at your own form, and read a report where every finding comes with evidence."
      >
        <Callout label="Invite-only preview" title="The repository is private while V0 is in testing." className="max-w-3xl">
          <p>
            To clone it, your GitHub account needs an invitation.{" "}
            <a href={accessMail} className="text-accent underline underline-offset-4 hover:text-accent-strong">
              Ask for access
            </a>
            . If <code className="font-mono text-fg">git clone</code> asks for a username or says the repository
            isn&apos;t found, accept the invitation GitHub emailed you first. The full guide is also in the
            repository as{" "}
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
            <DocSection id="overview" step="01" title="What V0 does">
              <div className="prose-night">
                <p>
                  Run Hound V0 opens one page of your local app in a headless Chromium, finds the main form on it,
                  plans 13 to 15 test scenarios, lets you pick which ones to run, runs them, and writes a report with
                  evidence (annotated screenshots, short GIFs, request and response cards) and a Playwright test for
                  each finding.
                </p>
                <p>It doesn&apos;t, yet:</p>
                <ul>
                  <li>test more than one form per page (it picks the main one) or follow links to other pages;</li>
                  <li>log in: pages behind a login aren&apos;t supported, and a login form can only be partly tested;</li>
                  <li>test public websites: only your own machine and private network addresses;</li>
                  <li>
                    plan with AI: AI planning (a model proposes scenarios from your app) and bringing your own model
                    are <strong>coming soon</strong>. In V0 the plan comes from what Run Hound finds on the page, and
                    every pass or fail comes from a real check with evidence;
                  </li>
                  <li>delete the test records it creates (see <a href="#safety">Safety and test records</a>).</li>
                </ul>
                <p>
                  What we most want to learn from testers: <strong>is every finding real, and did it miss a bug you
                  know about?</strong> A wrong finding costs you time, so we treat each false positive as a bug in Run
                  Hound.
                </p>
              </div>
            </DocSection>

            <DocSection id="requirements" step="02" title="Requirements">
              <div
                role="region"
                aria-labelledby="req-caption"
                tabIndex={0}
                className="overflow-x-auto rounded-2xl border border-line bg-surface"
              >
                <table className="w-full min-w-[34rem] border-collapse text-left text-[15px]">
                  <caption id="req-caption" className="sr-only">
                    Requirements for the local install and for Docker or Podman
                  </caption>
                  <thead>
                    <tr className="border-b border-line">
                      <td className="px-5 py-3.5" />
                      <th scope="col" className="px-5 py-3.5 font-semibold">
                        Local install <span className="font-mono text-[11px] tracking-widest text-accent">RECOMMENDED</span>
                      </th>
                      <th scope="col" className="px-5 py-3.5 font-semibold">
                        Docker or Podman
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-muted">
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">You need</th>
                      <td className="px-5 py-3.5 align-top">
                        Node 22 or newer (24 recommended), pnpm (<code className="font-mono text-fg">corepack enable</code>), git
                      </td>
                      <td className="px-5 py-3.5 align-top">Docker 24+ with Compose, Docker Desktop, or Podman with podman-compose</td>
                    </tr>
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Disk</th>
                      <td className="px-5 py-3.5 align-top">About 1 GB (dependencies and Chromium)</td>
                      <td className="px-5 py-3.5 align-top">About 2.7 GB (built on Microsoft&apos;s Playwright image)</td>
                    </tr>
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Works on</th>
                      <td className="px-5 py-3.5 align-top">Linux and macOS. Windows: use WSL2</td>
                      <td className="px-5 py-3.5 align-top">Linux, macOS, Windows</td>
                    </tr>
                    <tr>
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Your own app</th>
                      <td className="px-5 py-3.5 align-top">Just enter http://localhost:&lt;port&gt;/&lt;page&gt;</td>
                      <td className="px-5 py-3.5 align-top">
                        Linux: host network, same as local. Mac and Windows: a few dev-server settings
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="prose-night">
                <p>
                  <strong>Use the local install if you can.</strong> It tests your app exactly as your browser sees it,
                  with no networking set-up. And bring an app: a web app running on your machine with a form in it
                  (sign-up, contact, booking, checkout details, settings). You don&apos;t need to know Playwright or
                  accessibility rules; the report explains each finding in plain language.
                </p>
              </div>
            </DocSection>

            <DocSection id="install" step="03" title="Install">
              <div className="prose-night">
                <h3>Local install</h3>
              </div>
              <CodeBlock label="Local install">{localInstall}</CodeBlock>
              <div className="prose-night">
                <p>
                  On Ubuntu or Debian, if Chromium complains about missing libraries, run{" "}
                  <code>pnpm --filter run-hound exec playwright install --with-deps chromium</code> (it uses sudo). Check
                  it works: <code>cd app &amp;&amp; pnpm exec tsx src/cli.ts --version</code> prints{" "}
                  <code>run-hound {site.version}</code>.
                </p>
                <h3>Docker or Podman</h3>
              </div>
              <CodeBlock label="Docker or Podman">{dockerInstall}</CodeBlock>
              <div className="prose-night">
                <p>
                  The first build downloads about 2 GB. When you see <code>Run Hound UI: open http://localhost:4000</code>,
                  open that address. The log also mentions <code>0.0.0.0:4000</code>: that address is inside the
                  container; on your machine the port is bound to <code>127.0.0.1</code> only. Ports taken? Set{" "}
                  <code>RUNHOUND_HOST_PORT</code>, <code>KENNEL_HOST_PORT</code> and{" "}
                  <code>KENNEL_ANALYTICS_HOST_PORT</code> before <code>docker compose up --build</code>.
                </p>
              </div>
            </DocSection>

            <DocSection id="kennel" step="04" title="Try it on Kennel first">
              <div className="prose-night">
                <p>
                  Kennel is a pet-sitting booking form with planted bugs you can switch on and off. Trying it first
                  shows you what findings, evidence and a clean run look like. It takes about 10 minutes.
                </p>
                <h3>Local install</h3>
                <p>Two terminals, from the repository root. The ports are examples; any free ports work.</p>
              </div>
              <CodeBlock label="Start Kennel and the web UI">{kennelLocal}</CodeBlock>
              <div className="prose-night">
                <ol>
                  <li>
                    Open <code>http://localhost:4310</code> and enter <code>http://localhost:5310/book</code>.
                  </li>
                  <li>
                    Read the plan, shown under <strong>Accessibility</strong>, <strong>Features</strong> and{" "}
                    <strong>Security</strong> headings, each with a “Select all” box. Each scenario says what it does
                    and whether it creates test records. Keep them all ticked and press <strong>Run approved
                    checks</strong>. Nothing runs before you do.
                  </li>
                  <li>
                    Watch the live view: the page under test, the current group and scenario (“Accessibility · 3 of
                    15”), the elapsed time, the current step and every page loaded. A run takes about a minute; when it
                    ends the UI says “Finished in …”.
                  </li>
                  <li>
                    Open the report. You should see findings for most of Kennel&apos;s planted bugs: a button that does
                    nothing, a double submit, a secret key in the bundle, an email sent to the analytics service,
                    missing focus outlines and more.
                  </li>
                  <li>
                    Restart Kennel with <code>KENNEL_BUGS=none</code> and run again.{" "}
                    <strong>A clean Kennel should give zero confirmed findings.</strong> If it doesn&apos;t, that&apos;s
                    a bug worth reporting.
                  </li>
                </ol>
                <p>The same from the command line:</p>
              </div>
              <CodeBlock label="Command line">{kennelCli}</CodeBlock>
              <div className="prose-night">
                <h3>Docker or Podman</h3>
                <p>
                  With <code>docker compose up</code> running, open <code>http://localhost:4000</code> and enter{" "}
                  <code>http://kennel:3000/book</code> (inside the containers Kennel is called <code>kennel</code>), or
                  run <code>docker compose run --rm run-hound run http://kennel:3000/book --approve all</code>. For a
                  clean Kennel: <code>KENNEL_BUGS=none docker compose up</code>. In containers the target isn&apos;t
                  localhost, so <code>client-only-validation</code> is skipped and the report says why.
                </p>
              </div>
            </DocSection>

            <DocSection id="your-app" step="05" title="Test your own app">
              <div className="prose-night">
                <ol>
                  <li>
                    Start your app the way you normally develop it, with a <strong>throwaway database</strong>.
                  </li>
                  <li>
                    Find the exact URL of the page with the form, for example <code>http://localhost:5173/signup</code>.
                    Use <code>localhost</code>, not <code>0.0.0.0</code>.
                  </li>
                  <li>Run Run Hound on it, then check each finding against your app.</li>
                </ol>
                <h3>Local install</h3>
                <p>
                  Web UI: <code>pnpm serve --port 4310</code>, open <code>http://localhost:4310</code> and enter your
                  form&apos;s URL. Or the command line:
                </p>
              </div>
              <CodeBlock label="Command line">{ownCli}</CodeBlock>
              <div className="prose-night">
                <p>
                  Options: <code>--approve all|default|&lt;id,id&gt;</code> (default: the recommended scenarios),{" "}
                  <code>--plan-only</code>, <code>--allow-destructive</code>, <code>--headed</code> (a visible browser
                  window), <code>--runs-dir &lt;dir&gt;</code>, <code>--json</code>. <code>help</code> lists them.
                </p>
                <h3>Docker on Linux (host network)</h3>
                <p>
                  On Linux the container can share your machine&apos;s network, so <code>localhost</code> means your
                  machine and nothing in your app needs to change. Podman works the same.
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
                    <code>http://localhost:4000</code>, or run:
                  </li>
                </ol>
              </div>
              <CodeBlock label="Docker Desktop">{dockerDesktop}</CodeBlock>
              <div className="prose-night">
                <p>
                  Limits of this set-up: a frontend that calls its API at <code>http://localhost:&lt;apiPort&gt;</code>{" "}
                  will call the container instead and fail (use the host network or the local install);{" "}
                  <code>client-only-validation</code> is skipped for non-localhost targets; and “Show the browser
                  window” doesn&apos;t work in a container.
                </p>
              </div>
            </DocSection>

            <DocSection id="problems" step="06" title="Common problems">
              <dl className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line bg-surface">
                {problems.map((p) => (
                  <div key={p.see} className="flex flex-col gap-1.5 px-5 py-4">
                    <dt className="font-mono text-[13px] text-fg [overflow-wrap:anywhere]">{p.see}</dt>
                    <dd className="text-[15px] leading-relaxed text-muted">{p.means}</dd>
                  </div>
                ))}
              </dl>
            </DocSection>

            <DocSection id="report" step="07" title="Reading the report">
              <div className="prose-night">
                <p>
                  Every run writes a folder: <code>app/runs/&lt;runId&gt;/</code> for the local install,{" "}
                  <code>./runs/&lt;runId&gt;/</code> for Docker. In it:
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
                    hint. Worth a look, not a failure.
                  </li>
                </ul>
                <p>
                  The command line exits with <strong>0</strong> when there are no confirmed findings,{" "}
                  <strong>1</strong> when there is at least one, and <strong>2</strong> on an error (a refused or
                  unreachable target, a page without a form, or a bad option).
                </p>
                <h3>Also in the report</h3>
                <ul>
                  <li>
                    <strong>Scenarios</strong>: every scenario under its group with its result, time and notes, the
                    ones you didn&apos;t approve, and checks that had nothing to test on your form.
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

            <DocSection id="checks" step="08" title="The 15 checks">
              <div className="prose-night">
                <p>
                  The plan, the run, the progress and the report all follow the same three groups. Scenarios that
                  don&apos;t apply to your form (no password field, no JSON save request) are{" "}
                  <strong>skipped with a plain reason</strong>, never silently dropped.
                </p>
              </div>
              <div className="flex flex-col gap-6">
                {v0Groups.map((g) => (
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
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <span className="font-mono text-sm text-accent">{c.id}</span>
                            <span className="font-mono text-[11px] tracking-widest text-dim">
                              TEST RECORDS: {c.records.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[15px] leading-relaxed text-muted">{c.line}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </DocSection>

            <DocSection id="safety" step="09" title="Safety and test records">
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
                    Scenarios that could change or delete existing data (clicking a “Delete” button) are off unless you
                    pass <code>--allow-destructive</code> or tick the option in the UI.
                  </li>
                </ul>
                <h3>Test records it creates</h3>
                <p>
                  A full run sends the form successfully several times (about 7 or 8 save requests), so it can create
                  that many records in your app. The values are obviously fake (emails at <code>example.test</code>, a
                  run token in the text), and the report says how many save requests your app accepted.{" "}
                  <strong>Run Hound never deletes them. Point it at a development database you can throw away.</strong>
                </p>
                <p>
                  See also the <Link href="/acceptable-use">acceptable use policy</Link> and{" "}
                  <Link href="/security">security</Link>.
                </p>
              </div>
            </DocSection>

            <DocSection id="limitations" step="10" title="Known limitations">
              <div className="prose-night">
                <ul>
                  <li>
                    <strong>One form, one page, no login.</strong> Pages that redirect to a login screen get the login
                    form tested instead (check Pages tested). Login forms need a real account for anything past the
                    first submit.
                  </li>
                  <li>
                    <strong>Unusual apps</strong> may still produce false findings. It has been tried on classic HTML
                    forms that post and redirect, fetch-based single-page apps, login forms and forms whose API is on
                    another origin, but not on your stack. That&apos;s what this test round is for.
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
                </ul>
              </div>
            </DocSection>

            <DocSection id="feedback" step="11" title="Sending feedback">
              <div className="prose-night">
                <p>
                  Open an issue with the <strong>V0 tester feedback</strong> form on GitHub, or email the same details
                  to the person who invited you. Please include:
                </p>
                <ol>
                  <li>
                    <strong>The version</strong>: <code>pnpm exec tsx src/cli.ts --version</code> in <code>app/</code>,
                    or <code>runHoundVersion</code> in <code>report.json</code>.
                  </li>
                  <li>
                    <strong>Your OS and how you ran it</strong>: local install or Docker, web UI or command line, Node
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
                <ButtonLink href={accessMail} variant="secondary">
                  Ask for access
                </ButtonLink>
              </div>
            </DocSection>
          </div>
        </div>
      </Container>
    </>
  );
}
