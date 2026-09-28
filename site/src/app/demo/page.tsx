import { JsonLd } from "@/components/json-ld";
import { DemoFindingBlock, DemoPicture } from "@/components/demo/finding";
import { fullSizes, wideSizes } from "@/components/demo/evidence-figure";
import { ProductBand } from "@/components/demo/product-band";
import { ProductIntro } from "@/components/demo/product-intro";
import { RichText } from "@/components/demo/rich-text";
import { Card } from "@/components/primitives/card";
import { CodeBlock } from "@/components/primitives/code-block";
import { ArrowLink } from "@/components/primitives/links";
import { Tag } from "@/components/primitives/tag";
import { commands } from "@/content/commands";
import { demoIntro, demoSections, fernwayBand, planted, plantedBand, tryBand, type DemoSection } from "@/content/demo";
import { routeMetadata } from "@/lib/metadata";
import { resolveTarget } from "@/lib/nav";
import { routeGraph } from "@/lib/structured-data";
import MotionGate from "@/motion/motion-gate-loader";

export const metadata = routeMetadata("demo");

/**
 * A section's findings: one finding's pictures side by side (the double submit), a picture beside its "Why it matters"
 * (the silent failure), two findings side by side (leaks, the page as a whole), or one picture across the column.
 * `lead`: the page's first section, whose first finding is above the fold and the page's largest paint (the release
 * gate's LCP, §5.2), so its pictures are preloaded (components/demo/finding.tsx).
 */
function Findings({ section, lead }: { section: DemoSection; lead: boolean }) {
  const [first] = section.findings;
  // The section itself carries the id when it is the check's (#silent-failure).
  const own = (check: string) => check !== section.id;
  if (section.findings.length > 1) {
    return (
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-6 xl:gap-8">
        {section.findings.map((finding, i) => (
          <DemoFindingBlock key={finding.check} finding={finding} id={own(finding.check)} lead={lead && i === 0} />
        ))}
      </div>
    );
  }
  if (section.aside) {
    return (
      <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-12">
        <DemoFindingBlock finding={first} id={own(first.check)} className="lg:col-span-7" sizes={wideSizes} lead={lead} />
        <div className="flex flex-col gap-3 lg:col-span-5">
          <h3 className="font-display text-title font-bold text-fg">{section.aside.label}</h3>
          <p className="text-body text-muted">{section.aside.text}</p>
        </div>
      </div>
    );
  }
  return first.figures.length > 1 ? (
    <DemoFindingBlock finding={first} id={own(first.check)} layout="pair" lead={lead} />
  ) : (
    <DemoFindingBlock finding={first} id={own(first.check)} sizes={fullSizes} lead={lead} />
  );
}

/**
 * /demo/ (DESIGN.md §3.12): real findings with their evidence, each linking its check's page, then how to run the same
 * demo, Fernway, and the planted bugs the test apps are scored against. A recording paints its proof frame's still first
 * and plays once when it is in view (motion allowed), resting on that frame; the figures below the fold reveal as the
 * reader reaches them (the media only). Every word is in content/demo.ts.
 */
export default function DemoPage() {
  return (
    <>
      <JsonLd data={routeGraph("demo")} />
      <ProductIntro id="demo" title={demoIntro.title} lede={demoIntro.lede} />

      {demoSections.map((section, i) => (
        <ProductBand key={section.id} id={section.id} title={section.title} intro={<RichText text={section.intro} />} tone={section.tone}>
          <Findings section={section} lead={i === 0} />
        </ProductBand>
      ))}

      <ProductBand id={tryBand.id} title={tryBand.title} intro={tryBand.intro} tone="band">
        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex min-w-0 flex-col gap-4">
            <CodeBlock label={tryBand.labLabel} commands={commands.blocks.lab.commands} />
            <p className="text-body text-muted">
              <RichText text={tryBand.labNext} />
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-body text-muted">
              <RichText text={tryBand.sourceText} />
            </p>
            {tryBand.sourceBlocks.map((source) => (
              <CodeBlock key={source.label} label={source.label} comment={source.block.comment} commands={source.block.commands} />
            ))}
            <ul className="flex flex-col">
              {tryBand.links.map((link) => (
                <li key={link.text}>
                  <ArrowLink href={resolveTarget(link.to)} prefetch="intent" className="inline-flex min-h-target-row items-center">
                    {link.text}
                  </ArrowLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ProductBand>

      <ProductBand id={fernwayBand.id} title={fernwayBand.title} intro={<RichText text={fernwayBand.intro} />}>
        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <ul className="flex list-disc flex-col gap-3 pl-5 text-body text-muted marker:text-dim">
            {fernwayBand.points.map((point) => (
              <li key={point.lead}>
                <strong className="font-semibold text-fg">{point.lead}</strong> <RichText text={point.text} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-4">
            <p className="text-body text-muted">
              <RichText text={fernwayBand.enter} />
            </p>
            <ul className="flex flex-col">
              {fernwayBand.links.map((link) => (
                <li key={link.text}>
                  <ArrowLink href={resolveTarget(link.to)} prefetch="intent" className="inline-flex min-h-target-row items-center">
                    {link.text}
                  </ArrowLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-2 lg:gap-6 xl:gap-8">
          <DemoPicture figure={{ picture: { screen: { group: "aiBuiltScreens", key: "fernway" } }, label: fernwayBand.app.label, caption: fernwayBand.app.caption }} />
          <DemoFindingBlock finding={fernwayBand.finding} />
        </div>
      </ProductBand>

      <ProductBand id={plantedBand.id} title={plantedBand.title} intro={plantedBand.intro} tone="band">
        <ul className="grid gap-4 md:grid-cols-2 lg:gap-6">
          {planted.map((set) => {
            const total = set.groups.reduce((n, group) => n + group.ids.length, 0);
            return (
              <Card as="li" key={set.label} className="flex flex-col gap-5">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="flex flex-wrap items-center gap-2 font-mono text-mono text-dim">
                    {set.label}
                    {set.preview ? <Tag>Preview</Tag> : null}
                  </p>
                  <p className="font-display text-display-m text-fg">
                    {total}
                    <span className="sr-only"> {plantedBand.plantedCount}</span>
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-title font-bold text-fg">{set.title}</h3>
                  <p className="text-body text-muted">{set.text}</p>
                </div>
                <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
                  {set.groups.map((group) => (
                    <li key={group.name} className="flex items-center justify-between gap-4 py-2 text-body text-fg">
                      <span>{group.name}</span>
                      <span className="font-mono text-mono text-muted">{group.ids.length}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </ul>
        <p className="mt-6 max-w-measure text-body text-muted">{plantedBand.note}</p>
      </ProductBand>

      <MotionGate islands={["scroll"]} />
    </>
  );
}
