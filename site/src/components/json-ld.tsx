/**
 * Structured data (schema.org JSON-LD, built with lib/structured-data.ts) as a plain <script type="application/ld+json">,
 * as the Next.js guide shows (node_modules/next/dist/docs/01-app/02-guides/json-ld.md): not next/script, since it is
 * data, not code. The JSON goes in through dangerouslySetInnerHTML because React would HTML-escape text children, and
 * every "<" becomes \u003c, so no string in it can close the element early.
 *
 * A data block is never executed, so the page's Content-Security-Policy doesn't cover it: scripts/csp.mjs leaves it
 * out of script-src. scripts/check-seo.mjs checks every block in the build.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
