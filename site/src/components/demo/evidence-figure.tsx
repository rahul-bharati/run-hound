import { getImageProps, type StaticImageData } from "next/image";
import type { ReactNode } from "react";

/**
 * A real evidence image from a Run Hound report, framed like a window. For GIFs pass `still`: people who
 * prefer reduced motion get that frame instead of the animation.
 */
export function EvidenceFigure({
  src,
  still,
  alt,
  label,
  caption,
  className = "",
}: {
  src: StaticImageData;
  still?: StaticImageData;
  alt: string;
  label: string;
  caption: ReactNode;
  className?: string;
}) {
  const { props } = getImageProps({ src, alt, unoptimized: true, sizes: "(min-width: 1024px) 50vw, 100vw" });
  const stillSrc = still ? getImageProps({ src: still, alt: "", unoptimized: true }).props.src : null;

  return (
    <figure className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface ${className}`}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] tracking-widest text-dim">{label}</span>
      </div>
      <picture className="block bg-bg-deep">
        {stillSrc ? <source media="(prefers-reduced-motion: reduce)" srcSet={stillSrc} /> : null}
        <img {...props} alt={alt} loading="lazy" decoding="async" className="block h-auto w-full" />
      </picture>
      <figcaption className="border-t border-line px-4 py-3.5 text-sm leading-relaxed text-muted">{caption}</figcaption>
    </figure>
  );
}
