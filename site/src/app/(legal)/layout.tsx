import { Container } from "@/components/layout";
import { site } from "@/lib/site";

/**
 * Shared shell for the legal pages: a narrow reading column with the last-updated line.
 * The route group adds no URL segment, so its layout route is "/".
 */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <Container className="pb-24 pt-12 sm:pt-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <p className="font-mono text-xs tracking-widest text-dim">Last updated: {site.legalUpdated}</p>
        <article className="prose-night min-w-0 break-words">{children}</article>
      </div>
    </Container>
  );
}
