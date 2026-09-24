import Image from "next/image";
import Link from "next/link";
import { site } from "@/lib/site";

// The mark is 640 x 368; keep that ratio at every size.
const RATIO = 640 / 368;

/**
 * The hound mark (light strokes, mint highlight) for dark backgrounds. `size` is its height in px.
 * Decorative: the wordmark or a label always sits next to it.
 */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const src = size > 46 ? "/brand/hound-mark-light.png" : "/brand/hound-mark-light-160.png";
  return (
    <Image
      src={src}
      alt=""
      width={Math.round(size * RATIO)}
      height={size}
      // Static export: serve the file as it is.
      unoptimized
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
