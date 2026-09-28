import { Check, Contrast, X } from "lucide-react";
import { CompareTable, Legend } from "@/components/compare/compare-table";
import { JsonLd } from "@/components/json-ld";
import { PageIntro } from "@/components/oss/page-intro";
import { ProjectBand } from "@/components/oss/project-band";
import { Card } from "@/components/primitives/card";
import { ArrowLink, TextLink } from "@/components/primitives/links";
import { Sprite } from "@/components/sprite";
import {
  capabilities,
  compareCaption,
  compareIntro,
  compareJsonLd,
  compareSections,
  notYet,
  notYetIntro,
  readMore,
  researchUrl,
  tools,
} from "@/content/compare";
import { routeMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = routeMetadata("compare");

export default function ComparePage() {
  const { glance, tools: toolsSection, notYet: notYetSection } = compareSections;
  return (
    <>
      <JsonLd data={compareJsonLd()} />
      {/* The table's three marks, drawn once and used by every cell (§2.9). */}
      <Sprite icons={{ yes: Check, some: Contrast, no: X }} />
      <PageIntro
        id="compare"
        title={compareIntro.title}
        lede={compareIntro.lede}
        meta={
          <>
            As of release {site.version} · <time dateTime={site.releasedIso}>{site.released}</time>
          </>
        }
      />

      <ProjectBand
        id={glance.id}
        title={glance.title}
        index={{ n: 1, total: 3 }}
        intro={
          <>
            {glance.intro}{" "}
            <TextLink href={researchUrl} opens="GitHub">
              {glance.research}
            </TextLink>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Legend />
          <p className="text-small text-dim xl:hidden">{glance.scrollHint}</p>
          <CompareTable capabilities={capabilities} tools={tools} caption={compareCaption} />
        </div>
      </ProjectBand>

      <ProjectBand id={toolsSection.id} title={toolsSection.title} intro={toolsSection.intro} index={{ n: 2, total: 3 }}>
        <ul className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          {tools.map((tool) => (
            <Card as="li" id={tool.id} key={tool.id} className="flex flex-col gap-4">
              <h3 className="font-display text-title font-bold text-fg">{tool.name}</h3>
              <p className="text-body text-muted">{tool.what}</p>
              <div className="flex flex-col gap-1">
                <p className="font-mono text-mono text-muted uppercase">Run Hound adds</p>
                <p className="text-body text-muted">{tool.adds}</p>
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-mono text-mono text-muted uppercase">Together</p>
                <p className="text-body text-muted">{tool.together}</p>
              </div>
              <p className="mt-auto text-small text-dim">
                {tool.sources.length > 1 ? "Sources: " : "Source: "}
                {tool.sources.map((source, i) => (
                  <span key={source.href}>
                    {i > 0 ? ", " : ""}
                    <TextLink href={source.href}>{source.label}</TextLink>
                  </span>
                ))}
              </p>
            </Card>
          ))}
        </ul>
      </ProjectBand>

      <ProjectBand id={notYetSection.id} title={notYetSection.title} intro={notYetIntro} index={{ n: 3, total: 3 }}>
        <Card className="max-w-heading">
          <ul className="flex list-disc flex-col gap-3 pl-5 text-body text-muted marker:text-dim">
            {notYet.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
        <ul className="mt-6 flex flex-col gap-1">
          {readMore.map((link) => (
            <li key={link.href}>
              <ArrowLink href={link.href} prefetch="intent" className="inline-flex min-h-target-row items-center">
                {link.label}
              </ArrowLink>
            </li>
          ))}
        </ul>
      </ProjectBand>
    </>
  );
}
