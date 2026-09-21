import type { Metadata } from "next";
import Link from "next/link";
import { CommandCopy } from "@/components/command-copy";
import { Callout } from "@/components/docs/callout";
import { DocSection } from "@/components/docs/doc-section";
import { DocsToc } from "@/components/docs/toc";
import { FindingDetail, SeverityLabel, type Severity } from "@/components/finding";
import { Container, PageHeader } from "@/components/layout";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Get started",
  description:
    "The planned steps to run Run Hound locally with Docker and your own model, approve a test plan and read the report. Pre-release: nothing is published yet.",
};

const toc = [
  { id: "requirements", label: "Requirements" },
  { id: "install", label: "Install and run" },
  { id: "model", label: "Choose a model" },
  { id: "first-run", label: "Your first run" },
  { id: "report", label: "Reading the report" },
  { id: "safety", label: "Safety" },
  { id: "repo-docs", label: "Project docs" },
] as const;

const severities: { level: Severity; meaning: string }[] = [
  { level: "critical", meaning: "Data or money is at risk right now, for example a secret key shipped to every visitor." },
  { level: "high", meaning: "A core flow is broken or a group of people cannot use it, for example a form that fails silently." },
  { level: "medium", meaning: "Real harm in some situations, for example session cookies missing security flags." },
  { level: "low", meaning: "Worth fixing when you are nearby; rarely blocks anyone." },
];

const repoDocs = [
  {
    href: `${site.github}/blob/main/docs/research.md`,
    title: "Research",
    body: "Market need, the full gap catalog with severity and detectability, and how it maps to the roadmap.",
  },
  {
    href: `${site.github}/blob/main/docs/fixtures.md`,
    title: "Test fixture: Kennel",
    body: "The deliberately broken app Run Hound is scored against, with every planted bug listed.",
  },
  {
    href: `${site.github}/blob/main/docs/business-model.md`,
    title: "Business model",
    body: "What stays open source (every check), licensing, and the possible paid hosted services.",
  },
];

const modelEnv = `# Planned variable names. They may change before release.

# Local model through Ollama
RUNHOUND_MODEL_PROVIDER=ollama
RUNHOUND_MODEL=<model name>
OLLAMA_BASE_URL=<your Ollama address>

# AWS Bedrock
RUNHOUND_MODEL_PROVIDER=bedrock
RUNHOUND_MODEL=<model id>
AWS_REGION=<region>

# Any OpenAI-compatible endpoint
RUNHOUND_MODEL_PROVIDER=openai-compatible
RUNHOUND_MODEL=<model name>
RUNHOUND_BASE_URL=<endpoint URL>
RUNHOUND_API_KEY=<your key>`;

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="DOCS · PRE-RELEASE"
        title="Get started"
        lede="How you will run Run Hound on your own machine: start the container, connect a model, approve a test plan, and read a report with proof."
      >
        <Callout label="Pre-release" title="Run Hound isn't released yet." className="max-w-3xl">
          <p>
            These are the planned steps; follow progress on{" "}
            <a
              href={site.github}
              className="text-amber underline underline-offset-4 hover:text-fg"
            >
              GitHub
            </a>
            . V0 (testing a single form on localhost) is in progress. The Docker image is not published, so the
            commands below will not work yet, and names, ports and options may change.
          </p>
        </Callout>
      </PageHeader>

      <Container className="pb-24">
        <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <DocsToc items={toc} />

          <div className="flex min-w-0 max-w-3xl flex-col gap-20">
            <DocSection id="requirements" step="01" title="Requirements">
              <div className="prose-night">
                <p>Run Hound runs entirely on your machine. You need two things:</p>
                <ul>
                  <li>
                    <strong>Docker.</strong> Run Hound ships as a single container that includes the browser
                    (Playwright), the checks and the local web UI.
                  </li>
                  <li>
                    <strong>A model you bring.</strong> Either a local model through{" "}
                    <strong>Ollama</strong>, or a cloud model through <strong>AWS Bedrock</strong> or any{" "}
                    <strong>OpenAI-compatible endpoint</strong>. The model plans and explains; it never decides
                    whether a check passed.
                  </li>
                </ul>
                <p>
                  And, of course, an app to test. For V0 that is a form running on <code>localhost</code>. Recommended
                  models and hardware will be published with the first release.
                </p>
              </div>
            </DocSection>

            <DocSection id="install" step="02" title="Install and run">
              <div className="prose-night">
                <p>Pull and start the container with one command (planned image name):</p>
              </div>
              <CommandCopy command={site.dockerCommand} comingSoon />
              <div className="prose-night">
                <p>
                  Then open <code>http://localhost:4000</code> in your browser. That is the local Run Hound UI, where
                  you point it at your app, approve the plan and read reports. Nothing about your app is sent to Run Hound;
                  it only talks to the model you choose.
                </p>
                <p>
                  The exact setup for letting the container reach an app running on your machine will be documented
                  with the first release.
                </p>
              </div>
            </DocSection>

            <DocSection id="model" step="03" title="Choose a model">
              <div className="prose-night">
                <p>
                  You choose which model Run Hound talks to by passing environment variables to{" "}
                  <code>docker run</code> (with <code>-e NAME=value</code>). The names below are{" "}
                  <strong>planned placeholders</strong> and may change before release.
                </p>
                <pre tabIndex={0} role="region" aria-label="Planned model environment variables">
                  <code>{modelEnv}</code>
                </pre>
                <ul>
                  <li>
                    <strong>Ollama</strong> keeps everything on your machine. Good for private code and zero API cost.
                  </li>
                  <li>
                    <strong>Bedrock or an OpenAI-compatible endpoint</strong> uses your own account and key. Run Hound
                    reads the accessibility tree and the page structure first, and only sends screenshots for layout
                    and visual checks, which keeps requests small.
                  </li>
                </ul>
              </div>
            </DocSection>

            <DocSection id="first-run" step="04" title="Your first run">
              <div className="prose-night">
                <ol>
                  <li>
                    <strong>Point it at a form.</strong> Start your app locally and give Run Hound the address of a
                    page with a form, for example a signup or booking form on <code>http://localhost:3000</code>.
                  </li>
                  <li>
                    <strong>Let it explore.</strong> The agent opens the page in a headless browser and works out what
                    the form does.
                  </li>
                  <li>
                    <strong>Review and approve the plan.</strong> It proposes at least 10 scenarios: golden paths (the
                    form works as intended) and danger paths (empty, oversized or malformed input, double submit,
                    keyboard-only use, and more). Edit, remove or add scenarios. Nothing runs until you approve.
                  </li>
                  <li>
                    <strong>Run it.</strong> The approved scenarios run while screenshots, console logs and network
                    logs are captured at every step.
                  </li>
                  <li>
                    <strong>Read the report.</strong> Findings are grouped by feature and sorted by severity, each with
                    proof. See the next section.
                  </li>
                </ol>
                <p>
                  Want to see this without installing anything? The <Link href="/demo">demo</Link> will replay a
                  recorded run, and <Link href="/how-it-works">How it works</Link> walks through each stage.
                </p>
              </div>
            </DocSection>

            <DocSection id="report" step="05" title="Reading the report">
              <div className="prose-night">
                <p>
                  The report comes as HTML or Markdown. Every finding has a severity, a plain-language explanation,
                  evidence and a test you can re-run. <strong>No evidence, no finding:</strong> if Run Hound cannot
                  show it, it does not report it.
                </p>
                <h3>Severity</h3>
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
                <p>
                  Checks that rely on the model&apos;s judgement, such as whether alt text is useful, are marked{" "}
                  <strong>advisory</strong>. Pass and fail always come from deterministic checks: Playwright
                  assertions, axe-core rules and captured traffic.
                </p>
                <h3>What this means, why it matters, ask your AI</h3>
                <p>
                  Each finding is written for the person who has to fix it, including people who built the app with
                  an AI tool. The last part is a prompt you can paste straight into your AI coding tool.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <p className="font-mono text-xs tracking-widest text-dim">SAMPLE FINDING · ILLUSTRATIVE, NOT FROM A REAL RUN</p>
                <FindingDetail
                  category="Broken feature"
                  severity="high"
                  title="The form fails silently"
                  meaning="When saving fails, the form shows nothing, spins forever, or pretends it worked."
                  impact="People think they signed up or ordered when they didn't, and you lose them without ever knowing."
                  fix="“Handle every error from this form's request, including timeouts and offline, with a clear visible message that screen readers announce, and keep the user's input.”"
                  evidence="Sample evidence: screenshot, console log, network log, steps to reproduce"
                />
              </div>
              <div className="prose-night">
                <h3>Evidence</h3>
                <p>
                  Findings carry screenshots, the console and network logs from the failing step, and numbered steps to
                  reproduce. Any secrets found are redacted in the report.
                </p>
                <h3>Exported Playwright tests</h3>
                <p>
                  Every scenario is exported as a re-runnable <code>.spec.ts</code> file using role- and label-based
                  locators. It runs with plain Playwright, with no agent and no model, so you can reproduce the failure
                  and add it to CI.
                </p>
                <h3>Not visible from outside</h3>
                <p>
                  Some problems cannot be seen from a browser, such as backups, webhook signature checks or dependency
                  hygiene. Every report ends with a <strong>Not visible from outside</strong> checklist of these, so a
                  clean report is never mistaken for a clean app.
                </p>
              </div>
            </DocSection>

            <DocSection id="safety" step="06" title="Safety">
              <div className="prose-night">
                <p>Run Hound is built to test apps you own, and to be safe by default.</p>
                <ul>
                  <li>
                    <strong>Local targets only by default.</strong> <code>localhost</code> and private IP addresses are
                    allowed out of the box.
                  </li>
                  <li>
                    <strong>Other domains need proof of ownership.</strong> Before any other domain can be tested, you
                    verify it with a DNS TXT record or a nonce in a <code>&lt;meta&gt;</code> tag in the page head. The
                    run only goes ahead where the nonce is found.
                  </li>
                  <li>
                    <strong>Destructive actions are opt-in.</strong> Real payments, deleting data and similar actions
                    are off unless you explicitly turn them on.
                  </li>
                  <li>
                    <strong>Secrets are redacted.</strong> If a key turns up, the report redacts it. Keys are never used
                    or tested.
                  </li>
                </ul>
                <p>
                  See the <Link href="/acceptable-use">acceptable use policy</Link> and{" "}
                  <Link href="/security">security</Link> for more.
                </p>
              </div>
            </DocSection>

            <DocSection id="repo-docs" step="07" title="Project docs on GitHub">
              <div className="prose-night">
                <p>The design documents behind Run Hound live in the repository.</p>
              </div>
              <ul className="grid gap-4 sm:grid-cols-3">
                {repoDocs.map((doc) => (
                  <li key={doc.href}>
                    <a
                      href={doc.href}
                      className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-amber"
                    >
                      <span className="font-display text-lg font-bold group-hover:text-amber">{doc.title}</span>
                      <span className="text-[15px] leading-relaxed text-muted">{doc.body}</span>
                      <span className="mt-auto pt-2 font-mono text-xs tracking-widest text-dim">
                        GITHUB<span className="sr-only"> (opens the file on GitHub)</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </DocSection>
          </div>
        </div>
      </Container>
    </>
  );
}
