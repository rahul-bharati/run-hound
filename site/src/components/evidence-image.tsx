import Image, { getImageProps, type StaticImageData } from "next/image";

/**
 * A real evidence image from a Run Hound report, optimised by next/image.
 *
 * Recordings are 3-frame GIFs straight from the report (about 100 KB each). next/image never re-encodes animated
 * images (the optimiser passes them through and warns), so they are served as the hashed original with
 * `unoptimized`. People who prefer reduced motion get `still`, the recording's last frame, through a
 * <picture> source that *is* optimised (AVIF/WebP at the right width).
 */
export function EvidenceImage({
  src,
  still,
  alt,
  sizes,
  className = "",
}: {
  src: StaticImageData;
  still?: StaticImageData;
  alt: string;
  sizes: string;
  className?: string;
}) {
  const animated = src.src.split("?", 1)[0].endsWith(".gif");

  if (!animated) {
    return <Image src={src} alt={alt} sizes={sizes} quality={90} placeholder="blur" className={className} />;
  }

  const { props: gif } = getImageProps({ src, alt, unoptimized: true });
  const reduced = still ? getImageProps({ src: still, alt: "", sizes, quality: 90 }).props : null;

  return (
    <picture>
      {reduced ? (
        <source media="(prefers-reduced-motion: reduce)" srcSet={reduced.srcSet} sizes={reduced.sizes} />
      ) : null}
      {/* getImageProps output: <picture> needs a plain <img>. */}
      <img {...gif} alt={alt} className={className} />
    </picture>
  );
}
