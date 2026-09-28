"use client";

import { getImageProps, type StaticImageData } from "next/image";
import { preload } from "react-dom";

/**
 * Preloads a picture that is above the fold and may be the page's largest paint (the release gate's LCP, DESIGN.md
 * §5.2): a <link rel="preload"> in the head at high priority (a default image preload is emitted after the scripts
 * and waits behind them), on the screens `media` names only ("all" for every screen). It names the same srcset and
 * sizes as the picture's <img> (next/image at quality 90), so the browser reuses the response.
 *
 * A client component on purpose: in a server component, preload() (and a <link rel="preload"> element too) becomes a
 * hint in the page's RSC payload, which the router applies on a prefetch, so every page that prefetches this one
 * would download the picture as well. Here it runs only when the page itself renders.
 */
export function PreloadPicture({ src, sizes, media }: { src: StaticImageData; sizes: string; media: string }) {
  const { props } = getImageProps({ src, alt: "", sizes, quality: 90 });
  preload(props.src, { as: "image", imageSrcSet: props.srcSet, imageSizes: sizes, media, fetchPriority: "high" });
  return null;
}
