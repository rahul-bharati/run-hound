/**
 * Route group for the legal pages. Each page renders its own <LegalDoc> (title, "Last updated", table of contents,
 * reading column and structured data, from components/legal/pages.ts), so this layout only groups them. The group adds no URL segment, so its layout route is "/".
 */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return children;
}
