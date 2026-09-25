import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, GitHubIcon } from "@/components/button-link";
import { Card, PageHeader, Section } from "@/components/layout";
import { RoadmapList, type RoadmapStage } from "@/components/oss/roadmap-list";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Open source",
  description:
    "Run Hound is open source in a public GitHub repository, with every check in the core and an Apache-2.0 license planned. See the roadmap, the Kennel test fixture, how to contribute and the privacy promise.",
};

const openCore: { core: string; later: string }[] = [
  {
    core: "The agent loop and all checks: functional, accessibility and security",
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
    core: "The Kennel test fixture, the sample apps and their scoring",
    later: "Compliance exports: WCAG and European Accessibility Act conformance reports",
  },
  {
    core: "JSON run format and replay",
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
      "Point it at a form on localhost. It plans golden- and danger-path scenarios in three groups (Accessibility, Features, Security), you approve them, it runs them and reports with evidence, timings and exported Playwright tests.",
    adds: "15 checks. Shipped as 0.1.0.",
  },
  {
    version: "V1",
    name: "Single page",
    status: "current",
    release: "0.2.0 · 0.3.0",
    summary:
      "Point it at a page. It finds every form and interactive control on it, plans form checks for each form plus page-wide checks, you approve, and it runs them in a real browser. Local only.",
    adds: "0.2.0 adds security headers, cookie flags, CORS, public source maps and dead controls across the whole page: 20 checks, and one Docker or Podman command starts it with Kennel and the sample apps. 0.3.0 (current) adds optional AI with your own model: plan review, up to 5 suggested flows and explanations. Off by default, and never the judge of pass or fail.",
  },
  {
    version: "V2",
    name: "Single feature",
    status: "planned",
    summary: "Give it a feature such as signup or checkout and it tests that feature end to end across pages.",
    adds: "Headline: access checks with two test accounts you own, to confirm one user cannot reach another user's data.",
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

const kennelScoring = [
  { name: "Recall", body: "Planted bugs found out of planted bugs enabled, tracked per bug." },
  { name: "False positives", body: "Findings in clean mode, where every bug is fixed properly. Target: zero." },
  { name: "Stability", body: "The same run repeated five times gives the same findings." },
  { name: "Evidence", body: "Every finding has a screenshot or request and response, and a replayable spec." },
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
          {site.release} ({site.releaseName.toLowerCase()}, {site.version}) is an open-source preview. The{" "}
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
        intro="The core is planned to be released under the Apache License 2.0."
      >
        <Card className="flex max-w-3xl flex-col gap-3">
          <p className="font-mono text-xs tracking-widest text-accent">PLANNED · {site.license.toUpperCase()}</p>
          <p className="text-lg leading-relaxed">
            In one line: you can use, change and ship it, including commercially, as long as you keep the license and
            notices; it also includes a patent grant.
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
        intro="Each stage widens what Run Hound can test, from one form to a whole app. V0 has shipped, V1 is current (0.3.0, with optional AI), and V2 onward is planned: whole features, the whole app and live staging."
      >
        <RoadmapList stages={roadmap} />
      </Section>

      <Section
        id="kennel"
        title="Test fixture: Kennel"
        intro="Run Hound is developed and scored against Kennel, a small, deliberately broken pet-sitting booking app on a local Supabase. Every planted bug sits behind its own toggle, and a clean mode fixes them all properly."
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
          See every planted bug in the{" "}
          <a href={`${site.github}/blob/main/docs/fixtures.md`} className={externalLink}>
            fixture document
          </a>
          .
        </p>
      </Section>

      <Section id="contributing" title="Contributing">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">Issues and discussions</h3>
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
              with Node or in your Docker. AI is optional and off by default; turn it on and only redacted page
              structure goes to the model you choose, local or cloud. Run Hound operates no AI service of its own.
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
