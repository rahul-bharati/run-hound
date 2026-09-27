import Image, { type ImageProps } from "next/image";
import Link from "next/link";
import { site } from "@/lib/site";
// The brand files stay in public/brand for the app UI and reports (docs/brand.md). Importing the file gives the
// site a hashed, immutable copy that next/image resizes for every mark size.
import houndMark from "../../public/brand/hound-mark-light.png";

// The mark is 640 x 368; keep that ratio at every size.
const RATIO = houndMark.width / houndMark.height;

/**
 * The hound mark (light strokes, mint highlight) for dark backgrounds. `size` is its height in px.
 * Decorative: the wordmark or a label always sits next to it. Lazy unless the caller knows it is in view at first
 * paint: the header logo, and the large faint mark behind a page title (often the largest image in view on
 * desktop), pass `loading="eager"`.
 */
export function LogoMark({
  size = 28,
  className = "",
  loading,
  fetchPriority,
  sizes,
}: {
  size?: number;
  className?: string;
} & Pick<ImageProps, "loading" | "fetchPriority" | "sizes">) {
  return (
    <Image
      src={houndMark}
      alt=""
      width={Math.round(size * RATIO)}
      height={size}
      loading={loading}
      fetchPriority={fetchPriority}
      sizes={sizes}
      className={`shrink-0 select-none ${className}`}
      draggable={false}
    />
  );
}

/**
 * Mark plus "Run Hound" wordmark, linking home. The header passes `prefetch={false}` on the home page, where the
 * link points at the page already open.
 */
export function Logo({ prefetch }: { prefetch?: false }) {
  return (
    <Link
      href="/"
      prefetch={prefetch}
      className="flex shrink-0 items-center gap-2.5 font-display text-[22px] font-extrabold tracking-[-0.02em] text-fg"
    >
      {/* In the sticky header, so in view on every page. */}
      <LogoMark size={28} loading="eager" />
      <span>{site.name}</span>
    </Link>
  );
}
