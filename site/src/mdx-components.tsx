import type { MDXComponents } from "mdx/types";
import { DocCallout, DocCode, DocLink, Shell, TableRegion } from "@/components/docs-shell/mdx";

/**
 * The components every MDX file renders with (@next/mdx needs this file for the App Router:
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/mdx-components.md). The docs MDX
 * (src/content/docs/*.mdx) may use only the components registered here (DESIGN.md §3.5; src/content/docs.test.ts):
 *
 * - <Shell block="…" label="…" />: a terminal block of content/commands.ts, with Copy;
 * - <Callout title="…">…</Callout>: a note (tone="warn" for a warning);
 * - <TableRegion label="…"><table>…</table></TableRegion>: a table that scrolls inside itself.
 *
 * And Markdown maps to: a fenced block (```sh label="…") to a CodeBlock that copies its "$ " commands only; a link to a
 * TextLink. There is no h1: the page renders it from the registry, so an h1 in the MDX fails the build.
 */
const components = {
  h1: () => {
    throw new Error("docs MDX: no h1 (the page renders it from content/routes/docs.ts)");
  },
  pre: DocCode,
  a: DocLink,
  Shell,
  Callout: DocCallout,
  TableRegion,
  // Right after the opening paragraph (remark-docs.mjs puts it there); the docs page fills it with "On this page".
  InlineTocSlot: () => null,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
