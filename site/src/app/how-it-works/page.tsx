import { JsonLd } from "@/components/json-ld";
import { wideSizes } from "@/components/demo/evidence-figure";
import { PreloadPicture } from "@/components/demo/preload-picture";
import { ProductBand } from "@/components/demo/product-band";
import { ProductIntro } from "@/components/demo/product-intro";
import { RichText } from "@/components/demo/rich-text";
import { Card } from "@/components/primitives/card";
import { CodeBlock } from "@/components/primitives/code-block";
import { Figure } from "@/components/primitives/figure";
import { ArrowLink, TextLink } from "@/components/primitives/links";
import { stepScreens } from "@/components/screens";
import { Screenshot } from "@/components/screenshot";
import { cantSeeTopics, principles } from "@/content/claims";
import { unseenBand, howItWorksIntro, howSteps, outputsBand, designPrinciplesBand, startSnippet } from "@/content/how-it-works";
import { routeMetadata } from "@/lib/metadata";
import { href, resolveTarget } from "@/lib/nav";
import { routeGraph } from "@/lib/structured-data";
import MotionGate from "@/motion/motion-gate-loader";

export const metadata = routeMetadata("how-it-works");

/**
 * The first step's screenshot is the largest paint on a desktop screen (the release gate's LCP, §5.2): it sits beside
 * its text from 1024 px (lg:grid-cols-12), above the fold, and is preloaded there at high priority. On phones it
 * starts below the fold and a paragraph is the largest paint, so nothing is preloaded there.
 */
const firstShotMedia = "(min-width: 1024px)";

/**
 * /how-it-works/ (DESIGN.md §3.12): the five steps with their screenshots, the principles, the outputs, what a browser
 * can't see, and a three-line Start snippet that links the quick start. The screenshots below the fold reveal as the
 * reader reaches them (§4.3: the media only; captions and text never move); every word is in content/.
 */
export default function HowItWorksPage() {
  return (
    <>
      <JsonLd data={routeGraph("how-it-works")} />
      <ProductIntro id="how-it-works" title={howItWorksIntro.title} lede={howItWorksIntro.lede} meta={howItWorksIntro.meta} />

      <ProductBand id="steps" title={howItWorksIntro.stepsHeading} hideTitle>
        <ol className="flex flex-col gap-16 lg:gap-20">
          {howSteps.map((step, i) => (
            <li key={step.name} className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12">
              <div className={`flex flex-col gap-4 lg:col-span-5 ${i % 2 === 1 ? "lg:order-2" : ""}`}>
                <p className="font-mono text-mono uppercase text-dim">
                  {step.number} · {step.name}
                </p>
                <h3 className="text-balance font-display text-title font-bold text-fg">{step.title}</h3>
                <p className="text-body text-muted">
                  <RichText text={step.body} />
                </p>
              </div>
              <Figure caption={step.caption} reveal className={`lg:col-span-7 ${i % 2 === 1 ? "lg:order-1" : ""}`}>
                {i === 0 ? <PreloadPicture src={stepScreens[step.shot].src} sizes={wideSizes} media={firstShotMedia} /> : null}
                <Screenshot screen={stepScreens[step.shot]} sizes={wideSizes} />
              </Figure>
            </li>
          ))}
        </ol>
      </ProductBand>

      <ProductBand id="principles" title={designPrinciplesBand.title} intro={designPrinciplesBand.intro} tone="band">
        <ul className="grid gap-4 md:grid-cols-2 lg:gap-6">
          {principles.map((principle) => (
            <Card as="li" key={principle.title} className="flex flex-col gap-3">
              <h3 className="font-display text-title font-bold text-fg">{principle.title}</h3>
              <p className="text-body text-muted">
                {principle.text}
                {principle.link ? (
                  <>
                    {" "}
                    <TextLink href={href(principle.link.to)} prefetch="intent">
                      {principle.link.label}
                    </TextLink>
                    .
                  </>
                ) : null}
              </p>
            </Card>
          ))}
        </ul>
      </ProductBand>

      <ProductBand id="outputs" title={outputsBand.title} intro={outputsBand.intro}>
        <ul className="grid gap-4 md:grid-cols-3 lg:gap-6">
          {outputsBand.items.map((output) => (
            <Card as="li" key={output.title} className="flex flex-col gap-3">
              <p className="font-mono text-mono text-dim">{output.label}</p>
              <h3 className="font-display text-title font-bold text-fg">{output.title}</h3>
              <p className="text-body text-muted">{output.text}</p>
            </Card>
          ))}
        </ul>
      </ProductBand>

      <ProductBand id="cant-see" title={unseenBand.title} intro={unseenBand.intro} tone="band">
        <Card className="max-w-measure">
          <ul className="flex flex-col gap-3">
            {cantSeeTopics.map((item) => (
              <li key={item} className="flex items-start gap-3 text-body text-fg">
                <span className="mt-1 size-4 shrink-0 rounded-sm border border-line-strong" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      </ProductBand>

      <ProductBand id="start" title={startSnippet.title} intro={startSnippet.text}>
        <div className="flex max-w-heading flex-col gap-4">
          <CodeBlock label={startSnippet.label} commands={startSnippet.block.commands} />
          <p>
            <ArrowLink href={resolveTarget(startSnippet.link.to)} prefetch="intent" className="inline-flex min-h-target-row items-center">
              {startSnippet.link.text}
            </ArrowLink>
          </p>
        </div>
      </ProductBand>

      <MotionGate islands={["scroll"]} />
    </>
  );
}
