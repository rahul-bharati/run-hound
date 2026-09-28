/**
 * The forced-colours notes on /_design/ (DESIGN.md §2.8, §3.14): what the site does when Windows' contrast themes (or
 * any forced-colors mode) replace its palette, each note quoting the selector of the rule that does it and the file it
 * lives in. design.test.ts reads the body of each @media (forced-colors: active) block in the file (brace to matching
 * brace) and fails if a quoted selector is in none of them, so the notes can't drift from the CSS.
 */
export const forcedColourNotes = [
  {
    note: "Figure strokes, the line hound and every tick draw in CanvasText, the theme's text colour.",
    selector: "[data-motion] svg *, .line-hound, .line-hound-brow, .tick",
    file: "src/app/globals.css",
  },
  {
    note: "Progress bars fill with Highlight, kept from being repainted, so progress still shows.",
    selector: "[data-progress]",
    file: "src/app/globals.css",
  },
  {
    note: "The current step, docs item and page, and a lit pipeline node, are underlined, not only coloured.",
    selector: '[aria-current="step"], [aria-current="location"], [aria-current="page"], [data-lit]',
    file: "src/app/globals.css",
  },
  {
    note: "A step trail's marked ring and the On this page marker fill with CanvasText.",
    selector: ".step-ring[data-tone], .step-marker",
    file: "src/app/globals.css",
  },
  {
    note: "A card reached by a link shows no ring: forced colours can't fade an outline, so it rests.",
    selector: ".card:target",
    file: "src/app/globals.css",
  },
  {
    note: "Windows and both panes of the run window get a CanvasText border, so the panes stay apart.",
    selector: ".win, .win-pane",
    file: "src/app/globals.css",
  },
  {
    note: "The header's GitHub mark paints in CanvasText.",
    selector: ".site-icon-link::before",
    file: "src/components/header/chrome.css",
  },
] as const;

export function ForcedColourNotes() {
  return (
    <ul className="flex flex-col gap-4">
      {forcedColourNotes.map(({ note, selector, file }) => (
        <li key={selector} className="flex flex-col gap-1">
          <span className="text-body text-muted">{note}</span>
          <span className="text-small text-muted">
            <code className="font-mono text-code text-muted">{selector}</code> in <code className="font-mono text-code text-muted">{file}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}
