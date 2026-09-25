/**
 * Route group for the legal pages. Each page renders its own <LegalDoc> (title, "Last updated", table of contents
 * and reading column), so this layout only groups them. The group adds no URL segment, so its layout route is "/".
 */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return children;
}
