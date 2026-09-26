import Link from "next/link";
import { ArrowIcon, ButtonLink } from "@/components/button-link";
import { aiFlowCheck, previewGroups } from "@/components/checks/data";
import { Callout } from "@/components/docs/callout";
import { CodeBlock } from "@/components/docs/code-block";
import { DocSection } from "@/components/docs/doc-section";
import { DocsToc } from "@/components/docs/toc";
import { SeverityLabel, type Severity } from "@/components/finding";
import { Container, NewTag, PageHeader } from "@/components/layout";
import { aiBuiltScreens, aiScreens, v2Screens, type Screen } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

const checkTotal = previewGroups.reduce((sum, g) => sum + g.checks.length, 0);

export const metadata = pageMetadata({
  path: "/docs/",
  title: "Docs",
  description: `Run Hound ${site.version} guide: the Docker quick start, the demo apps, your own app, test accounts and signed-in runs, optional AI, the report and every check.`,
});

const toc = [
  { id: "overview", label: "What it does" },
  { id: "quick-start", label: "Quick start" },
  { id: "requirements", label: "Requirements" },
  { id: "install", label: "From source" },
  { id: "kennel", label: "Try it on Kennel" },
  { id: "your-app", label: "Test your own app" },
  { id: "accounts", label: "Test accounts" },
  { id: "ai-built", label: "Apps from AI builders" },
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

const labStart = `curl -fsSLO ${site.composeFileUrl}
mkdir -p runs                       # reports land here; create it yourself so the files belong to you
docker compose -f run-hound.compose.yml up   # or: podman compose -f run-hound.compose.yml up`;

const envFile = `# optional: host ports, KENNEL_BUGS, FERNWAY_BUGS, allowed hosts, AI, test accounts (every one has a default)
curl -fsSL ${site.envFileUrl} -o .env`;

const labCommands = `docker compose -f run-hound.compose.yml ps     # each service and its health
# stop: Ctrl+C, then
docker compose -f run-hound.compose.yml down`;

const testApps: { name: string; body: string }[] = [
  {
    name: "Kennel",
    body: "Our deliberately broken pet-sitting booking app, with every planted bug on (KENNEL_BUGS in .env). Target: http://kennel:3000/book.",
  },
  { name: "Kennel (clean)", body: "The same app in clean mode: every check should pass. Target: http://kennel-clean:3000/book." },
  {
    name: "Fernway",
    body: "A project-planning app built the way AI builders build them (Vite, React, Tailwind, Radix, sonner), in clean mode. Target: http://fernway:4110/, and /signup, /login, /onboarding, /app, /app/settings, /app/help.",
  },
  {
    name: "Fernway (bugs)",
    body: "The same app with its planted bugs on (FERNWAY_BUGS in .env). /app, /app/settings and /app/help need a signed-in run. Target: http://fernway-bugs:4110/.",
  },
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
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ${site.imageName} \\
  run http://localhost:5173/signup --approve all

# the web UI on the host network, bound to loopback only
docker run --rm --init --network host -v "$PWD/runs:/repo/app/runs" ${site.imageName} \\
  serve --host 127.0.0.1 --port 4310`;

const aiCli = `cd app
pnpm exec tsx src/cli.ts ai status                                         # the effective settings and what's missing
pnpm exec tsx src/cli.ts ai test --ai-provider ollama --ai-model qwen3:8b  # one small call to check the model answers
pnpm exec tsx src/cli.ts run http://localhost:5310/book --ai --ai-provider ollama --ai-model qwen3:8b --plan-only`;

// The docs column: max-w-3xl (768 px) from xl, the viewport minus the gutters and the 220 px contents column on lg.
const docShotSizes =
  "(min-width: 1280px) 768px, (min-width: 1024px) calc(100vw - 428px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)";

type Figure = { screen: Screen; caption: string };

const aiFigures: Figure[] = [
  { screen: aiScreens.settings, caption: "Settings → AI with Ollama on the same machine: the model picked from the server's list and a successful Test connection." },
  { screen: aiScreens.suggested, caption: "Two Suggested by AI flows in a plan: unticked, each with the model's reason and the steps it will take, ending in a check." },
  { screen: aiScreens.explanation, caption: "A finding after the run: the built-in “What to ask your AI”, then the model's AI explanation, labelled advisory." },
];

// Fernway's two accounts in the web UI, and a signed-in run on its settings page with its planted bugs on.
const accountFigures: Figure[] = [
  { screen: v2Screens.accounts, caption: "Settings → Test accounts with Fernway's two accounts, both saved and tested. A saved password is never shown again: the field only says it is saved." },
  { screen: v2Screens.signedInPlan, caption: "New Run with Sign in as → Account A: the plan says who it was made as, and the run signs in as the same account." },
];

const accessFigures: Figure[] = [
  { screen: v2Screens.accessControl, caption: "An access-control finding: Account B read Account A's profile (GET /api/users/alex-rivera/profile answered 200), with the answer that proves it. Account A's values are masked." },
  { screen: v2Screens.massAssignment, caption: "A mass-assignment finding: the record read back after the replay holds role, isAdmin, plan and six more fields the form never sends." },
];

const aiBuiltFigures: Figure[] = [
  { screen: aiBuiltScreens.plan, caption: "Fernway's landing page planned: the waitlist, the newsletter form and the Book a demo form, which appears only in its dialog; 40 scenarios, each tagged with its form." },
  { screen: aiBuiltScreens.dialog, caption: "Mid-run, the golden path of the Book a demo form: Run Hound opened the dialog and filled it, the Radix Company size select and the consent checkbox included." },
];

/** Screenshots in the docs column, each with its caption below. */
function Figures({ items }: { items: Figure[] }) {
  return (
    <div className="flex flex-col gap-8">
      {items.map((f) => (
        <figure key={f.caption} className="flex flex-col gap-3">
          <Screenshot screen={f.screen} sizes={docShotSizes} />
          <figcaption className="text-sm leading-relaxed text-muted">{f.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}

const aiDocker = `# .env: Ollama on your machine, seen from the container
RUNHOUND_AI=1
RUNHOUND_AI_PROVIDER=ollama
# Docker; Podman: http://host.containers.internal:11434/v1; host network on Linux: http://127.0.0.1:11434/v1
RUNHOUND_AI_BASE_URL=http://host.docker.internal:11434/v1
RUNHOUND_AI_MODEL=qwen3:8b`;

// Test accounts from source (in app/); in a container the same commands follow the image name or
// `docker compose -f run-hound.compose.yml run --rm run-hound`.
const accountsCli = `cd app
pnpm exec tsx src/cli.ts accounts set a --login-url http://localhost:5173/login --username a@example.test --password-stdin
pnpm exec tsx src/cli.ts accounts set b --login-url http://localhost:5173/login --username b@example.test --password-stdin
pnpm exec tsx src/cli.ts accounts status        # both accounts, where each value comes from; never a password
pnpm exec tsx src/cli.ts accounts test          # signs in as A and B: exit 0 when both work, 2 otherwise
pnpm exec tsx src/cli.ts run http://localhost:5173/dashboard --as a --plan-only
pnpm exec tsx src/cli.ts run http://localhost:5173/dashboard --as a --approve all
pnpm exec tsx src/cli.ts accounts clear b       # removes account B`;

const accountsEnv = `# .env next to the compose file: each value overrides the saved one; an empty one doesn't
RUNHOUND_ACCOUNT_A_LOGIN_URL=http://host.docker.internal:5173/login
RUNHOUND_ACCOUNT_A_USERNAME=a@example.test
RUNHOUND_ACCOUNT_A_PASSWORD=
RUNHOUND_ACCOUNT_A_LABEL=Alice
# the same four with _B_ for account B, and:
RUNHOUND_ACCOUNTS_ISOLATED=true   # A and B must not see each other's data`;

const dockerDesktop = `docker run --rm --init --add-host host.docker.internal:host-gateway -v "$PWD/runs:/repo/app/runs" \\
  ${site.imageName} run http://host.docker.internal:5173/signup --approve all

# the same in the test lab, in the folder with run-hound.compose.yml
docker compose -f run-hound.compose.yml run --rm run-hound run http://host.docker.internal:5173/signup --approve all`;

const problems: { see: string; means: string }[] = [
  {
    see: "Nothing is answering at http://localhost:<port>",
    means: "Your app isn't running on that port, or Run Hound is in a container (see Docker or Podman above).",
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
  {
    see: "EADDRINUSE, or “… is already in use”",
    means: "The port is taken. Pick another (--port, PORT, RUNHOUND_HOST_PORT).",
  },
  {
    see: "manifest unknown, or denied, pulling ghcr.io/rahul-bharati/run-hound…",
    means: `The images are public, so no login is needed. manifest unknown: a typo in the image name or tag (${site.image}, and run-hound-kennel, run-hound-samples and run-hound-fernway with the same tag), or a machine that isn't linux/amd64 or arm64. denied: an old GitHub login on this machine; run docker logout ghcr.io and pull again.`,
  },
  {
    see: "Invoke-WebRequest : A parameter cannot be found that matches parameter name 'fsSLO'",
    means: "In Windows PowerShell, curl is another command. Type curl.exe instead of curl.",
  },
  {
    see: "EACCES … mkdir '/repo/app/runs/…'",
    means: "The container can't write to your reports folder. Create it first (mkdir -p runs); on Podman avoid --user.",
  },
  {
    see: "A service shows (health: starting) or (unhealthy) in docker compose ps",
    means: "Every service has a health check. Starting is normal for the first seconds. Unhealthy means it stopped answering: docker compose -f run-hound.compose.yml logs <service> says why.",
  },
  {
    see: "--headed: There is no display on the machine running Run Hound…",
    means: "A visible browser window needs a display, which a container doesn't have. Run without --headed; the web UI greys the option out there, and its live view works either way. For a window, install from source on a machine with a display.",
  },
  {
    see: "No sign-in form (a form with a password field) was found on …",
    means: "The test account's sign-in page URL doesn't show a sign-in form: check it in your browser. Sign-in with Google or another provider, magic links, codes and captchas aren't supported.",
  },
  {
    see: "Signed in as Account A, but … still shows the sign-in page",
    means: "The sign-in didn't hold. Check the account with Test sign-in (Settings → Test accounts) or accounts test. When the sign-in page and the page you test use different host names (localhost and 127.0.0.1), use the same one for both: a browser keeps their cookies apart.",
  },
  {
    see: "Nothing was tested: …",
    means: "Every approved scenario errored or was skipped, often because the app stopped answering after the plan. The report says why for each one; the command line exits 2.",
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
        eyebrow={`DOCS · ${site.version}`}
        title={
          <>
            Run it <span className="text-accent">on your machine.</span>
          </>
        }
        lede="How to run Run Hound on your own machine: start it with the test apps in one command, try it on Kennel, our deliberately broken demo app, point it at a page of your own, sign in with test accounts, and read a report where every finding comes with evidence."
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
            <DocSection id="overview" step="01" title="What it does">
              <div className="prose-night">
                <p>
                  Run Hound {site.version} ({site.release}, {site.releaseName.toLowerCase()}, with a {site.preview})
                  opens one page of your local app in a headless Chromium and finds the <strong>forms and controls</strong>{" "}
                  on it, including the custom widgets and dialog forms of apps from AI builders. It plans the form checks
                  for each form, plus page-wide checks (security headers, cookie flags, CORS, public source maps, controls
                  outside the forms and links that break when opened directly), lets you pick which ones to run, runs
                  them in a real browser, and writes a report with evidence (annotated screenshots, short GIFs, request
                  and response cards) and a Playwright test for each finding.
                </p>
                <p>
                  New in 0.4.0, as a preview of V2: <strong>test accounts and signed-in runs</strong>. Run Hound
                  signs in with an account you own before it tests, so pages behind a login get every check, and the
                  access checks ask whether another account, or a visitor who isn&apos;t signed in, can read your data.
                  See <a href="#accounts">Test accounts</a>. Also new: discovery that handles the widgets, dialogs and
                  form libraries of apps built with Lovable, Bolt and v0 (see{" "}
                  <a href="#ai-built">Apps from AI builders</a>), and a Docker image about a quarter of its old size.
                </p>
                <p>
                  Since 0.3.0: <strong>optional AI with your own model</strong>. It reviews the plan, suggests extra
                  flows and explains findings. It is off by default and never decides pass or fail. See{" "}
                  <a href="#ai">AI (optional)</a>.
                </p>
                <p>It doesn&apos;t:</p>
                <ul>
                  <li>
                    test a feature across pages: it opens the page&apos;s own links only to check they load (the rest
                    of V2 is planned);
                  </li>
                  <li>
                    sign in with Google or another provider, a magic link, a code or a captcha: only the app&apos;s own
                    sign-in form with a username and password;
                  </li>
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
                  Pull the image and run it. No clone and no build: you need Docker, Docker Desktop or Podman, and a
                  folder for the reports.
                </p>
              </div>
              <CodeBlock label="Docker or Podman, from any folder">{site.runCommands}</CodeBlock>
              <div className="prose-night">
                <p>
                  The image is about 260 MB to download (715 MB on disk: Node and Chromium&apos;s headless shell). The
                  log prints the address to open, <code>http://localhost:4000</code>. It also mentions{" "}
                  <code>0.0.0.0:4000</code>: that address is inside the container; on your machine the port is bound to{" "}
                  <code>127.0.0.1</code> only. Enter a page of an app on your machine as{" "}
                  <code>http://host.docker.internal:&lt;port&gt;/&lt;page&gt;</code>: Docker Desktop defines that name
                  itself, and <code>--add-host</code> adds it on Linux. Your dev server must accept that host name (see{" "}
                  <a href="#your-app">Test your own app</a>). Reports are written to <code>./runs</code>, and the AI
                  settings and test accounts you save in the UI to <code>./runs/.config</code>.
                </p>
                <p>
                  The image has these settings built in:{" "}
                  <code>RUNHOUND_ALLOWED_HOSTS=host.docker.internal,host.containers.internal</code> and{" "}
                  <code>RUNHOUND_CONFIG_DIR=/repo/app/runs/.config</code>. You can still override either with{" "}
                  <code>-e</code>. Podman works the same (<code>podman pull …</code>, <code>podman run …</code>;{" "}
                  <code>host.containers.internal</code> also works there). In Windows PowerShell, write the{" "}
                  <code>docker run</code> on one line, use <code>mkdir runs</code>, and type <code>curl.exe</code>{" "}
                  instead of <code>curl</code> for the downloads below. To update, <code>docker pull</code> again.
                </p>
                <h3>Try it on the demo apps: the test lab</h3>
                <p>
                  One compose file starts Run Hound and a set of local test apps from the published images, so you can
                  try it before pointing it at anything of your own. You also need Compose (or podman-compose) and an
                  empty folder.
                </p>
              </div>
              <CodeBlock label="The test lab, from an empty folder">{labStart}</CodeBlock>
              <div className="prose-night">
                <p>
                  The first start downloads about 0.5 GB of images: Run Hound&apos;s, and a little for each test app.
                  When the log prints <code>open http://localhost:4000</code>, open that address and enter{" "}
                  <code>http://kennel:3000/book</code> (inside the containers Kennel is called <code>kennel</code>). Its
                  ports are bound to <code>127.0.0.1</code> only, and reports go to <code>./runs</code>. Ports taken, or want to change a setting? Every setting has a default; put your changes in a{" "}
                  <code>.env</code> file next to the compose file, starting from the documented example:
                </p>
              </div>
              <CodeBlock label="Optional settings">{envFile}</CodeBlock>
              <div className="prose-night">
                <p>
                  Every service has a health check, so <code>ps</code> shows when each one is ready. To stop the lab,
                  press Ctrl+C, then remove its containers:
                </p>
              </div>
              <CodeBlock label="Check and stop the lab">{labCommands}</CodeBlock>
              <div className="prose-night">
                <p>
                  The images (<code>{site.image}</code>, with{" "}
                  {site.labImages.map((name, i) => (
                    <span key={name}>
                      {i === 0 ? "" : i === site.labImages.length - 1 ? " and " : ", "}
                      <code>{name}</code>
                    </span>
                  ))}
                  , for linux/amd64 and arm64) are public on GitHub&apos;s container registry. The compose file comes
                  from the {site.tag} release and names that release&apos;s images, so the lab stays the same until you
                  choose to update: download the compose file of the new release and start it again, and the new
                  images are pulled.
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
                  Kennel and Fernway with their bugs on should give findings for the planted bugs. Clean Kennel, clean
                  Fernway and the five sample apps are built correctly on purpose, so{" "}
                  <strong>any confirmed finding on them is a false positive</strong>, and worth reporting. Enter these
                  addresses in the Run Hound UI: inside the compose network each app is reached by its service name.
                  Every app is also published on 127.0.0.1 (ports in <code>.env.example</code>). Fernway&apos;s signed-in
                  pages need its two accounts as test accounts: see <a href="#accounts">Test accounts</a>.
                </p>
              </div>
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
                        Docker 24+, Docker Desktop or Podman. For the test lab, also Compose (or podman-compose) and curl. No clone, no Node
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        Node 22.12 or newer (24 recommended), pnpm (<code className="font-mono text-fg">corepack enable</code>), git
                      </td>
                    </tr>
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Disk</th>
                      <td className="px-5 py-3.5 align-top">
                        Run Hound&apos;s image: about 715 MB (260 MB to download). With the test apps: about 1 GB
                        (about 0.5 GB to download)
                      </td>
                      <td className="px-5 py-3.5 align-top">About 1 GB (dependencies and Chromium)</td>
                    </tr>
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Works on</th>
                      <td className="px-5 py-3.5 align-top">Linux, macOS, Windows (amd64 and arm64)</td>
                      <td className="px-5 py-3.5 align-top">Linux and macOS. Windows: use WSL2</td>
                    </tr>
                    <tr className="border-b border-line-soft">
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Your own app</th>
                      <td className="px-5 py-3.5 align-top">
                        Enter http://host.docker.internal:&lt;port&gt;/&lt;page&gt;, with a few dev-server settings.
                        Linux: or the host network, same as local
                      </td>
                      <td className="px-5 py-3.5 align-top">Just enter http://localhost:&lt;port&gt;/&lt;page&gt;</td>
                    </tr>
                    <tr>
                      <th scope="row" className="px-5 py-3.5 align-top font-medium text-fg">Visible browser window</th>
                      <td className="px-5 py-3.5 align-top">No: a container has no display (the live view works)</td>
                      <td className="px-5 py-3.5 align-top">
                        Yes, on a machine with a display (<code className="font-mono text-fg">--headed</code>)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="prose-night">
                <p>
                  <strong>Docker or Podman is the quickest way to try it</strong>: pull one image and run it, nothing
                  to clone; one compose file adds the test apps. On Linux it tests your own app just as simply, through the host network. On a Mac or
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
                  starts the same containers as the test lab from your working tree (<code>docker-compose.yml</code>).
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
                  Start the <a href="#quick-start">test lab</a>: Kennel is already running next to Run Hound. Open{" "}
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
                <h3>Docker or Podman (any OS)</h3>
                <p>
                  The set-up of the <a href="#quick-start">quick start</a> and the test lab. Inside the container{" "}
                  <code>localhost</code> is the container itself, not your machine. Use{" "}
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
                    <code>http://localhost:4000</code> (the <a href="#quick-start">quick start</a> or the test lab), or
                    run it once from the command line. It prints{" "}
                    <code>Report: /repo/app/runs/&lt;runId&gt;/report.html</code>; on your machine that&apos;s{" "}
                    <code>./runs/&lt;runId&gt;/report.html</code>.
                  </li>
                </ol>
              </div>
              <CodeBlock label="Docker or Podman, one run">{dockerDesktop}</CodeBlock>
              <div className="prose-night">
                <p>
                  Limits of this set-up: a frontend that calls its API at <code>http://localhost:&lt;apiPort&gt;</code>{" "}
                  will call the container instead and fail (use the host network or the install from source);{" "}
                  <code>client-only-validation</code> is skipped for non-localhost targets; and “Show the browser
                  window” doesn&apos;t work in a container.
                </p>
                <h3>Docker on Linux (host network)</h3>
                <p>
                  On Linux the container can share your machine&apos;s network instead, so <code>localhost</code> means your
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
                  window, from source on a machine with a display), <code>--runs-dir &lt;dir&gt;</code>,{" "}
                  <code>--json</code>, <code>--as a|b</code> (sign in first, see <a href="#accounts">Test accounts</a>)
                  and the <code>--ai</code> flags (see <a href="#ai">AI (optional)</a>). <code>help</code> lists them.
                </p>
                <p>
                  Page behind a login? Set up a <a href="#accounts">test account</a> and plan it signed in.
                </p>
              </div>
            </DocSection>

            <DocSection id="accounts" step="07" title="Test accounts and signed-in runs">
              <div className="prose-night">
                <p>
                  New in 0.4.0, as a {site.preview}. Give Run Hound two accounts you own on your app, A and B,
                  and it signs in before it tests: every check then runs signed in, so pages behind a login get tested
                  too, and the plan adds the access checks. Use accounts made for testing, on a development database,
                  never a real customer&apos;s. Sign-in uses the app&apos;s own form with a username (usually an email)
                  and a password; sign-in with Google or another provider, magic links, codes and captchas aren&apos;t
                  supported.
                </p>
                <h3>In the web UI</h3>
                <ol>
                  <li>
                    Open <strong>Settings → Test accounts</strong>. For each account, fill in a label (how plans and
                    reports name it), the sign-in page URL, the username and the password, then press{" "}
                    <strong>Save</strong> and <strong>Test sign-in</strong>. A saved password is never shown again.
                  </li>
                  <li>
                    Keep <strong>A and B must not see each other&apos;s data</strong> ticked when they are different
                    users, not teammates in one workspace. The check that account B can&apos;t read account A&apos;s
                    data runs only then.
                  </li>
                  <li>
                    In <strong>New Run</strong>, pick <strong>Sign in as → Account A</strong> and plan the page. The plan
                    says &ldquo;Signed in as Account A&rdquo;, and so do the live view, the report and the Runs page.
                    Signed out, a plan with a form shows a hint that plans the page again signed in.
                  </li>
                </ol>
              </div>
              <Figures items={accountFigures} />
              <div className="prose-night">
                <h3>From the command line</h3>
                <p>
                  <code>--password-stdin</code> reads the password from what you type or pipe in, never from a flag, so
                  it stays out of your shell history. The sign-in page must pass the same safety check as any target.
                </p>
              </div>
              <CodeBlock label="Test accounts from the command line, from source">{accountsCli}</CodeBlock>
              <div className="prose-night">
                <p>
                  In a container the same commands follow the image name, or{" "}
                  <code>docker compose -f run-hound.compose.yml run --rm run-hound</code> in the test lab folder: the
                  image takes <code>accounts</code> like <code>run</code>.
                </p>
                <h3>With environment variables</h3>
                <p>
                  Each <code>RUNHOUND_ACCOUNT_*</code> variable overrides that one saved value; the compose file passes
                  them through from a <code>.env</code> next to it. The full list is in{" "}
                  <a href={site.envExample}>.env.example</a>.
                </p>
              </div>
              <CodeBlock label="Test accounts in .env">{accountsEnv}</CodeBlock>
              <div className="prose-night">
                <p>
                  Saved accounts go to <code>accounts.json</code> next to the AI settings: in{" "}
                  <code>~/.config/run-hound</code> from source, or <code>./runs/.config</code> with the quick start, in
                  a file only your user can read. That folder holds your passwords and any AI key:{" "}
                  <strong>share a single <code>runs/&lt;runId&gt;</code> folder, never the whole runs folder.</strong>
                </p>
                <h3>What a signed-in run does</h3>
                <ul>
                  <li>
                    It signs in fresh, in its own browser, at the start of each plan and each run. A failed sign-in
                    stops before any scenario runs and says why (the command line exits 2).
                  </li>
                  <li>
                    It never clicks Log out or Sign out, even with <code>--allow-destructive</code>, and never submits a
                    form that sets a password (sign-up, change password): either would end or change the test account.
                  </li>
                  <li>Test records it creates belong to account A, and the report says so.</li>
                </ul>
                <h3>The access checks</h3>
                <ul>
                  <li>
                    <code>access-control</code> (Security, signed in): as account A it saves a test record, then replays
                    the requests that returned A&apos;s data as account B and as a visitor who isn&apos;t signed in.
                    Either one getting A&apos;s data back is a critical finding. It replays only A&apos;s own GET
                    requests, never one that acts.
                  </li>
                  <li>
                    <code>mass-assignment</code> (Security, signed in, unticked by default): it replays account A&apos;s
                    save with fields the form never sends, such as <code>role: &quot;admin&quot;</code> or{" "}
                    <code>plan: &quot;pro&quot;</code>, and reads the record again. It changes account A, then puts back
                    what it changed and says what it couldn&apos;t.
                  </li>
                  <li>
                    <code>deep-links</code> (Features, signed in or not): it opens up to 10 of the page&apos;s own links
                    directly, as a reload or a shared link would, and never one that signs out, deletes or accepts an
                    invitation.
                  </li>
                </ul>
              </div>
              <Figures items={accessFigures} />
              <div className="prose-night">
                <h3>Secrets stay out of what it writes</h3>
                <ul>
                  <li>
                    Passwords are write-only: the web UI and its API never return a saved one, and a saved password is
                    only sent to the sign-in site it was saved for. Change the sign-in page to another site and the
                    saved password is removed.
                  </li>
                  <li>
                    Passwords, session cookies and tokens are hidden in reports, evidence, Playwright tests, logs,
                    progress and AI prompts, and so are the accounts&apos; usernames: reports name accounts by label.
                    The access-control test you export reads the accounts from <code>RUNHOUND_ACCOUNT_*</code>{" "}
                    variables; it never holds a password.
                  </li>
                  <li>
                    Screenshots are taken with the account&apos;s name and session values dotted out. The live view in
                    the web UI isn&apos;t masked; it stays on your machine.
                  </li>
                  <li>
                    A very common password (&ldquo;password&rdquo;, &ldquo;123456&rdquo;) gets a warning in the
                    account&apos;s status: hiding it everywhere would give it away.
                  </li>
                </ul>
                <h3>Try it on Fernway</h3>
                <p>
                  In the test lab, set up Fernway&apos;s two accounts as A and B with the sign-in page{" "}
                  <code>http://fernway-bugs:4110/login</code> (their emails and passwords are in{" "}
                  <a href={site.fernwayGuide}>Fernway&apos;s README</a>), then plan{" "}
                  <code>http://fernway-bugs:4110/app</code> signed in as Account A, with every scenario ticked. The
                  planted access bugs show up as access-control and deep-links findings: deep-links reports{" "}
                  <code>/app/help</code>, the help page in the sidebar, which answers 404 when opened directly. Then
                  plan <code>http://fernway-bugs:4110/app/settings</code> the same way to see mass-assignment catch
                  Fernway&apos;s bug there. On clean Fernway, <code>http://fernway:4110</code>{" "}
                  with its own sign-in page (enter the passwords again: they only go to the site they were saved for),
                  the same runs should give no confirmed findings. The{" "}
                  <a href={`${site.testingGuide}#try-it-on-fernway-first`}>getting-started guide</a> walks through it.
                </p>
              </div>
            </DocSection>

            <DocSection id="ai-built" step="08" title="Apps from AI builders">
              <div className="prose-night">
                <p>
                  Apps built with Lovable, Bolt, v0 and similar tools rarely use plain HTML form fields: their selects
                  are buttons, their forms open in dialogs, and their errors arrive as toasts. Since 0.4.0,
                  discovery handles them, and Fernway, a test app built the same way, keeps it honest.
                </p>
                <h3>What discovery finds</h3>
                <ul>
                  <li>
                    Native inputs, selects, text areas, checkboxes and radio buttons, inside a <code>&lt;form&gt;</code>{" "}
                    or not, and the buttons and controls outside the forms.
                  </li>
                  <li>
                    Custom widgets from Radix and shadcn/ui, Headless UI, cmdk and MUI: selects, comboboxes, checkboxes,
                    switches, radio groups and sliders. They are set the way a person sets them, in the checks and in
                    the exported Playwright tests.
                  </li>
                  <li>
                    Forms in dialogs and sheets. It tries up to 3 controls that look like they open one (&ldquo;Add
                    member&rdquo;, or <code>aria-haspopup=&quot;dialog&quot;</code>), never a link to another page or a
                    control that looks destructive, and blocks every write while it looks: every request except GET,
                    HEAD and OPTIONS, and every WebSocket message. The form&apos;s scenarios open the dialog first.
                  </li>
                  <li>
                    Required fields marked only in their label (&ldquo;Email *&rdquo;, &ldquo;(required)&rdquo;), as
                    forms built with react-hook-form and zod often are, and fields the page itself refuses when left
                    empty.
                  </li>
                  <li>
                    Toasts such as sonner&apos;s count as announced messages, and a toast is never taken for a saved
                    record. Ids that frameworks number on every load (React <code>useId</code>, <code>radix-…</code>)
                    are never used as selectors.
                  </li>
                </ul>
              </div>
              <Figures items={aiBuiltFigures} />
              <div className="prose-night">
                <h3>What it doesn&apos;t cover yet</h3>
                <ul>
                  <li>
                    Multi-step forms: only the first step is tested. When submitting it shows the next step without
                    saving, the checks that need a saved record skip with a &ldquo;multi-step form&rdquo; note.
                  </li>
                  <li>
                    A form that opens some other way (from a menu item, a command palette, a second dialog or on hover),
                    or behind more than 3 likely controls, isn&apos;t found. Per page, up to 5 forms are tested and up to
                    40 controls outside them are found, of which 20 are clicked.
                  </li>
                  <li>
                    Widgets from other libraries, or custom ones without the usual ARIA roles, may not be recognised
                    as fields.
                  </li>
                  <li>
                    Anything inside a canvas, a closed shadow root or a frame from another site (an embedded payment
                    form, for example) can&apos;t be seen.
                  </li>
                </ul>
              </div>
            </DocSection>

            <DocSection id="problems" step="09" title="Common problems">
              <dl className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line bg-surface">
                {problems.map((p) => (
                  <div key={p.see} className="flex flex-col gap-1.5 px-5 py-4">
                    <dt className="font-mono text-[13px] text-fg [overflow-wrap:anywhere]">{p.see}</dt>
                    <dd className="text-[15px] leading-relaxed text-muted">{p.means}</dd>
                  </div>
                ))}
              </dl>
            </DocSection>

            <DocSection id="ai" step="10" title="AI (optional)">
              <div className="prose-night">
                <p>
                  Since 0.3.0, and <strong>off until you turn it on</strong>. Bring your own model: Ollama, LM Studio,
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
                    Open <strong>Settings → AI</strong>, turn on <strong>Use AI</strong> and pick a provider. In a
                    container, change the base URL to <code>http://host.docker.internal:11434/v1</code> for Ollama on
                    your machine (Podman: <code>host.containers.internal</code>; see Docker or Podman below). Choose a
                    model from the dropdown (it lists what the server has; <strong>Other…</strong> takes any id), press{" "}
                    <strong>Save</strong>, then <strong>Test connection</strong> (it tests the saved settings).
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
              <Figures items={aiFigures} />
              <div className="prose-night">
                <h3>Command line</h3>
                <p>
                  From source, in <code>app/</code>. In a container the same commands follow the image name, for example{" "}
                  <code>docker run --rm --network host {site.imageName} ai status</code>.
                </p>
              </div>
              <CodeBlock label="AI from the command line, from source">{aiCli}</CodeBlock>
              <div className="prose-night">
                <p>
                  Settings come from the Settings page (saved to <code>~/.config/run-hound/ai.json</code>, mode 0600, or
                  to <code>RUNHOUND_CONFIG_DIR</code> when it is set). <code>RUNHOUND_AI_*</code> environment variables
                  override the saved settings, and <code>--ai*</code> flags override both. The full list is in{" "}
                  <a href={site.aiSpec}>docs/ai-spec.md</a> and <a href={site.envExample}>.env.example</a>.
                </p>
                <h3>Docker or Podman</h3>
                <p>
                  The easiest way is the Settings page: in a container, what you save there is kept in{" "}
                  <code>./runs/.config</code> on your machine (the image sets <code>RUNHOUND_CONFIG_DIR</code> to
                  that folder). Or pass the <code>RUNHOUND_AI_*</code> variables to <code>docker run</code> with{" "}
                  <code>-e</code>, or put them in the <code>.env</code> next to the compose file. The Ollama address depends on how the
                  container reaches your machine: with <code>--network host</code> on Linux it is{" "}
                  <code>http://127.0.0.1:11434/v1</code>; otherwise it is <code>host.docker.internal</code> (Docker) or{" "}
                  <code>host.containers.internal</code> (Podman), and Ollama must listen on all interfaces (
                  <code>OLLAMA_HOST=0.0.0.0 ollama serve</code>). A key you save there sits in{" "}
                  <code>./runs/.config/ai.json</code>, so share a single <code>runs/&lt;runId&gt;</code> folder, never
                  the whole runs folder.
                </p>
              </div>
              <CodeBlock label=".env">{aiDocker}</CodeBlock>
              <div className="prose-night">
                <h3>What is sent</h3>
                <ul>
                  <li>
                    Only <strong>redacted page structure</strong>: the page title and path (a local model also gets the
                    redacted address with its query), field labels and types, option labels, button names and the
                    scenario list. On a signed-in run, the test accounts&apos; usernames and secrets are hidden too. Explanations also get each finding&apos;s text and
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
                  with thinking turned off; with other servers, prefer a non-reasoning model or turn reasoning off. Each
                  request may take 2 minutes; an explanation that times out is tried once more, and after two timeouts
                  in a row the rest are skipped with a warning. For a slow model, raise{" "}
                  <code>RUNHOUND_AI_TIMEOUT_MS</code>.
                </p>
              </div>
            </DocSection>

            <DocSection id="report" step="11" title="Reading the report">
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
                  <strong>2</strong> on an error: a refused or unreachable target, an error page (such as a 404), a
                  bad option, <code>--ai</code> when the model can&apos;t be used, <code>--as</code> with an account
                  that isn&apos;t set up or can&apos;t sign in, or a run in which nothing was tested. That makes it a CI
                  step as it is; <code>--json</code> puts the report on stdout.
                </p>
                <h3>Also in the report</h3>
                <ul>
                  <li>
                    <strong>Scenarios</strong>: every scenario under its group with its result, time and notes, the
                    ones you didn&apos;t approve, and checks that had nothing to test on your page.
                  </li>
                  <li>
                    <strong>Pages tested</strong>: every URL the run loaded. If your URL redirected to a login page, the
                    run tested that page instead: plan it signed in with a <a href="#accounts">test account</a>.
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

            <DocSection id="checks" step="12" title={`The ${checkTotal} checks`}>
              <div className="prose-night">
                <p>
                  The plan, the run, the progress and the report all follow the same three groups. Form checks are
                  planned once for each form on the page; page-wide checks are planned once for the whole page. The
                  checks tagged {site.preview} arrived in 0.4.0; access-control and mass-assignment are planned
                  only on a <a href="#accounts">signed-in run</a>. Scenarios that don&apos;t apply to your page (no
                  form, no password field, no JSON save request) are <strong>skipped with a plain reason</strong>, never
                  silently dropped.
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
                              {c.since === "V2" ? <NewTag>{site.preview}</NewTag> : null}
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
                          {c.signedIn ? (
                            <p className="text-sm leading-relaxed text-dim">
                              Signed-in runs only{c.offByDefault ? "; unticked until you tick it" : ""}.
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

            <DocSection id="safety" step="13" title="Safety and test records">
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
                    The web UI answers only to loopback names and addresses, the host of{" "}
                    <code>RUNHOUND_PUBLIC_URL</code> and the address given to <code>serve --host</code>; add others with{" "}
                    <code>RUNHOUND_SERVER_HOSTS</code>. Don&apos;t expose it to your network: anyone who can reach it can
                    start runs.
                  </li>
                  <li>
                    Test accounts must be yours, on an app you may test, and their sign-in page must pass the same
                    local-only check as a target. Their passwords, sessions and usernames are hidden in everything a run
                    writes (see <a href="#accounts">Test accounts</a>).
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
                    pass <code>--allow-destructive</code> or tick the option in the UI. A signed-in run never signs out
                    and never submits a form that sets a password, even then.
                  </li>
                  <li>
                    <code>mass-assignment</code> changes account A&apos;s data on purpose, so it is unticked until you tick
                    it. It puts back what it changed and says in the report what it couldn&apos;t (a field that
                    wasn&apos;t there before can&apos;t be removed).
                  </li>
                </ul>
                <h3>Test records it creates</h3>
                <p>
                  A full run sends each form successfully several times (about 7 or 8 save requests per form), so it
                  can create that many records in your app. The values are obviously fake (emails at <code>example.test</code>, a
                  run token in the text), and the report says how many save requests your app accepted, and on a
                  signed-in run which account they belong to.{" "}
                  <strong>Run Hound never deletes them. Point it at a development database you can throw away.</strong>
                </p>
                <p>
                  See also the <Link href="/acceptable-use">acceptable use policy</Link> and{" "}
                  <Link href="/security">security</Link>.
                </p>
              </div>
            </DocSection>

            <DocSection id="limitations" step="14" title="Known limitations">
              <div className="prose-night">
                <ul>
                  <li>
                    <strong>One page at a time.</strong> Up to 5 forms are tested and up to 20 controls outside them
                    clicked; links are opened only to check they load. A page behind a login needs a{" "}
                    <a href="#accounts">test account</a>; signed out, a page that redirects to a login screen gets the
                    login form tested instead (check Pages tested).
                  </li>
                  <li>
                    <strong>Sign-in</strong> works with the app&apos;s own form and a password only: not with Google or
                    another provider, magic links, one-time codes or captchas. The access checks read data; whether one
                    account can change another&apos;s is planned.
                  </li>
                  <li>
                    <strong>Apps from AI builders</strong>: multi-step forms are tested on their first step only, and a
                    form that opens some other way than a likely button isn&apos;t found. See{" "}
                    <a href="#ai-built">Apps from AI builders</a>.
                  </li>
                  <li>
                    <strong>Dev servers don&apos;t send production headers.</strong> Header, cookie and CORS findings on
                    a dev server are advisory. For confirmed results, test a production build served on your machine.
                  </li>
                  <li>
                    <strong>Unusual apps</strong> may still produce false findings. It has been tried on classic HTML
                    forms that post and redirect, fetch-based single-page apps, login forms, forms whose API is on
                    another origin and an app built the way AI builders build them (Fernway), but not on your stack.
                    That&apos;s what your feedback is for.
                  </li>
                  <li>
                    <strong>Development overlays</strong> (Next.js dev tools, Vite&apos;s error overlay) are part of the
                    page in development; if a finding points at one, tell us.
                  </li>
                  <li>
                    <strong>Docker</strong>: no visible browser window (<code>--headed</code> needs the install from
                    source on a machine with a display); the web UI&apos;s live view works.
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

            <DocSection id="feedback" step="15" title="Sending feedback">
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
                    <strong>Your OS and how you ran it</strong>: Docker (compose or single container) or from source, web
                    UI or command line, signed in or not, Node version.
                  </li>
                  <li>
                    <strong>What you tested</strong>: the framework, the dev server and what the form does (not the URL,
                    if it&apos;s private).
                  </li>
                  <li>
                    <strong>The report</strong>: <code>report.md</code>, or the run folder zipped (one{" "}
                    <code>runs/&lt;runId&gt;</code> folder, never the whole runs folder, which holds your settings).{" "}
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
