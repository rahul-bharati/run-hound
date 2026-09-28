import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";
import { CodeText } from "@/components/oss/code-text";
import { opensOn } from "@/components/oss/opens";
import { PageIntro } from "@/components/oss/page-intro";
import { ProjectBand } from "@/components/oss/project-band";
import { RoadmapList } from "@/components/oss/roadmap-list";
import { Card } from "@/components/primitives/card";
import { ArrowLink, TextLink } from "@/components/primitives/links";
import {
  changelogLink,
  howToHelp,
  licenseLine,
  maintainer,
  openCore,
  openSourceIntro,
  openSourceJsonLd,
  openSourceSections,
  privacyPromise,
  roadmap,
  roadmapNote,
  scoring,
  securityLine,
  stability,
  testApps,
  type OssLink,
} from "@/content/open-source";
import { routeMetadata } from "@/lib/metadata";

export const metadata = routeMetadata("open-source");

/** A standalone link at the foot of a block: an ArrowLink with a 36 px row, so it is an easy target (WCAG 2.5.8). */
function FootLink({ link }: { link: OssLink }) {
  return (
    <ArrowLink href={link.href} opens={opensOn(link.href)} className="inline-flex min-h-target-row items-center">
      {link.label}
    </ArrowLink>
  );
}

/** A plain list with dim bullets, for the open core's two columns and the maintainer's "how it is built". */
function Bullets({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-muted marker:text-dim">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function OpenSourcePage() {
  const total = openSourceSections.length;
  // Each band names its id literally (other pages and content/trust.test.ts look for it); its heading, intro and place
  // in the band index come from the section list, whose order open-source.test.ts checks against the rendered page.
  const band = (id: string) => {
    const at = openSourceSections.findIndex((s) => s.id === id);
    const s = openSourceSections[at];
    return { headingId: s.headingId, title: s.title, intro: s.intro, index: { n: at + 1, total } };
  };

  return (
    <>
      <JsonLd data={openSourceJsonLd()} />
      <PageIntro id="open-source" title={openSourceIntro.title} lede={openSourceIntro.lede} />

      <ProjectBand id="license" {...band("license")}>
        <p className="max-w-measure text-body text-muted">
          {licenseLine.text}{" "}
          <TextLink href={licenseLine.link.href} opens="GitHub">
            {licenseLine.link.label}
          </TextLink>
          .
        </p>
      </ProjectBand>

      <ProjectBand id="open-core" {...band("open-core")}>
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          {[openCore.core, openCore.later].map((column) => (
            <Card key={column.title} className="flex flex-col gap-4">
              <h3 className="text-title text-fg">{column.title}</h3>
              <Bullets items={column.items} />
            </Card>
          ))}
        </div>
        <p className="mt-6 max-w-measure text-body text-muted">{openCore.note}</p>
        <p className="mt-4">
          <FootLink link={openCore.link} />
        </p>
      </ProjectBand>

      <ProjectBand id="roadmap" {...band("roadmap")}>
        <p className="mb-6 max-w-measure text-body text-muted">
          <CodeText text={roadmapNote} />
        </p>
        <RoadmapList stages={roadmap} />
      </ProjectBand>

      <ProjectBand id="kennel" {...band("kennel")}>
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          {testApps.apps.map((app) => (
            <Card key={app.name} className="flex flex-col gap-2">
              <h3 className="text-title text-fg">{app.name}</h3>
              <p className="text-body text-muted">{app.text}</p>
              <FootLink link={app.link} />
            </Card>
          ))}
        </div>
        <p className="mt-8 max-w-measure text-body text-muted">{testApps.why}</p>
        <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          {scoring.map((item) => (
            <div key={item.name} className="flex flex-col gap-1 border-t border-line-soft pt-4">
              <dt className="text-small font-semibold text-fg">{item.name}</dt>
              <dd className="text-small text-muted">{item.text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-measure text-body text-muted">{testApps.samples}</p>
        <p className="mt-4">
          <FootLink link={testApps.demo} />
        </p>
      </ProjectBand>

      <ProjectBand id="stability" {...band("stability")}>
        <dl className="grid gap-4 lg:grid-cols-3 lg:gap-6">
          {stability.map((item) => (
            <div key={item.title} className="card flex flex-col gap-2">
              <dt className="text-title text-fg">{item.title}</dt>
              <dd className="text-body text-muted">{item.text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4">
          <FootLink link={changelogLink} />
        </p>
      </ProjectBand>

      <ProjectBand id="maintainer" {...band("maintainer")}>
        <Card className="flex max-w-heading flex-col gap-4">
          <p className="text-lead text-fg">
            Run Hound is made by{" "}
            <TextLink href={maintainer.github} opens="GitHub">
              {maintainer.name}
            </TextLink>
            .
          </p>
          <p className="text-body text-muted">{maintainer.why}</p>
          <h3 className="text-title text-fg">How it is built</h3>
          <Bullets items={maintainer.how} />
          <FootLink link={{ label: maintainer.decisionsLabel, href: maintainer.decisions }} />
        </Card>
      </ProjectBand>

      <ProjectBand id="contributing" {...band("contributing")} tone="band">
        <ul className="grid gap-4 lg:grid-cols-3 lg:gap-6">
          {howToHelp.map((card) => (
            <Card as="li" key={card.title} className="flex flex-col gap-2">
              <h3 className="text-title text-fg">{card.title}</h3>
              <p className="text-body text-muted">{card.text}</p>
              <div className="mt-auto flex flex-col pt-2">
                {card.links.map((link) => (
                  <FootLink key={link.href} link={link} />
                ))}
              </div>
            </Card>
          ))}
        </ul>
        <p className="mt-6 text-body text-muted">
          {securityLine.text}{" "}
          <TextLink href={securityLine.link.href}>{securityLine.link.label}</TextLink>.
        </p>
      </ProjectBand>

      <ProjectBand id="privacy" {...band("privacy")}>
        <ul className="flex max-w-measure list-disc flex-col gap-3 pl-5 text-body text-muted marker:text-dim">
          {privacyPromise.items.map((item) => (
            <li key={item.lead}>
              <strong className="font-semibold text-fg">{item.lead}</strong> {item.text}
            </li>
          ))}
        </ul>
        <p className="mt-4">
          <FootLink link={privacyPromise.link} />
        </p>
      </ProjectBand>
    </>
  );
}
