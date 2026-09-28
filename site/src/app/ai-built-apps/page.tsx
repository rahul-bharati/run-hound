import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";
import { ConfigBlock } from "@/components/ai-built/config-block";
import { halfSizes } from "@/components/demo/evidence-figure";
import { ProductBand } from "@/components/demo/product-band";
import { ProductIntro } from "@/components/demo/product-intro";
import { RichText } from "@/components/demo/rich-text";
import { ButtonLink } from "@/components/primitives/button-link";
import { Card } from "@/components/primitives/card";
import { CodeBlock } from "@/components/primitives/code-block";
import { Command } from "@/components/primitives/command";
import { Figure } from "@/components/primitives/figure";
import { ArrowLink } from "@/components/primitives/links";
import { aiBuiltScreens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import {
  aiBuiltIntro,
  aiBuiltJsonLd,
  aiBuiltSection,
  type AiBuiltSectionId,
  discovery,
  fernwayTry,
  handles,
  handlesFigures,
  limits,
  nextConfig,
  nextConfigNote,
  otherSetUps,
  problems,
  runBlock,
  setUpLabels,
  setUpSteps,
  signedIn,
  viteConfig,
} from "@/content/ai-built";
import { ui } from "@/content/ui";
import { routeMetadata } from "@/lib/metadata";
import { href, resolveTarget } from "@/lib/nav";
import { site } from "@/lib/site";

export const metadata = routeMetadata("ai-built-apps");

/** A band of the page by its id: its h2 and intro come from content/ai-built.ts (aiBuiltSections). */
function Section({ id, tone, children }: { id: AiBuiltSectionId; tone?: "bg" | "band"; children: ReactNode }) {
  const section = aiBuiltSection(id);
  return (
    <ProductBand id={section.id} title={section.title} intro={section.intro} tone={tone}>
      {children}
    </ProductBand>
  );
}

/**
 * /ai-built-apps/ (DESIGN.md §3.11): the search landing page for Lovable, Bolt and v0 apps. What discovery handles and
 * covers (#discovery, the old /docs/#ai-built), the set-up (export and run the app locally first, then
 * host.docker.internal), signed-in runs, the limits, and Fernway to try it on. Every word is in content/ai-built.ts.
 */
export default function AiBuiltAppsPage() {
  return (
    <>
      <JsonLd data={aiBuiltJsonLd()} />
      <ProductIntro
        id="ai-built-apps"
        title={aiBuiltIntro.title}
        lede={aiBuiltIntro.lede}
        meta={
          <>
            {aiBuiltIntro.metaLead} {site.version} · <time dateTime={site.releasedIso}>{site.released}</time>
          </>
        }
      >
        {/* Fetched on intent (a hover, touch or focus), as the header's later hubs are: the header's brand and first
            hubs already take 9 of the first viewport's 10 prefetch requests (DESIGN.md §5.2), and in view "#set-up"
            would fetch this page again. */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="#set-up" prefetch="intent">
            {aiBuiltIntro.setUp}
          </ButtonLink>
          <ButtonLink href={href("demo", "fernway")} variant="secondary" prefetch="intent">
            {aiBuiltIntro.seeFernway}
          </ButtonLink>
        </div>
      </ProductIntro>

      <Section id="handles">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {handles.map((item) => (
            <Card as="li" key={item.title} className="flex flex-col gap-3">
              <h3 className="font-display text-title font-bold text-fg">{item.title}</h3>
              <p className="text-body text-muted">{item.card}</p>
            </Card>
          ))}
        </ul>
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-2 lg:gap-6 xl:gap-8">
          {handlesFigures.map((figure) => (
            <Figure key={figure.screen} caption={figure.caption}>
              <Screenshot screen={aiBuiltScreens[figure.screen]} sizes={halfSizes} />
            </Figure>
          ))}
        </div>
      </Section>

      <Section id="discovery" tone="band">
        <dl className="grid gap-4 md:grid-cols-3 lg:gap-6">
          {discovery.facts.map((fact) => (
            <Card key={fact.term} className="flex flex-col gap-2">
              <dt className="font-mono text-mono text-dim">{fact.term}</dt>
              <dd className="text-body text-fg">{fact.value}</dd>
            </Card>
          ))}
        </dl>
        <ul className="mt-6 flex max-w-measure list-disc flex-col gap-3 pl-5 text-body text-muted marker:text-dim">
          {discovery.finds.map((find, i) => (
            <li key={i}>
              <RichText text={find} />
            </li>
          ))}
        </ul>
        <p className="mt-4">
          <ArrowLink href={`#${discovery.limitsLink.hash}`} className="inline-flex min-h-target-row items-center">
            {discovery.limitsLink.text}
          </ArrowLink>
        </p>
      </Section>

      <Section id="set-up">
        <ol className="flex max-w-measure flex-col gap-10">
          {setUpSteps.map((step) => (
            <li key={step.title} className="flex min-w-0 flex-col gap-3">
              <h3 className="font-display text-title font-bold text-fg">{step.title}</h3>
              <p className="text-body text-muted">
                <RichText text={step.text} />
              </p>
              {step.extra === "configs" ? (
                <>
                  <ConfigBlock label={setUpLabels.vite} code={viteConfig} />
                  <p className="text-body text-muted">
                    <RichText text={nextConfigNote} />
                  </p>
                  <ConfigBlock label={setUpLabels.next} code={nextConfig} />
                </>
              ) : null}
              {step.extra === "run" ? <CodeBlock label={setUpLabels.run} commands={runBlock.commands} /> : null}
            </li>
          ))}
        </ol>

        <div className="mt-10 grid max-w-5xl gap-4 lg:grid-cols-2 lg:gap-6">
          <Card className="flex min-w-0 flex-col gap-3">
            <h3 className="font-display text-title font-bold text-fg">{otherSetUps.hostNetwork.title}</h3>
            <p className="text-body text-muted">
              <RichText text={otherSetUps.hostNetwork.text} />
            </p>
            <CodeBlock label={setUpLabels.hostNetwork} commands={otherSetUps.hostNetwork.block.commands} />
          </Card>
          <Card className="flex min-w-0 flex-col gap-3">
            <h3 className="font-display text-title font-bold text-fg">{otherSetUps.source.title}</h3>
            <p className="text-body text-muted">
              <RichText text={otherSetUps.source.text} />
            </p>
          </Card>
        </div>

        <p className="mt-8 max-w-measure text-body text-muted">
          <RichText text={otherSetUps.limits} />
        </p>

        <div className="mt-10 flex max-w-measure flex-col gap-4">
          <h3 className="font-display text-title font-bold text-fg">{otherSetUps.problemsTitle}</h3>
          <Card className="p-0">
            <dl className="flex flex-col divide-y divide-line-soft">
              {problems.map((problem) => (
                <div key={problem.see} className="flex flex-col gap-1 px-5 py-4">
                  <dt className="wrap-anywhere font-mono text-code text-fg">{problem.see}</dt>
                  <dd className="text-body text-muted">{problem.means}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </Section>

      <Section id="signed-in" tone="band">
        <div className="flex max-w-measure flex-col gap-4 text-body text-muted">
          {signedIn.paragraphs.map((paragraph, i) => (
            <p key={i}>
              <RichText text={paragraph} />
            </p>
          ))}
          <p>
            <ArrowLink href={resolveTarget(signedIn.link.to)} prefetch="intent" className="inline-flex min-h-target-row items-center">
              {signedIn.link.text}
            </ArrowLink>
          </p>
        </div>
      </Section>

      <Section id="limits">
        <Card className="max-w-measure">
          <ul className="flex list-disc flex-col gap-3 pl-5 text-body text-muted marker:text-dim">
            {limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section id="fernway" tone="band">
        <Command
          command={fernwayTry.command}
          label={fernwayTry.label}
          next={ui.afterCopy}
          hint={<RichText text={fernwayTry.hint} />}
          className="max-w-measure"
        />
        <ul className="mt-6 flex flex-col gap-x-8 sm:flex-row sm:flex-wrap">
          {fernwayTry.links.map((link) => (
            <li key={link.text}>
              <ArrowLink href={resolveTarget(link.to)} prefetch="intent" className="inline-flex min-h-target-row items-center">
                {link.text}
              </ArrowLink>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
