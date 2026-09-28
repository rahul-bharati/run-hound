import { SpriteIcon } from "@/components/sprite";
import { ScrollRegion } from "@/components/compare/scroll-region";
import { CodeText } from "@/components/oss/code-text";
import { TextLink } from "@/components/primitives/links";
import { checkLink, type Capability, type Mark, type Tool } from "@/content/compare";

/**
 * The marks, named for screen readers. Calm: accent for "yes" (a status mark, 1.75 px, never a strong object), neutral
 * greys otherwise, never the fail colour: this page compares, it doesn't grade. Each icon is a symbol of the page's
 * sprite (<Sprite icons={markIcons} /> in app/compare/page.tsx), so 36 cells cost a <use> each.
 */
export const marks: Record<Mark, { label: string; icon?: string; className: string }> = {
  yes: { label: "Yes", icon: "icon-yes", className: "text-accent" },
  some: { label: "Partly", icon: "icon-some", className: "text-muted" },
  no: { label: "No", icon: "icon-no", className: "text-dim" },
  unknown: { label: "Not covered by our research", className: "text-dim" },
};

/** A cell: its mark as an icon (named for screen readers), then what the research says, or the mark's name alone. */
function MarkCell({ mark, text, strong = false }: { mark: Mark; text?: string; strong?: boolean }) {
  const { label, icon, className } = marks[mark];
  if (!icon) {
    return (
      <span className="text-dim">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-2">
      <SpriteIcon name={icon} size={16} className={`mt-1 shrink-0 ${className}`} />
      {text ? (
        <span className={strong ? "text-fg" : "text-muted"}>
          <span className="sr-only">{label}: </span>
          <CodeText text={text} />
        </span>
      ) : (
        <span className={strong || mark === "yes" ? "text-fg" : "text-muted"}>{label}</span>
      )}
    </span>
  );
}

/** The marks, explained once above the table. */
export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-small text-muted" aria-label="Legend">
      {(Object.keys(marks) as Mark[]).map((mark) => {
        const { label, icon, className } = marks[mark];
        return (
          <li key={mark} className="flex items-center gap-2">
            {icon ? (
              <SpriteIcon name={icon} size={16} className={className} />
            ) : (
              <span aria-hidden="true" className="w-4 text-center text-dim">
                —
              </span>
            )}
            {label}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The comparison table (§3.10, #at-a-glance): a row per capability, Run Hound's column first, then each tool. It
 * scrolls sideways inside its own focusable region (so the keyboard can scroll it), never the page; the capability
 * column stays in view. Its scroll padding is the sticky column's width (w-40, sm:w-48), and ScrollRegion scrolls a
 * focused link clear of it, so focus never lands under the column (WCAG 2.4.11). A row that names Run Hound checks links
 * each one to its page from Run Hound's cell.
 */
export function CompareTable({
  capabilities,
  tools,
  caption,
}: {
  capabilities: readonly Capability[];
  tools: readonly Tool[];
  caption: string;
}) {
  const cell = "border-t border-line-soft px-4 py-4 align-top sm:px-5";
  return (
    <ScrollRegion labelledBy="compare-caption" className="relative overflow-x-auto scroll-pl-40 rounded-card border border-line bg-surface sm:scroll-pl-48">
      <table className="w-full min-w-5xl border-separate border-spacing-0 text-left text-small">
        <caption id="compare-caption" className="sr-only">
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-40 border-r border-line bg-surface px-4 py-4 align-bottom font-mono text-mono text-muted uppercase sm:w-48 sm:px-5">
              Capability
            </th>
            <th scope="col" className="w-56 bg-surface-2 px-4 py-4 align-bottom font-display text-title font-bold text-fg sm:px-5">
              Run Hound
            </th>
            {tools.map((tool) => (
              <th key={tool.id} scope="col" className="px-4 py-4 align-bottom font-semibold text-fg sm:px-5">
                {tool.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {capabilities.map((row) => (
            <tr key={row.capability}>
              <th scope="row" className={`sticky left-0 z-10 border-r border-line bg-surface font-semibold text-fg ${cell}`}>
                {row.capability}
              </th>
              <td className={`bg-surface-2 ${cell}`}>
                <MarkCell mark="yes" text={row.runHound} strong />
                {row.checks ? (
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-6" aria-label={`Checks for “${row.capability}”`}>
                    {row.checks.map((id) => {
                      const link = checkLink(id);
                      return (
                        <li key={id}>
                          <TextLink href={link.href} prefetch="intent" className="inline-flex min-h-6 items-center">
                            {link.label}
                          </TextLink>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </td>
              {tools.map((tool) => (
                <td key={tool.id} className={cell}>
                  <MarkCell {...row.cells[tool.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
