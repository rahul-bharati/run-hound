"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useRef, useState } from "react";
import { motionAllowed } from "@/motion/use-motion-allowed";

/**
 * A recording on /demo/ (DESIGN.md §3.12). Its proof frame paints first, as the optimised still (next/image: AVIF or
 * WebP at the rendered width, a fraction of the GIF's bytes), so the page's largest paint never waits on a 170 KB
 * GIF. Above the fold, the still is preloaded (components/demo/finding.tsx).
 *
 * The GIF is requested only after the load event, once at least half the figure is in view, and only when motion is
 * allowed (no reduced-motion preference, Save-Data off). It lies over the still, the same size (no layout shift), and
 * stays hidden until it has loaded, so it plays once from its first frame and rests on the proof frame, which is the
 * still. Reduced motion, Save-Data and no JavaScript keep the still. The GIF is decorative (alt=""): the still under
 * it carries the alt text.
 */
export function Recording({
  gif,
  still,
  alt,
  sizes,
}: {
  gif: StaticImageData;
  still: StaticImageData;
  alt: string;
  sizes: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // 0: the still alone; 1: the GIF is loading, hidden over it; 2: the GIF plays.
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: IntersectionObserver | undefined;
    const arm = () => {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting) || !motionAllowed()) return;
          observer?.disconnect();
          setStage(1);
        },
        { threshold: 0.5 },
      );
      observer.observe(element);
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      window.removeEventListener("load", arm);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={frame} className="relative">
      <Image src={still} alt={alt} sizes={sizes} quality={90} placeholder="blur" className="block h-auto w-full" />
      {stage ? (
        <Image
          src={gif}
          alt=""
          unoptimized
          loading="eager"
          onLoad={() => setStage(2)}
          className={`absolute inset-0 size-full${stage < 2 ? " invisible" : ""}`}
        />
      ) : null}
    </div>
  );
}
