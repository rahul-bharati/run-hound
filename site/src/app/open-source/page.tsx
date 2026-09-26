import Link from "next/link";
import { ButtonLink, GitHubIcon } from "@/components/button-link";
import { Card, PageHeader, Section } from "@/components/layout";
import { RoadmapList, type RoadmapStage } from "@/components/oss/roadmap-list";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  path: "/open-source/",
  title: "Open source",
  description:
    "Run Hound is open source under the MIT license, every check included. The roadmap, the test apps it is scored against, and how to contribute.",
});

const openCore: { core: string; later: string }[] = [
  {
    core: "The test engine and all checks: functional, accessibility and security",
    later: "Hosted inference: run without a GPU, Ollama or your own model API key",
  },
  {
    core: "Plan approval UI, reports and Playwright spec export",
    later: "Hosted runner: test a deployed app behind domain-ownership verification",
  },
  {
    core: "Bring your own model (optional, off by default): local via Ollama, LM Studio, llama.cpp or vLLM, or any OpenAI-compatible endpoint or Amazon Bedrock",
    later: "Team dashboard: run history, trends and regressions across runs",
  },
  {
    core: "CLI, local web UI and Docker or Podman set-up; localhost, with domain verification planned",
    later: "CI / GitHub app: pull request comments and scheduled regression runs",
  },
  {
    core: "The test apps (Kennel, Fernway and the sample apps) and their scoring",
    later: "Compliance exports: WCAG and European Accessibility Act conformance reports",
  },
  {
    core: "The JSON report format (report.json)",
    later: "Organisation features: SSO, roles, audit log, priority support",
  },
];

const roadmap: RoadmapStage[] = [
  {
    version: "V0",
    name: "Single form",
    status: "shipped",
    release: "0.1.0",
    summary:
      "Point it at a form on localhost. It plans golden- and danger-path scenarios, you approve them, it runs them and reports with evidence and exported Playwright tests.",
    adds: "15 checks. Shipped as 0.1.0.",
  },
  {
    version: "V1",
    name: "Single page",
    status: "current",
    release: `0.2.0 – ${site.version}`,
    summary:
      "Point it at a page. It finds the forms and controls on it, plans form checks for each form plus page-wide checks, you approve, and it runs them in a real browser. Local only.",
    adds: `0.2.0 adds security headers, cookie flags, CORS, public source maps and dead controls across the whole page, and one Docker or Podman command starts it with the test apps. 0.3.0 adds optional AI with your own model: plan review, up to 5 suggested flows and explanations, off by default and never the judge of pass or fail. 0.4.0 finds and fills the custom widgets and dialog forms of AI-built apps.`,
  },
  {
    version: "V2",
    name: "Single feature",
    status: "preview",
    release: site.version,
    summary: "Give it a feature such as signup or checkout and it tests that feature end to end across pages.",
    adds: `A preview ships in 0.4.0: test accounts and signed-in runs, access checks (can another account, or a visitor who isn't signed in, read your data?), mass assignment and deep links. 0.5.0 adds the write-side checks: can another account or a visitor change your data, can another website (CSRF), and can a paid plan be had without paying? Still planned: testing a feature across pages, rate limits, file uploads and prompt injection.`,
  },
  {
    version: "V3",
    name: "Whole app",
    status: "planned",
    summary:
      "Point it at the app. It discovers and prioritises features, then tests the paths that give the most value first.",
    adds: "Adds a dead-link crawl, cross-browser runs, Core Web Vitals, SEO and social previews.",
  },
  {
    version: "V4",
    name: "Live staging",
    status: "planned",
    summary: "Support for testing live staging and dev sites behind ownership verification.",
    adds: "Adds checks for live hosts, such as mixed content and email DNS records.",
  },
];

// What CI scores on every pull request (docs/fixtures.md "Scoring"); stability across repeated runs is planned.
const kennelScoring = [
  { name: "Recall", body: "With each planted bug switched on alone, the check that must catch it reports it." },
  { name: "False positives", body: "Findings in clean mode, where every bug is fixed properly. Target: zero." },
  { name: "Evidence", body: "Every finding has a screenshot, a GIF or a request card on disk, and no run leaks a secret." },
  { name: "Stability (planned)", body: "Repeating the same run to check the findings stay the same, tracked per bug." },
];

const externalLink = "text-accent underline underline-offset-4 hover:text-accent-strong";

export default function OpenSourcePage() {
  return (
    <>
      <PageHeader
        eyebrow="OPEN SOURCE"
        title={
          <>
            Open source, <span className="text-accent">every check included.</span>
          </>
        }
        lede="Finding the holes is the whole point, so no check will ever sit behind a paywall. The code is public on GitHub: clone it, try it, file issues."
      >
        <p className="max-w-2xl text-[15px] leading-relaxed text-dim">
          {site.name} {site.version} is released under the MIT license. The{" "}
          <a href={site.github} className={externalLink}>
            repository
          </a>{" "}
          is public: anyone can clone it, try it and{" "}
          <a href={site.feedback} className={externalLink}>
            file an issue
          </a>
          .
        </p>
      </PageHeader>

      <Section
        id="license"
        title="License"
        intro="Run Hound is released under the MIT License."
      >
        <Card className="flex max-w-3xl flex-col gap-3">
          <p className="font-mono text-xs tracking-widest text-accent">IN EFFECT · {site.license.toUpperCase()}</p>
          <p className="text-lg leading-relaxed">
            In one line: you can use, copy, modify, distribute and sell it, as long as you keep the copyright and
            license notice; it comes with no warranty.
          </p>
          <p className="text-[15px] leading-relaxed text-dim">
            The full text is in the{" "}
            <a href={site.licenseUrl} className={externalLink}>
              LICENSE file
            </a>{" "}
            in the repository.
          </p>
        </Card>
      </Section>

      <Section
        id="open-core"
        title="Every check is in the core"
        intro="Everything one developer needs to test their own app is free and open source. Paid services are possible later, only if there is demand, and only for things that run on our servers."
        className="bg-band"
      >
        <div
          role="region"
          aria-labelledby="open-core-caption"
          tabIndex={0}
          className="overflow-x-auto rounded-2xl border border-line bg-surface"
        >
          <table className="w-full min-w-[36rem] border-collapse text-left text-[15px]">
            <caption id="open-core-caption" className="sr-only">
              Open core compared with possible later hosted services
            </caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-1/2 px-5 py-4 align-bottom sm:px-7">
                  <span className="block font-mono text-xs tracking-widest text-accent">OPEN CORE · FREE</span>
                  <span className="mt-1 block font-display text-lg font-bold">In the open-source core</span>
                </th>
                <th scope="col" className="w-1/2 px-5 py-4 align-bottom sm:px-7">
                  <span className="block font-mono text-xs tracking-widest text-dim">POSSIBLE, LATER</span>
                  <span className="mt-1 block font-display text-lg font-bold">
                    Hosted services, only if there is demand
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {openCore.map((row) => (
                <tr key={row.core} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-4 align-top leading-relaxed sm:px-7">{row.core}</td>
                  <td className="px-5 py-4 align-top leading-relaxed text-muted sm:px-7">{row.later}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-3xl leading-relaxed text-muted">
          None of the hosted services exist. If they are ever built, they would be unlocked with an API key passed to
          the container, and without a key the core runs fully. Read the full reasoning in the{" "}
          <a href={`${site.github}/blob/main/docs/business-model.md`} className={externalLink}>
            business model document
          </a>
          .
        </p>
      </Section>

      <Section
        id="roadmap"
        title="Roadmap"
        intro={`Each stage widens what Run Hound can test, from one form to a whole app. V0 has shipped, V1 is current, and 0.4.0 and 0.5.0 add a preview of V2: signed-in runs, access checks and write-side checks. The rest of V2, the whole app and live staging are planned.`}
      >
        <RoadmapList stages={roadmap} />
      </Section>

      <Section
        id="kennel"
        title="Test apps: Kennel and Fernway"
        intro="Run Hound is developed and scored against test apps that ship in the repository and run on your machine: Kennel, a small, deliberately broken pet-sitting booking app, and Fernway, a project-planning app built the way AI builders such as Lovable build them, with a dashboard behind a sign-in. Every planted bug sits behind its own toggle, and a clean mode fixes them all properly."
        className="bg-band"
      >
        <p className="max-w-3xl leading-relaxed text-muted">
          Because we know exactly which bugs are planted, we can measure what Run Hound finds, what it misses and what
          it makes up. Made-up findings are the biggest product risk, so clean mode matters as much as the planted bugs.
        </p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kennelScoring.map((item) => (
            <li key={item.name}>
              <Card className="h-full">
                <h3 className="font-display text-lg font-bold">{item.name}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{item.body}</p>
              </Card>
            </li>
          ))}
        </ul>
        <p className="leading-relaxed text-muted">
          See every planted bug in{" "}
          <a href={site.kennelBugs} className={externalLink}>
            Kennel&apos;s bug list
          </a>{" "}
          and{" "}
          <a href={site.fernwayBugs} className={externalLink}>
            Fernway&apos;s
          </a>
          . Five sample apps, built well on purpose, complete the set: any confirmed finding on them is a false positive.
        </p>
      </Section>

      <Section id="contributing" title="Contributing">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">Issues and feedback</h3>
            <p className="leading-relaxed text-muted">
              Anyone can file feedback and bugs with the issue forms on GitHub. Tell us which holes you keep finding in
              AI-built apps; that shapes the checks.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <ButtonLink href={site.github} variant="secondary">
                <GitHubIcon />
                View on GitHub
              </ButtonLink>
              <ButtonLink href={site.feedback} variant="ghost">
                Send feedback
              </ButtonLink>
            </div>
          </Card>
          <Card className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">Code contributions</h3>
            <p className="leading-relaxed text-muted">
              Contribution guidelines are coming. We will decide between a Contributor License Agreement (CLA) and a
              Developer Certificate of Origin (DCO) before accepting the first outside contribution, and document it
              in the repository.
            </p>
          </Card>
        </div>
      </Section>

      <Section id="privacy" title="Privacy promise" className="bg-band">
        <Card className="flex max-w-3xl flex-col gap-4">
          <ul className="flex list-disc flex-col gap-3 pl-5 leading-relaxed text-muted marker:text-dim">
            <li>
              <strong className="font-semibold text-fg">It runs locally.</strong> Run Hound runs on your machine,
              with Node or in Docker or Podman. AI is optional and off by default; turn it on and only redacted page
              structure and finding text go to the model you choose, local or cloud. Run Hound operates no AI service
              of its own. Test accounts stay on your machine too, and their passwords never appear in a report.
            </li>
            <li>
              <strong className="font-semibold text-fg">No telemetry about the app you test.</strong> Nothing about
              your app, its pages or its findings is sent to us.
            </li>
            <li>
              <strong className="font-semibold text-fg">Paid features would not change this.</strong> If a license
              key ever exists, its check would send only the key and version.
            </li>
          </ul>
          <p className="text-[15px] leading-relaxed text-dim">
            More detail in the <Link href="/privacy" className={externalLink}>privacy policy</Link>.
          </p>
        </Card>
      </Section>
    </>
  );
}
