import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  Code,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Info,
  List,
  ListOrdered,
  LoaderCircle,
  Menu,
  Play,
  RotateCw,
  Settings,
  ShieldAlert,
  Sparkles,
  Square,
  Timer,
} from "lucide-static";

/** The one stroke width every icon uses, matching the site's Icon component (site/src/components/icon.tsx). */
export const ICON_STROKE = 1.75;

/**
 * Normalises a lucide-static SVG string for inline use: one line, 20px by default (CSS resizes it), stroke 1.75,
 * decorative (aria-hidden, not focusable). Every use sits next to text or inside a control with its own accessible
 * name. Done once at module load, so the UI document embeds the finished markup and makes no network requests.
 */
export function lucide(source: string): string {
  const svg = source.replace(/\s+/g, " ").replace(/>\s+</g, "><").replace(/\s+\/>/g, "/>").trim();
  if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>")) throw new Error("Unexpected lucide-static SVG shape.");
  return svg
    .replace(/ width="24"/, ' width="20"')
    .replace(/ height="24"/, ' height="20"')
    .replace(/ stroke-width="[\d.]+"/, ` stroke-width="${ICON_STROKE}"`)
    .replace(/ xmlns="[^"]*"/, "")
    .replace(/^<svg /, '<svg aria-hidden="true" focusable="false" ');
}

/** Lucide icons for the local UI, keyed by the names the client script uses (CONFIG.icons). */
export const ICONS = {
  // Sidebar and navigation
  play: lucide(Play),
  list: lucide(List),
  gear: lucide(Settings),
  menu: lucide(Menu),
  back: lucide(ArrowLeft),
  chevronDown: lucide(ChevronDown),
  chevronRight: lucide(ChevronRight),
  // Running view
  clock: lucide(Timer),
  globe: lucide(Globe),
  reload: lucide(RotateCw),
  steps: lucide(ListOrdered),
  activity: lucide(List),
  stop: lucide(Square),
  // Report actions and panels
  rerun: lucide(RotateCw),
  external: lucide(ExternalLink),
  download: lucide(Download),
  copy: lucide(Copy),
  file: lucide(FileText),
  code: lucide(Code),
  info: lucide(Info),
  shield: lucide(ShieldAlert),
  sparkle: lucide(Sparkles),
  // Status (rendered inside .ring, coloured per status by CSS)
  statusPass: lucide(CircleCheck),
  statusFail: lucide(CircleAlert),
  statusRunning: lucide(LoaderCircle),
  statusQueued: lucide(Circle),
  statusSkipped: lucide(CircleMinus),
} as const;

export type IconName = keyof typeof ICONS;
