import { Container } from "@/components/layout";
import { DraftNotice } from "@/components/legal/legal";

/**
 * Shared shell for the legal pages: a narrow reading column with the draft notice and
 * last-updated line. The route group adds no URL segment, so its layout route is "/".
 */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <Container className="pb-24 pt-12 sm:pt-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <DraftNotice />
        <p className="font-mono text-xs tracking-widest text-dim">Last updated: [DATE]</p>
        <article className="prose-night min-w-0 break-words">{children}</article>
      </div>
    </Container>
  );
}
