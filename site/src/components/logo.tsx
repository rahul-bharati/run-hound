import Image from "next/image";
import Link from "next/link";
import { site } from "@/lib/site";
// The brand files stay in public/brand for the app UI and reports (docs/brand.md). Importing the file gives the
// site a hashed, immutable copy that next/image resizes for every mark size.
import houndMark from "../../public/brand/hound-mark-light.png";

// The mark is 640 x 368; keep that ratio at every size.
const RATIO = houndMark.width / houndMark.height;

/**
 * The hound mark (light strokes, mint highlight) for dark backgrounds. `size` is its height in px.
 * Decorative: the wordmark or a label always sits next to it.
 */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src={houndMark}
      alt=""
      width={Math.round(size * RATIO)}
      height={size}
      className={`shrink-0 select-none ${className}`}
      draggable={false}
    />
  );
}

/** Mark plus "Run Hound" wordmark, linking home. */
export function Logo() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center gap-2.5 font-display text-[22px] font-extrabold tracking-[-0.02em] text-fg"
    >
      <LogoMark size={28} />
      <span>{site.name}</span>
    </Link>
  );
}
