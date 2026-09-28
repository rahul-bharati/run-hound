import { AtAGlance } from "@/components/faq/at-a-glance";
import { FaqEntry } from "@/components/faq/faq-entry";
import { JsonLd } from "@/components/json-ld";
import { PageIntro } from "@/components/oss/page-intro";
import { ProjectBand } from "@/components/oss/project-band";
import { ButtonLink } from "@/components/primitives/button-link";
import { Card } from "@/components/primitives/card";
import { faqAtAGlance, faqClosing, faqGroups, faqIntro, faqJsonLd } from "@/content/faq";
import { routeMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = routeMetadata("faq");

export default function FaqPage() {
  const total = faqGroups.length + 1;
  return (
    <>
      <PageIntro
        id="faq"
        title={faqIntro.title}
        lede={faqIntro.lede}
        meta={
          <>
            Answers for release {site.version} · <time dateTime={site.releasedIso}>{site.released}</time>
          </>
        }
      />

      <ProjectBand id="at-a-glance" title={faqIntro.glance} index={{ n: 1, total }}>
        <AtAGlance facts={faqAtAGlance} />
      </ProjectBand>

      {faqGroups.map((group, i) => (
        <ProjectBand key={group.id} id={group.id} title={group.title} index={{ n: i + 2, total }}>
          <div className="flex flex-col">
            {group.items.map((item) => (
              <FaqEntry key={item.id} item={item} />
            ))}
          </div>
        </ProjectBand>
      ))}

      <div className="container-page pb-16 lg:pb-20">
        <Card className="flex max-w-heading flex-col items-start gap-4">
          <h2 className="font-display text-title font-bold text-fg">{faqClosing.title}</h2>
          <p className="text-body text-muted">{faqClosing.text}</p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <ButtonLink href={faqClosing.links[0].href}>{faqClosing.links[0].label}</ButtonLink>
            <ButtonLink href={faqClosing.links[1].href} variant="secondary">
              {faqClosing.links[1].label}
            </ButtonLink>
          </div>
        </Card>
      </div>
      {/* Last, so the h1 and the answers arrive before the structured data; search engines read it anywhere. */}
      <JsonLd data={faqJsonLd()} />
    </>
  );
}
