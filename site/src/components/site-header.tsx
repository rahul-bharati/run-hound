import { HeaderClient } from "@/components/header/header-client";
import { headerProps } from "@/components/header/header-data";
import { LogoMark } from "@/components/logo";
import { ButtonLink } from "@/components/primitives/button-link";
import { site } from "@/lib/site";

/**
 * The site header (DESIGN.md §3.2). A Server Component: it reads the route registry (components/header/header-data.ts)
 * and hands the client part plain props (ES2), with the brand and the call to action rendered here, so neither the
 * mark's image nor the button's code ships in the client bundle.
 */
export function SiteHeader() {
  const props = headerProps();
  return (
    <HeaderClient
      {...props}
      brand={
        <>
          {/* The mark is 40 × 23 in the bar; in view on every page, so not lazy, but it is decorative next to the
              wordmark text and never the LCP candidate (the h1 is, DESIGN.md §5.2): fetchPriority low keeps it from
              competing with the render-blocking CSS and fonts on a throttled connection. */}
          <LogoMark size={23} loading="eager" fetchPriority="low" />
          {/* Below 360 px only the mark shows; the name stays the link's name. */}
          <span className="max-xs:sr-only">{site.name}</span>
        </>
      }
      // Fetched on intent (a hover, touch or focus): the first viewport's prefetches go to the brand and the first
      // hubs (header-client.tsx, VIEWPORT_HUBS), and the homepage's hero links the same page in view anyway.
      action={
        <ButtonLink href={props.cta.href} size="header" prefetch="intent">
          {props.cta.label}
        </ButtonLink>
      }
      // The menu's last row: full width, and not prefetched (the menu's rows don't prefetch).
      menuAction={
        <ButtonLink href={props.cta.href} prefetch="none" className="w-full">
          {props.cta.label}
        </ButtonLink>
      }
    />
  );
}
